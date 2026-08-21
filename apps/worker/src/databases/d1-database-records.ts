import type {
  BoardMoveInput,
  BulkEditRecordsInput,
  CalendarAssignmentInput,
  CreateDatabaseRecordInput,
  DatabaseRecord,
  DeleteDatabaseRecordInput,
  UpdateDatabaseRecordInput,
  WorkspaceContext,
} from "@nexus/contracts";

import { assertRevision, DatabaseRepositoryBase } from "./database-repository-base";
import { RECORD_COLUMNS, DatabaseRepositoryError, decodeRecordCursor, encodeRecordCursor, placeholders, type RecordRow } from "./database-model";

function revisionGuard(
  db: D1Database,
  context: WorkspaceContext,
  databaseId: string,
  expected: readonly { record_id: string; revision: number }[],
) {
  const pairPlaceholders = expected.map(() => "(?, ?)").join(", ");
  return db.prepare(
    `INSERT INTO workspaces (id, owner_user_id, slug, name, revision, created_at, updated_at)
     SELECT id, owner_user_id, slug, name, revision, created_at, updated_at
     FROM workspaces
     WHERE id = ? AND (
       NOT EXISTS (SELECT 1 FROM databases WHERE workspace_id = ? AND id = ?)
       OR
       (SELECT COUNT(*) FROM database_records
        WHERE workspace_id = ? AND database_id = ? AND deleted_at IS NULL
          AND (id, revision) IN (${pairPlaceholders}))
       <> ?
     )`,
  ).bind(
    context.workspaceId, context.workspaceId, databaseId, context.workspaceId, databaseId,
    ...expected.flatMap((item) => [item.record_id, item.revision]), expected.length,
  );
}

function isRecordRevisionGuardError(error: unknown) {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed:");
}

export class D1DatabaseRecordRepository extends DatabaseRepositoryBase {
  async createRecord(context: WorkspaceContext, databaseId: string, input: CreateDatabaseRecordInput) {
    const fields = await this.access.fields(context, databaseId, "write");
    const values = this.normalize(fields.properties, input.values ?? {}, fields.writable);
    await this.validateReferences(context, fields.properties, values);
    const now = this.now();
    const record: DatabaseRecord = {
      id: this.id(), workspace_id: context.workspaceId, database_id: databaseId,
      note_id: input.note_id ?? null, values, created_by: context.userId, updated_by: context.userId,
      revision: 1, created_at: now, updated_at: now,
    };
    const statements = this.createRecordStatements(record);
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
    await this.db.batch(statements);
    return record;
  }

  async getRecord(context: WorkspaceContext, databaseId: string, recordId: string) {
    const fields = await this.access.fields(context, databaseId, "read");
    const rows = await this.recordRows(context.workspaceId, databaseId, [recordId]);
    if (rows.length === 0) throw new DatabaseRepositoryError("RECORD_NOT_FOUND", "Database record not found", 404);
    return (await this.materialize(rows, fields.readable))[0]!;
  }

  listRecords(context: WorkspaceContext, databaseId: string, options: { cursor?: string | null; limit: number }) {
    return this.recordPage(context, databaseId, options);
  }

  async searchRecords(context: WorkspaceContext, databaseId: string, options: { query: string; cursor?: string | null; limit: number }) {
    const fields = await this.access.fields(context, databaseId, "read");
    if (fields.readable.size === 0 || !options.query.trim()) return { items: [], next_cursor: null };
    const propertyIds = [...fields.readable];
    const limit = Math.max(1, Math.min(options.limit, 100));
    const conditions = [
      "r.workspace_id = ?", "r.database_id = ?", "r.deleted_at IS NULL",
      `v.property_id IN (${placeholders(propertyIds.length)})`, "v.value_json LIKE ? ESCAPE '\\'",
    ];
    const bindings: unknown[] = [
      context.workspaceId, databaseId, ...propertyIds,
      `%${options.query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`,
    ];
    if (options.cursor) {
      const cursor = decodeRecordCursor(options.cursor);
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
    return { items, next_cursor: rows.length > limit && items.length > 0 ? encodeRecordCursor(items[items.length - 1]!) : null };
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
    const result = await this.db.prepare(
      `UPDATE database_records SET deleted_at = ?, note_id = NULL, updated_by = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?`,
    ).bind(now, context.userId, now, context.workspaceId, databaseId, recordId, input.base_revision).run();
    if (result.meta.changes !== 1) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
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
    for (const mutation of input.mutations) {
      const row = byId.get(mutation.record_id);
      if (!row) throw new DatabaseRepositoryError("RECORD_NOT_FOUND", "Database record not found", 404);
      assertRevision(row.revision, mutation.base_revision);
      const values = this.normalize(fields.properties, mutation.values, fields.writable);
      await this.validateReferences(context, fields.properties, values);
      prepared.push({ mutation, values });
    }
    const now = this.now();
    const expected = prepared.map(({ mutation }) => ({ record_id: mutation.record_id, revision: mutation.base_revision }));
    const statements: D1PreparedStatement[] = [revisionGuard(
      this.db, context, databaseId, expected,
    )];
    for (const item of prepared) {
      statements.push(this.db.prepare(
        `UPDATE database_records SET updated_by = ?, revision = revision + 1, updated_at = ?
         WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?`,
      ).bind(context.userId, now, context.workspaceId, databaseId, item.mutation.record_id, item.mutation.base_revision));
    }
    statements.push(revisionGuard(
      this.db, context, databaseId,
      expected.map((item) => ({ ...item, revision: item.revision + 1 })),
    ));
    for (const item of prepared) {
      for (const [propertyId, value] of Object.entries(item.values)) {
        statements.push(this.db.prepare(
          `INSERT INTO record_values
           (id, workspace_id, database_id, record_id, property_id, value_json, revision, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT(record_id, property_id) DO UPDATE SET
             value_json = excluded.value_json, revision = record_values.revision + 1, updated_at = excluded.updated_at`,
        ).bind(this.id(), context.workspaceId, databaseId, item.mutation.record_id, propertyId, JSON.stringify(value), now));
      }
    }
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (!isRecordRevisionGuardError(error)) throw error;
      throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
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
