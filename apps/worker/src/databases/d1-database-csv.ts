import type {
  CsvExportInput,
  CsvImportInput,
  DatabaseProperty,
  DatabaseRecord,
  WorkspaceContext,
} from "@nexus/contracts";
import { DatabaseCsvError, parseDatabaseCsv, serializeDatabaseCsv } from "@nexus/domain";

import { DatabaseRepositoryBase } from "./database-repository-base";
import { DatabaseRepositoryError } from "./database-model";

function coerceCsvValue(property: DatabaseProperty, value: string): unknown {
  if (value === "") return null;
  switch (property.type) {
    case "number": {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }
    case "checkbox":
      if (/^(true|1|yes)$/iu.test(value)) return true;
      if (/^(false|0|no)$/iu.test(value)) return false;
      return value;
    case "multi_select":
    case "member":
    case "relation":
      return value.split(";").map((item) => item.trim()).filter(Boolean);
    default:
      return value;
  }
}

function displayCsvValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(";");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

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

export class D1DatabaseCsvRepository extends DatabaseRepositoryBase {
  async importCsv(context: WorkspaceContext, databaseId: string, input: CsvImportInput) {
    const fields = await this.access.fields(context, databaseId, "write");
    let parsed: ReturnType<typeof parseDatabaseCsv>;
    try {
      parsed = parseDatabaseCsv(input.csv, { maxBytes: 2 * 1024 * 1024, maxRows: 500 });
    } catch (error) {
      if (error instanceof DatabaseCsvError) throw new DatabaseRepositoryError(error.code, error.message, 400);
      throw error;
    }
    const mapped = parsed.headers.map((header) => {
      const propertyId = input.header_property_ids[header];
      if (!propertyId) throw new DatabaseRepositoryError("CSV_UNKNOWN_PROPERTY", `CSV header ${header} is not mapped`, 400);
      const property = this.access.findProperty(fields.properties, propertyId);
      if (!fields.writable.has(property.id)) throw new DatabaseRepositoryError("FIELD_WRITE_DENIED", "CSV field write denied", 403, { property_id: property.id });
      return property;
    });
    if (new Set(mapped.map((property) => property.id)).size !== mapped.length) {
      throw new DatabaseRepositoryError("CSV_DUPLICATE_PROPERTY", "CSV headers map to duplicate properties", 400);
    }
    const normalizedRows: Record<string, unknown>[] = [];
    for (const row of parsed.rows) {
      const values = this.normalize(
        fields.properties,
        Object.fromEntries(mapped.map((property, index) => [property.id, coerceCsvValue(property, row[index] ?? "")])),
        fields.writable,
      );
      normalizedRows.push(values);
    }
    const references = this.referenceItems(fields.properties, normalizedRows);
    await this.validateReferenceItems(context, references);
    const now = this.now();
    const records = normalizedRows.map((values) => ({
      id: this.id(), workspace_id: context.workspaceId, database_id: databaseId, note_id: null,
      values, created_by: context.userId, updated_by: context.userId,
      revision: 1, created_at: now, updated_at: now,
    } satisfies DatabaseRecord));
    const recordRows = records.map((record) => ({
      id: record.id, workspace_id: record.workspace_id, database_id: record.database_id, note_id: record.note_id,
      created_by: record.created_by, updated_by: record.updated_by, created_at: record.created_at, updated_at: record.updated_at,
    }));
    const valueRows = records.flatMap((record) => Object.entries(record.values).map(([propertyId, value]) => ({
      id: this.id(), workspace_id: record.workspace_id, database_id: record.database_id, record_id: record.id,
      property_id: propertyId, value_json: JSON.stringify(value), updated_at: record.updated_at,
    })));
    const statements: D1PreparedStatement[] = [];
    statements.push(...this.referenceGuards(context, references));
    statements.push(
      ...splitJsonBatches(recordRows).map((rows) => this.db.prepare(
        `INSERT INTO database_records
         (id, workspace_id, database_id, note_id, created_by, updated_by, revision, created_at, updated_at)
         SELECT json_extract(value, '$.id'), json_extract(value, '$.workspace_id'), json_extract(value, '$.database_id'),
           json_extract(value, '$.note_id'), json_extract(value, '$.created_by'), json_extract(value, '$.updated_by'),
           1, json_extract(value, '$.created_at'), json_extract(value, '$.updated_at')
         FROM json_each(?)`,
      ).bind(JSON.stringify(rows))),
      ...splitJsonBatches(valueRows).map((rows) => this.db.prepare(
        `INSERT INTO record_values
         (id, workspace_id, database_id, record_id, property_id, value_json, revision, updated_at)
         SELECT json_extract(value, '$.id'), json_extract(value, '$.workspace_id'), json_extract(value, '$.database_id'),
           json_extract(value, '$.record_id'), json_extract(value, '$.property_id'), json_extract(value, '$.value_json'),
           1, json_extract(value, '$.updated_at')
         FROM json_each(?)`,
      ).bind(JSON.stringify(rows))),
    );
    statements.push(...this.referenceGuards(context, references));
    try {
      if (statements.length > 0) await this.db.batch(statements);
    } catch (error) {
      const referenceFailure = this.referenceGuardFailure(error, references);
      if (referenceFailure) throw referenceFailure;
      throw error;
    }
    return { items: records, imported_count: records.length };
  }

  async exportCsv(context: WorkspaceContext, databaseId: string, input: CsvExportInput) {
    const fields = await this.access.fields(context, databaseId, "read");
    const propertyById = new Map(fields.properties.map((property) => [property.id, property]));
    const properties = input.property_ids
      .filter((propertyId) => fields.readable.has(propertyId))
      .map((propertyId) => propertyById.get(propertyId))
      .filter((property): property is DatabaseProperty => Boolean(property));
    const page = await this.recordPage(context, databaseId, {
      cursor: input.cursor,
      limit: Math.min(input.page_size, 100),
    });
    const rows = [
      ...(input.include_header !== false ? [properties.map((property) => property.name)] : []),
      ...page.items.map((record) => properties.map((property) => displayCsvValue(record.values[property.id]))),
    ];
    return { csv: serializeDatabaseCsv(rows), next_cursor: page.next_cursor };
  }
}
