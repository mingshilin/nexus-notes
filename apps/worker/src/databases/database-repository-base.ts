import type { DatabaseProperty, DatabaseRecord, WorkspaceContext } from "@nexus/contracts";
import { normalizeDatabaseValues, type DatabaseValueProperty } from "@nexus/domain";

import { D1DatabaseAccess } from "./d1-database-access";
import {
  RECORD_COLUMNS,
  DatabaseRepositoryError,
  decodeRecordCursor,
  encodeRecordCursor,
  fromValueError,
  placeholders,
  type RecordRow,
  type RecordValueRow,
  toRecord,
} from "./database-model";

export interface D1DatabaseRepositoryOptions {
  createId(): string;
  clock(): Date;
}

const defaultOptions: D1DatabaseRepositoryOptions = {
  createId: () => crypto.randomUUID(),
  clock: () => new Date(),
};

function valuesForDomain(properties: readonly DatabaseProperty[]): DatabaseValueProperty[] {
  return properties.map((property) => ({
    id: property.id,
    type: property.type,
    config: property.config && typeof property.config === "object" && !Array.isArray(property.config)
      ? property.config as Record<string, unknown>
      : {},
    hidden: property.hidden,
    read_only: property.read_only,
  }));
}

function jsonValue(value: string, propertyId: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new DatabaseRepositoryError("CORRUPT_DATABASE_DATA", "Stored record value is invalid", 500, { property_id: propertyId });
  }
}

export function assertRevision(actual: number, expected: number) {
  if (actual !== expected) {
    throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409, {
      expected_revision: expected,
      current_revision: actual,
    });
  }
}

export abstract class DatabaseRepositoryBase {
  protected readonly options: D1DatabaseRepositoryOptions;
  protected readonly access: D1DatabaseAccess;

  constructor(
    protected readonly db: D1Database,
    options: Partial<D1DatabaseRepositoryOptions> = {},
  ) {
    this.options = { ...defaultOptions, ...options };
    this.access = new D1DatabaseAccess(db);
  }

  protected normalize(properties: readonly DatabaseProperty[], values: Record<string, unknown>, writable: ReadonlySet<string>) {
    try {
      return normalizeDatabaseValues(valuesForDomain(properties), values, { writablePropertyIds: writable });
    } catch (error) {
      return fromValueError(error);
    }
  }

  protected async validateReferences(
    context: WorkspaceContext,
    properties: readonly DatabaseProperty[],
    values: Readonly<Record<string, unknown>>,
  ) {
    for (const property of properties) {
      if (property.type !== "member" && property.type !== "relation") continue;
      const value = values[property.id];
      if (value === null || value === undefined) continue;
      const ids = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
      if (ids.length === 0) continue;
      if (property.type === "member") {
        const members = await this.db.prepare(
          `SELECT user_id FROM workspace_members WHERE workspace_id = ? AND user_id IN (${placeholders(ids.length)})`,
        ).bind(context.workspaceId, ...ids).all<{ user_id: string }>();
        if ((members.results ?? []).length !== ids.length) {
          throw new DatabaseRepositoryError("INVALID_MEMBER_REFERENCE", "Member is not in this workspace", 400, { property_id: property.id });
        }
        continue;
      }
      const targetId = (property.config as Record<string, unknown>).target_database_id;
      const target = typeof targetId === "string"
        ? await this.db.prepare("SELECT id FROM databases WHERE workspace_id = ? AND id = ?").bind(context.workspaceId, targetId).first()
        : null;
      if (!target) throw new DatabaseRepositoryError("INVALID_RELATION_TARGET", "Relation target is not in this workspace", 400, { property_id: property.id });
      const records = await this.db.prepare(
        `SELECT id FROM database_records
         WHERE workspace_id = ? AND database_id = ? AND deleted_at IS NULL AND id IN (${placeholders(ids.length)})`,
      ).bind(context.workspaceId, targetId, ...ids).all<{ id: string }>();
      if ((records.results ?? []).length !== ids.length) {
        throw new DatabaseRepositoryError("INVALID_RELATION_REFERENCE", "Relation record is not in the target database", 400, { property_id: property.id });
      }
    }
  }

