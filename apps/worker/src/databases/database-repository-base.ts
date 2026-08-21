import type { DatabaseProperty, DatabaseRecord, DatabaseView, WorkspaceContext } from "@nexus/contracts";
import { normalizeDatabaseValues, type DatabaseValueProperty } from "@nexus/domain";

import { D1DatabaseAccess } from "./d1-database-access";
import {
  RECORD_COLUMNS,
  DatabaseRepositoryError,
  cursorFingerprint,
  decodeRecordCursor,
  encodeRecordCursor,
  fromValueError,
  isUniqueGuardError,
  placeholders,
  type RecordRow,
  type RecordValueRow,
  toRecord,
} from "./database-model";

interface ReferenceItem {
  kind: "member" | "relation";
  property_id: string;
  id: string;
  target_database_id?: string;
}

const MAX_REFERENCE_ITEMS = 1_000;

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
    await this.validateReferenceItems(context, this.referenceItems(properties, [values]));
  }

  protected referenceItems(properties: readonly DatabaseProperty[], valuesList: readonly Readonly<Record<string, unknown>>[]) {
    const items = new Map<string, ReferenceItem>();
    for (const values of valuesList) {
      for (const property of properties) {
        if (property.type !== "member" && property.type !== "relation") continue;
        const value = values[property.id];
        const ids = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
        const targetDatabaseId = property.type === "relation" && typeof (property.config as Record<string, unknown>).target_database_id === "string"
          ? (property.config as Record<string, unknown>).target_database_id as string
          : undefined;
        for (const id of ids) {
          const item: ReferenceItem = property.type === "member"
            ? { kind: "member", property_id: property.id, id }
            : { kind: "relation", property_id: property.id, id, target_database_id: targetDatabaseId };
          items.set(`${item.kind}:${item.property_id}:${item.target_database_id ?? ""}:${item.id}`, item);
        }
      }
    }
    if (items.size > MAX_REFERENCE_ITEMS) {
      throw new DatabaseRepositoryError("REFERENCE_LIMIT", "Too many distinct references", 400);
    }
    return [...items.values()];
  }

  protected async validateReferenceItems(context: WorkspaceContext, items: readonly ReferenceItem[]) {
    if (items.length === 0) return;
    const invalid = await this.db.prepare(
      `SELECT json_extract(reference.value, '$.kind') AS kind, json_extract(reference.value, '$.property_id') AS property_id
       FROM json_each(?) AS reference
       WHERE (
         json_extract(reference.value, '$.kind') = 'member'
         AND NOT EXISTS (
           SELECT 1 FROM workspace_members member
           WHERE member.workspace_id = ? AND member.user_id = json_extract(reference.value, '$.id')
         )
       ) OR (
         json_extract(reference.value, '$.kind') = 'relation'
         AND NOT EXISTS (
           SELECT 1 FROM database_records relation_record
           JOIN databases relation_database
             ON relation_database.workspace_id = relation_record.workspace_id AND relation_database.id = relation_record.database_id
           WHERE relation_record.workspace_id = ?
             AND relation_record.database_id = json_extract(reference.value, '$.target_database_id')
             AND relation_record.id = json_extract(reference.value, '$.id')
             AND relation_record.deleted_at IS NULL
         )
       )
       LIMIT 1`,
    ).bind(JSON.stringify(items), context.workspaceId, context.workspaceId).first<{ kind: "member" | "relation"; property_id: string }>();
    if (!invalid) return;
    throw this.referenceError(invalid);
  }

  protected referenceError(item: Pick<ReferenceItem, "kind" | "property_id">) {
    return item.kind === "member"
      ? new DatabaseRepositoryError("INVALID_MEMBER_REFERENCE", "Member is not in this workspace", 400, { property_id: item.property_id })
      : new DatabaseRepositoryError("INVALID_RELATION_REFERENCE", "Relation record is not in the target database", 400, { property_id: item.property_id });
  }

  protected referenceGuards(context: WorkspaceContext, items: readonly ReferenceItem[]) {
    const memberItems = items.filter((item) => item.kind === "member");
    const relationItems = items.filter((item) => item.kind === "relation");
    const guards: D1PreparedStatement[] = [];
    if (memberItems.length > 0) guards.push(this.db.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, status, email_verified_at, created_at, updated_at)
       SELECT guard.id, guard.email, guard.password_hash, guard.display_name, guard.status, guard.email_verified_at, guard.created_at, guard.updated_at
       FROM users AS guard
       WHERE guard.id = ? AND EXISTS (
         SELECT 1 FROM json_each(?) AS reference
         WHERE NOT EXISTS (
           SELECT 1 FROM workspace_members member
           WHERE member.workspace_id = ? AND member.user_id = json_extract(reference.value, '$.id')
         )
       )`,
    ).bind(context.userId, JSON.stringify(memberItems), context.workspaceId));
    if (relationItems.length > 0) guards.push(this.db.prepare(
      `INSERT INTO workspaces (id, owner_user_id, slug, name, revision, created_at, updated_at)
       SELECT workspace.id, workspace.owner_user_id, workspace.slug, workspace.name,
         workspace.revision, workspace.created_at, workspace.updated_at
       FROM workspaces AS workspace
       WHERE workspace.id = ? AND EXISTS (
         SELECT 1 FROM json_each(?) AS reference
         WHERE NOT EXISTS (
           SELECT 1 FROM database_records relation_record
           JOIN databases relation_database
             ON relation_database.workspace_id = relation_record.workspace_id AND relation_database.id = relation_record.database_id
           WHERE relation_record.workspace_id = ?
             AND relation_record.database_id = json_extract(reference.value, '$.target_database_id')
             AND relation_record.id = json_extract(reference.value, '$.id')
             AND relation_record.deleted_at IS NULL
         )
       )`,
    ).bind(context.workspaceId, JSON.stringify(relationItems), context.workspaceId));
    return guards;
  }

  protected referenceGuardFailure(error: unknown, items: readonly ReferenceItem[]) {
    if (isUniqueGuardError(error, "users.email")) {
      const member = items.find((item) => item.kind === "member");
      return member ? this.referenceError(member) : null;
    }
    if (isUniqueGuardError(error, "workspaces.slug")) {
      const relation = items.find((item) => item.kind === "relation");
      return relation ? this.referenceError(relation) : null;
    }
    return null;
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
      `SELECT ${RECORD_COLUMNS.split(", ").map((column) => `database_records.${column}`).join(", ")} FROM database_records
       JOIN json_each(?) AS requested ON requested.value = database_records.id
       WHERE database_records.workspace_id = ? AND database_records.database_id = ? AND database_records.deleted_at IS NULL`,
    ).bind(JSON.stringify(recordIds), workspaceId, databaseId).all<RecordRow>();
    return result.results ?? [];
  }

  protected async materialize(rows: readonly RecordRow[], readable: ReadonlySet<string>) {
    if (rows.length === 0) return [];
    const valuesResult = await this.db.prepare(
      `SELECT record_values.record_id, record_values.property_id, record_values.value_json FROM record_values
       JOIN json_each(?) AS requested ON requested.value = record_values.record_id
       WHERE record_values.workspace_id = ?`,
    ).bind(JSON.stringify(rows.map((row) => row.id)), rows[0]!.workspace_id).all<RecordValueRow>();
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
    options: { cursor?: string | null; limit: number; viewConfig?: DatabaseView["config"]; cursorFingerprint?: string },
  ) {
    const fields = await this.access.fields(context, databaseId, "read");
    const config = options.viewConfig;
    const visible = config ? new Set(config.visible_columns.filter((propertyId) => fields.readable.has(propertyId))) : fields.readable;
    const fingerprint = options.cursorFingerprint ?? cursorFingerprint({ databaseId, viewConfig: config ?? null });
    const properties = new Map(fields.properties.map((property) => [property.id, property]));
    const filters = config?.filters.filter((filter) => fields.readable.has(filter.property_id)) ?? [];
    const configuredSorts = config?.sorts.filter((sort) => fields.readable.has(sort.property_id)) ?? [];
    const grouping = config?.grouping && fields.readable.has(config.grouping.property_id) ? config.grouping.property_id : null;
    const sorts = grouping && !configuredSorts.some((sort) => sort.property_id === grouping)
      ? [{ property_id: grouping, direction: "asc" as const }, ...configuredSorts]
      : configuredSorts;
    const limit = Math.max(1, Math.min(options.limit, config?.page_size ?? 100, 100));
    const conditions = ["r.workspace_id = ?", "r.database_id = ?", "r.deleted_at IS NULL"];
    const bindings: unknown[] = [context.workspaceId, databaseId];
    const valueJsonExpression = (propertyId: string) => `(SELECT value_json FROM record_values
      WHERE workspace_id = r.workspace_id AND record_id = r.id AND property_id = '${propertyId.replaceAll("'", "''")}' LIMIT 1)`;
    const valueExpression = (propertyId: string) => `COALESCE(json_extract(${valueJsonExpression(propertyId)}, '$'), '')`;
    for (const filter of filters) {
      const property = properties.get(filter.property_id);
      if (!property) continue;
      const valueJson = valueJsonExpression(filter.property_id);
      const expression = valueExpression(filter.property_id);
      const propertyConfig = property.config as Record<string, unknown>;
      const isArray = property.type === "multi_select" || ((property.type === "member" || property.type === "relation") && propertyConfig.allow_multiple === true);
      if (filter.operator === "is_empty") {
        conditions.push(isArray
          ? `(${valueJson} IS NULL OR json_type(${valueJson}, '$') = 'null' OR json_array_length(${valueJson}) = 0)`
          : `(${valueJson} IS NULL OR json_type(${valueJson}, '$') = 'null' OR ${expression} = '')`);
      } else if (filter.operator === "is_not_empty") {
        conditions.push(isArray
          ? `(${valueJson} IS NOT NULL AND json_type(${valueJson}, '$') <> 'null' AND json_array_length(${valueJson}) > 0)`
          : `(${valueJson} IS NOT NULL AND json_type(${valueJson}, '$') <> 'null' AND ${expression} <> '')`);
      } else if (isArray) {
        const requested = Array.isArray(filter.value)
          ? this.normalize([{ ...property, hidden: false, read_only: false }], { [property.id]: filter.value }, new Set([property.id]))[property.id]
          : this.normalize([{ ...property, hidden: false, read_only: false }], { [property.id]: [filter.value] }, new Set([property.id]))[property.id];
        if (Array.isArray(filter.value) && (filter.operator === "equals" || filter.operator === "not_equals")) {
          if ((requested as unknown[]).length === 0) {
            conditions.push(filter.operator === "equals"
              ? `(${valueJson} IS NULL OR json_type(${valueJson}, '$') = 'null' OR json_array_length(${valueJson}) = 0)`
              : `(${valueJson} IS NOT NULL AND json_type(${valueJson}, '$') <> 'null' AND json_array_length(${valueJson}) > 0)`);
          } else {
            conditions.push(filter.operator === "equals"
              ? `${valueJson} = ?`
              : `(${valueJson} IS NULL OR json_type(${valueJson}, '$') = 'null' OR ${valueJson} <> ?)`);
            bindings.push(JSON.stringify(requested));
          }
        } else {
          const operator = filter.operator === "not_equals" || filter.operator === "not_contains" ? "NOT EXISTS" : "EXISTS";
          conditions.push(`${operator} (SELECT 1 FROM json_each(COALESCE(${valueJson}, '[]')) WHERE value = ?)`);
          bindings.push((requested as unknown[])[0]);
        }
      } else if (filter.operator === "contains" || filter.operator === "not_contains") {
        const operator = filter.operator === "contains" ? "LIKE" : "NOT LIKE";
        conditions.push(`${expression} ${operator} ? ESCAPE '\\'`);
        bindings.push(`%${String(filter.value ?? "").replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
      } else {
        const operator = filter.operator === "equals" ? "="
          : filter.operator === "not_equals" ? "<>"
            : filter.operator === "before" ? "<" : ">";
        const normalized = this.normalize([{ ...property, hidden: false, read_only: false }], { [property.id]: filter.value ?? null }, new Set([property.id]))[property.id];
        if (normalized === null) {
          conditions.push(filter.operator === "equals"
            ? `(${valueJson} IS NULL OR json_type(${valueJson}, '$') = 'null')`
            : filter.operator === "not_equals"
              ? `(${valueJson} IS NOT NULL AND json_type(${valueJson}, '$') <> 'null')`
              : "0");
        } else {
          conditions.push(`${expression} ${operator} ?`);
          bindings.push(normalized);
        }
      }
    }
    if (options.cursor) {
      const cursor = decodeRecordCursor(options.cursor);
      if (cursor.fingerprint !== fingerprint) {
        throw new DatabaseRepositoryError("INVALID_CURSOR", "Record cursor does not match this query", 400);
      }
      if (sorts.length > 0) {
        if (!cursor.sortValues || cursor.sortValues.length !== sorts.length) {
          throw new DatabaseRepositoryError("INVALID_CURSOR", "Record cursor does not match the saved view", 400);
        }
        const keysetConditions: string[] = [];
        for (let index = 0; index < sorts.length; index += 1) {
          const equal = sorts.slice(0, index).map((sort) => `${valueExpression(sort.property_id)} = ?`);
          const direction = sorts[index]!.direction === "asc" ? ">" : "<";
          keysetConditions.push(`(${[...equal, `${valueExpression(sorts[index]!.property_id)} ${direction} ?`].join(" AND ")})`);
          bindings.push(...cursor.sortValues.slice(0, index), cursor.sortValues[index]);
        }
        const equal = sorts.map((sort) => `${valueExpression(sort.property_id)} = ?`);
        keysetConditions.push(`(${[...equal, "(r.updated_at < ? OR (r.updated_at = ? AND r.id < ?))"].join(" AND ")})`);
        bindings.push(...cursor.sortValues, cursor.updatedAt, cursor.updatedAt, cursor.id);
        conditions.push(`(${keysetConditions.join(" OR ")})`);
      } else {
        conditions.push("(r.updated_at < ? OR (r.updated_at = ? AND r.id < ?))");
        bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
      }
    }
    const sortColumns = sorts.map((sort, index) => `${valueExpression(sort.property_id)} AS sort_${index}`);
    const order = [...sorts.map((sort) => `${valueExpression(sort.property_id)} ${sort.direction.toUpperCase()}`), "r.updated_at DESC", "r.id DESC"];
    const result = await this.db.prepare(
      `SELECT ${RECORD_COLUMNS.split(", ").map((column) => `r.${column}`).join(", ")}${sortColumns.length ? `, ${sortColumns.join(", ")}` : ""}
       FROM database_records AS r WHERE ${conditions.join(" AND ")}
       ORDER BY ${order.join(", ")} LIMIT ?`,
    ).bind(...bindings, limit + 1).all<RecordRow>();
    const rows = result.results ?? [];
    const pageRows = rows.slice(0, limit);
    const items = await this.materialize(pageRows, visible);
    return {
      items,
      next_cursor: rows.length > limit && items.length > 0
        ? encodeRecordCursor(items[items.length - 1]!, sorts.length > 0
          ? sorts.map((_, index) => (pageRows[pageRows.length - 1] as unknown as Record<string, unknown>)[`sort_${index}`])
          : undefined, fingerprint)
        : null,
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
