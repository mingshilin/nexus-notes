import type {
  BoardMoveInput,
  BulkEditRecordsInput,
  CalendarAssignmentInput,
  CreateDatabaseRecordInput,
  DatabaseRecord,
  DatabaseView,
  DeleteDatabaseRecordInput,
  UpdateDatabaseRecordInput,
  WorkspaceContext,
} from "@nexus/contracts";

import { assertRevision, DatabaseRepositoryBase } from "./database-repository-base";
import { RECORD_COLUMNS, VIEW_COLUMNS, DatabaseRepositoryError, cursorFingerprint, decodeRecordCursor, encodeRecordCursor, isUniqueGuardError, placeholders, toView, type RecordRow, type ViewRow } from "./database-model";

const JSON_BATCH_BYTES = 700_000;

function splitJsonBatches<T>(items: readonly T[]) {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 2;
  for (const item of items) {
    const itemBytes = new TextEncoder().encode(JSON.stringify(item)).byteLength + 1;
    if (current.length > 0 && bytes + itemBytes > JSON_BATCH_BYTES) {
      batches.push(current);
      current = [];
      bytes = 2;
    }
    current.push(item);
    bytes += itemBytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function revisionGuard(
  db: D1Database,
  context: WorkspaceContext,
  databaseId: string,
  expected: readonly { record_id: string; revision: number }[],
) {
  return db.prepare(
    `INSERT INTO workspaces (id, owner_user_id, slug, name, revision, created_at, updated_at)
     SELECT id, owner_user_id, slug || ':record-revision-guard', name, revision, created_at, updated_at
     FROM workspaces
     WHERE id = ? AND (
       NOT EXISTS (SELECT 1 FROM databases WHERE workspace_id = ? AND id = ?)
       OR
       (SELECT COUNT(*) FROM database_records
        JOIN json_each(?) AS expected_record
          ON json_extract(expected_record.value, '$.record_id') = database_records.id
         AND json_extract(expected_record.value, '$.revision') = database_records.revision
        WHERE workspace_id = ? AND database_id = ? AND deleted_at IS NULL)
       <> ?
     )`,
  ).bind(
    context.workspaceId, context.workspaceId, databaseId, JSON.stringify(expected), context.workspaceId, databaseId, expected.length,
  );
}

function isRecordRevisionGuardError(error: unknown) {
  return isUniqueGuardError(error, "workspaces.id");
}

export class D1DatabaseRecordRepository extends DatabaseRepositoryBase {
  async createRecord(context: WorkspaceContext, databaseId: string, input: CreateDatabaseRecordInput) {
    const fields = await this.access.fields(context, databaseId, "write");
    const values = this.normalize(fields.properties, input.values ?? {}, fields.writable);
    const referenceCollector = this.referenceCollector(fields.properties);
    referenceCollector.add(values);
    const references = referenceCollector.items();
    await this.validateReferenceItems(context, references);
    const now = this.now();
    const record: DatabaseRecord = {
      id: this.id(), workspace_id: context.workspaceId, database_id: databaseId,
      note_id: input.note_id ?? null, values, created_by: context.userId, updated_by: context.userId,
      revision: 1, created_at: now, updated_at: now,
    };
    const operation = this.beginOperation("database_record.create", context.workspaceId, record.id, "1 = 1");
    const statements = [...operation.statements, ...this.referenceGuards(context, references), ...this.createRecordStatements(record)];
    if (record.note_id) {
      const note = await this.db.prepare(
        "SELECT id, database_id FROM notes WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL",
      ).bind(context.workspaceId, record.note_id).first<{ id: string; database_id: string | null }>();
      if (!note || (note.database_id && note.database_id !== databaseId)) {
        throw new DatabaseRepositoryError("NOTE_NOT_FOUND", "Linked note was not found in this database", 404);
      }
      if (note.database_id === null) {
        statements.unshift(this.db.prepare(
          `UPDATE notes SET database_id = ?, revision = revision + 1, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND database_id IS NULL`,
        ).bind(databaseId, now, context.workspaceId, record.note_id));
      }
    }
    statements.push(
      ...this.auditStatements(
        context,
        "database_record.created",
        "database_record",
        record.id,
        record.revision,
        now,
        this.operationCondition(operation.operationId),
      ),
      ...this.referenceGuards(context, references),
      this.operationCleanup(operation.operationId),
    );
    try {
      await this.db.batch(statements);
    } catch (error) {
      const referenceFailure = this.referenceGuardFailure(error, references);
      if (referenceFailure) throw referenceFailure;
      throw error;
    }
    await this.notifyPresence(context.workspaceId, "database_record", record.id, record.revision);
    return record;
  }

  async getRecord(context: WorkspaceContext, databaseId: string, recordId: string) {
    const fields = await this.access.fields(context, databaseId, "read");
    const rows = await this.recordRows(context.workspaceId, databaseId, [recordId]);
    if (rows.length === 0) throw new DatabaseRepositoryError("RECORD_NOT_FOUND", "Database record not found", 404);
    return (await this.materialize(rows, fields.readable))[0]!;
  }

  async listRecords(context: WorkspaceContext, databaseId: string, options: { cursor?: string | null; limit: number; view_id?: string | null }) {
    if (!options.view_id) return this.recordPage(context, databaseId, {
      ...options,
      cursorFingerprint: cursorFingerprint({ kind: "records", database_id: databaseId }),
    });
    const row = await this.db.prepare(
      `SELECT ${VIEW_COLUMNS} FROM database_views WHERE workspace_id = ? AND database_id = ? AND id = ?`,
    ).bind(context.workspaceId, databaseId, options.view_id).first<ViewRow>();
    if (!row) throw new DatabaseRepositoryError("VIEW_NOT_FOUND", "Database view not found", 404);
    const view: DatabaseView = toView(row);
    return this.recordPage(context, databaseId, {
      ...options,
      viewConfig: view.config,
      cursorFingerprint: cursorFingerprint({ kind: "records", database_id: databaseId, view_id: view.id, view_revision: view.revision, view_config: view.config }),
    });
  }

  async searchRecords(context: WorkspaceContext, databaseId: string, options: { query: string; cursor?: string | null; limit: number }) {
    const fields = await this.access.fields(context, databaseId, "read");
    if (fields.readable.size === 0 || !options.query.trim()) return { items: [], next_cursor: null };
    const propertyIds = [...fields.readable];
    const fingerprint = cursorFingerprint({ kind: "search", database_id: databaseId, query: options.query });
    const limit = Math.max(1, Math.min(options.limit, 100));
    const conditions = [
      "r.workspace_id = ?", "r.database_id = ?", "r.deleted_at IS NULL",
      `v.property_id IN (${placeholders(propertyIds.length)})`, "json_extract(v.value_json, '$') LIKE ? ESCAPE '\\'",
    ];
    const bindings: unknown[] = [
      context.workspaceId, databaseId, ...propertyIds,
      `%${options.query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`,
    ];
    if (options.cursor) {
      const cursor = decodeRecordCursor(options.cursor);
      if (cursor.fingerprint !== fingerprint) {
        throw new DatabaseRepositoryError("INVALID_CURSOR", "Record cursor does not match this query", 400);
      }
      conditions.push("(r.updated_at < ? OR (r.updated_at = ? AND r.id < ?))");
      bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    const result = await this.db.prepare(
      `SELECT DISTINCT r.${RECORD_COLUMNS.split(", ").join(", r.")}
       FROM database_records r
       JOIN record_values v ON v.workspace_id = r.workspace_id AND v.record_id = r.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY r.updated_at DESC, r.id DESC LIMIT ?`,
    ).bind(...bindings, limit + 1).all<RecordRow>();
    const rows = result.results ?? [];
    const items = await this.materialize(rows.slice(0, limit), fields.readable);
    return { items, next_cursor: rows.length > limit && items.length > 0 ? encodeRecordCursor(items[items.length - 1]!, undefined, fingerprint) : null };
  }

  async updateRecord(context: WorkspaceContext, databaseId: string, recordId: string, input: UpdateDatabaseRecordInput) {
    const result = await this.bulkEditRecords(context, databaseId, {
      mutations: [{ record_id: recordId, base_revision: input.base_revision, values: input.values }],
    });
    return result.items[0]!;
  }

  async deleteRecord(context: WorkspaceContext, databaseId: string, recordId: string, input: DeleteDatabaseRecordInput) {
    await this.access.assert(context, databaseId, "write");
    const row = (await this.recordRows(context.workspaceId, databaseId, [recordId]))[0];
    if (!row) throw new DatabaseRepositoryError("RECORD_NOT_FOUND", "Database record not found", 404);
    assertRevision(row.revision, input.base_revision);
    const now = this.now();
    const update = this.db.prepare(
      `UPDATE database_records SET deleted_at = ?, note_id = NULL, updated_by = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?`,
    ).bind(now, context.userId, now, context.workspaceId, databaseId, recordId, input.base_revision);
    const operation = this.beginOperation(
      "database_record.delete", context.workspaceId, recordId,
      "EXISTS (SELECT 1 FROM database_records WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL)",
      [context.workspaceId, databaseId, recordId, input.base_revision],
    );
    let results: D1Result[];
    try {
      results = await this.db.batch([
        ...operation.statements,
        update,
        ...this.auditStatements(
          context,
          "database_record.deleted",
          "database_record",
          recordId,
          input.base_revision + 1,
          now,
          this.operationCondition(operation.operationId),
        ),
        this.operationCleanup(operation.operationId),
      ]);
    } catch (error) {
      if (this.isOperationGuardError(error)) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
      throw error;
    }
    if (results[operation.statements.length]?.meta.changes !== 1) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
    await this.notifyPresence(context.workspaceId, "database_record", recordId, input.base_revision + 1);
    return { id: recordId };
  }

  async bulkEditRecords(context: WorkspaceContext, databaseId: string, input: BulkEditRecordsInput) {
    const fields = await this.access.fields(context, databaseId, "write");
    const recordIds = input.mutations.map((mutation) => mutation.record_id);
    if (new Set(recordIds).size !== recordIds.length) {
      throw new DatabaseRepositoryError("DUPLICATE_RECORD_MUTATION", "A record may only appear once per bulk edit", 400);
    }
    const rows = await this.recordRows(context.workspaceId, databaseId, recordIds);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const prepared = [] as Array<{ mutation: BulkEditRecordsInput["mutations"][number]; values: Record<string, unknown> }>;
    const referenceCollector = this.referenceCollector(fields.properties);
    for (const mutation of input.mutations) {
      const row = byId.get(mutation.record_id);
      if (!row) throw new DatabaseRepositoryError("RECORD_NOT_FOUND", "Database record not found", 404);
      assertRevision(row.revision, mutation.base_revision);
      const values = this.normalize(fields.properties, mutation.values, fields.writable);
      referenceCollector.add(values);
      prepared.push({ mutation, values });
    }
    const references = referenceCollector.items();
    await this.validateReferenceItems(context, references);
    const now = this.now();
    const expected = prepared.map(({ mutation }) => ({ record_id: mutation.record_id, revision: mutation.base_revision }));
    const requestId = (context as WorkspaceContext & { requestId?: string }).requestId;
    const operation = requestId ? this.beginOperation(
        "database_record.update", context.workspaceId, databaseId,
        `NOT EXISTS (
           SELECT 1 FROM json_each(?) expected
           WHERE NOT EXISTS (
             SELECT 1 FROM database_records
             WHERE workspace_id = ? AND database_id = ? AND id = json_extract(expected.value, '$.record_id')
               AND revision = json_extract(expected.value, '$.revision') AND deleted_at IS NULL
           )
         )`,
        [JSON.stringify(expected), context.workspaceId, databaseId],
      ) : null;
    const valueRows = prepared.flatMap((item) => Object.entries(item.values).map(([property_id, value]) => ({
      id: this.id(), record_id: item.mutation.record_id, property_id, value_json: JSON.stringify(value),
    })));
    const statements: D1PreparedStatement[] = [...(operation?.statements ?? []), revisionGuard(this.db, context, databaseId, expected)];
    statements.push(...this.referenceGuards(context, references));
    statements.push(this.db.prepare(
      `UPDATE database_records SET updated_by = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND database_id = ? AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM json_each(?) AS expected_record
           WHERE json_extract(expected_record.value, '$.record_id') = database_records.id
             AND json_extract(expected_record.value, '$.revision') = database_records.revision
         )`,
    ).bind(context.userId, now, context.workspaceId, databaseId, JSON.stringify(expected)));
    statements.push(revisionGuard(
      this.db, context, databaseId,
      expected.map((item) => ({ ...item, revision: item.revision + 1 })),
    ));
    statements.push(...splitJsonBatches(valueRows).map((rows) => this.db.prepare(
      `INSERT INTO record_values
       (id, workspace_id, database_id, record_id, property_id, value_json, revision, updated_at)
       SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.record_id'), json_extract(value, '$.property_id'),
         json_extract(value, '$.value_json'), 1, ? FROM json_each(?) WHERE 1
       ON CONFLICT(record_id, property_id) DO UPDATE SET
         value_json = excluded.value_json, revision = record_values.revision + 1, updated_at = excluded.updated_at`,
    ).bind(context.workspaceId, databaseId, now, JSON.stringify(rows))));
    for (const { mutation } of prepared) {
      statements.push(...this.auditStatements(
        context,
        "database_record.updated",
        "database_record",
        mutation.record_id,
        mutation.base_revision + 1,
        now,
        operation ? this.operationCondition(operation.operationId) : undefined,
      ));
    }
    statements.push(...this.referenceGuards(context, references));
    if (operation) statements.push(this.operationCleanup(operation.operationId));
    try {
      await this.db.batch(statements);
    } catch (error) {
      const referenceFailure = this.referenceGuardFailure(error, references);
      if (referenceFailure) throw referenceFailure;
      if (isRecordRevisionGuardError(error) || this.isOperationGuardError(error)) {
        throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
      }
      throw error;
    }
    for (const { mutation } of prepared) {
      await this.notifyPresence(context.workspaceId, "database_record", mutation.record_id, mutation.base_revision + 1);
    }
    const updatedRows = await this.recordRows(context.workspaceId, databaseId, recordIds);
    return { items: await this.materialize(updatedRows, fields.readable) };
  }

  async boardMove(context: WorkspaceContext, databaseId: string, input: BoardMoveInput) {
    const fields = await this.access.fields(context, databaseId, "write");
    const property = this.access.findProperty(fields.properties, input.property_id);
    if (property.type !== "select") {
      throw new DatabaseRepositoryError("INVALID_BOARD_PROPERTY", "Board grouping requires a select property", 400);
    }
    return this.updateRecord(context, databaseId, input.record_id, {
      base_revision: input.base_revision,
      values: { [input.property_id]: input.option_id },
    });
  }

  async calendarAssign(context: WorkspaceContext, databaseId: string, input: CalendarAssignmentInput) {
    const fields = await this.access.fields(context, databaseId, "write");
    const property = this.access.findProperty(fields.properties, input.property_id);
    if (property.type !== "date") {
      throw new DatabaseRepositoryError("INVALID_CALENDAR_PROPERTY", "Calendar assignment requires a date property", 400);
    }
    return this.updateRecord(context, databaseId, input.record_id, {
      base_revision: input.base_revision,
      values: { [input.property_id]: input.date },
    });
  }
}