  protected createRecordStatements(record: DatabaseRecord) {
    const statements: D1PreparedStatement[] = [this.db.prepare(
      `INSERT INTO database_records
       (id, workspace_id, database_id, note_id, created_by, updated_by, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      record.id, record.workspace_id, record.database_id, record.note_id,
      record.created_by, record.updated_by, record.created_at, record.updated_at,
    )];
    for (const [propertyId, value] of Object.entries(record.values)) {
      statements.push(this.db.prepare(
        `INSERT INTO record_values
         (id, workspace_id, database_id, record_id, property_id, value_json, revision, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      ).bind(this.id(), record.workspace_id, record.database_id, record.id, propertyId, JSON.stringify(value), record.updated_at));
    }
    return statements;
  }

  protected async recordRows(workspaceId: string, databaseId: string, recordIds: readonly string[]) {
    if (recordIds.length === 0) return [];
    const result = await this.db.prepare(
      `SELECT ${RECORD_COLUMNS} FROM database_records
       WHERE workspace_id = ? AND database_id = ? AND deleted_at IS NULL AND id IN (${placeholders(recordIds.length)})`,
    ).bind(workspaceId, databaseId, ...recordIds).all<RecordRow>();
    return result.results ?? [];
  }

  protected async materialize(rows: readonly RecordRow[], readable: ReadonlySet<string>) {
    if (rows.length === 0) return [];
    const valuesResult = await this.db.prepare(
      `SELECT record_id, property_id, value_json FROM record_values
       WHERE workspace_id = ? AND record_id IN (${placeholders(rows.length)})`,
    ).bind(rows[0]!.workspace_id, ...rows.map((row) => row.id)).all<RecordValueRow>();
    const byRecord = new Map<string, Record<string, unknown>>();
    for (const value of valuesResult.results ?? []) {
      if (!readable.has(value.property_id)) continue;
      const values = byRecord.get(value.record_id) ?? {};
      values[value.property_id] = jsonValue(value.value_json, value.property_id);
      byRecord.set(value.record_id, values);
    }
    return rows.map((row) => toRecord(row, byRecord.get(row.id) ?? {}));
  }

  protected async recordPage(
    context: WorkspaceContext,
    databaseId: string,
    options: { cursor?: string | null; limit: number },
  ) {
    const fields = await this.access.fields(context, databaseId, "read");
    const limit = Math.max(1, Math.min(options.limit, 100));
    const conditions = ["workspace_id = ?", "database_id = ?", "deleted_at IS NULL"];
    const bindings: unknown[] = [context.workspaceId, databaseId];
    if (options.cursor) {
      const cursor = decodeRecordCursor(options.cursor);
      conditions.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
      bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    const result = await this.db.prepare(
      `SELECT ${RECORD_COLUMNS} FROM database_records WHERE ${conditions.join(" AND ")}
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
    ).bind(...bindings, limit + 1).all<RecordRow>();
    const rows = result.results ?? [];
    const items = await this.materialize(rows.slice(0, limit), fields.readable);
    return {
      items,
      next_cursor: rows.length > limit && items.length > 0 ? encodeRecordCursor(items[items.length - 1]!) : null,
    };
  }

  protected async ensureRecord(workspaceId: string, databaseId: string, recordId: string) {
    if ((await this.recordRows(workspaceId, databaseId, [recordId])).length === 0) {
      throw new DatabaseRepositoryError("RECORD_NOT_FOUND", "Database record not found", 404);
    }
  }

  protected id() {
    return this.options.createId();
  }

  protected now() {
    return this.options.clock().toISOString();
  }
}
