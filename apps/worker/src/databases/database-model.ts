import type {
  Database,
  DatabaseComment,
  DatabaseProperty,
  DatabaseRecord,
  DatabaseTemplate,
  DatabaseView,
} from "@nexus/contracts";
import { DatabaseValueError } from "@nexus/domain";

export interface DatabaseRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  created_by: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface PropertyRow {
  id: string;
  workspace_id: string;
  database_id: string;
  name: string;
  type: DatabaseProperty["type"];
  config_json: string;
  position: number;
  is_hidden: number;
  is_read_only: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface RecordRow {
  id: string;
  workspace_id: string;
  database_id: string;
  note_id: string | null;
  created_by: string;
  updated_by: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface RecordValueRow {
  record_id: string;
  property_id: string;
  value_json: string;
}

export interface ViewRow {
  id: string;
  workspace_id: string;
  database_id: string;
  name: string;
  type: DatabaseView["type"];
  config_json: string;
  position: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface TemplateRow {
  id: string;
  workspace_id: string;
  database_id: string;
  name: string;
  default_values_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface CommentRow {
  id: string;
  workspace_id: string;
  entity_id: string;
  author_user_id: string;
  parent_id: string | null;
  body: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export const DATABASE_COLUMNS = "id, workspace_id, name, description, created_by, revision, created_at, updated_at";
export const PROPERTY_COLUMNS = "id, workspace_id, database_id, name, type, config_json, position, is_hidden, is_read_only, revision, created_at, updated_at";
export const RECORD_COLUMNS = "id, workspace_id, database_id, note_id, created_by, updated_by, revision, created_at, updated_at";
export const VIEW_COLUMNS = "id, workspace_id, database_id, name, type, config_json, position, revision, created_at, updated_at";
export const TEMPLATE_COLUMNS = "id, workspace_id, database_id, name, default_values_json, revision, created_at, updated_at";
export const COMMENT_COLUMNS = "id, workspace_id, entity_id, author_user_id, parent_id, body, revision, created_at, updated_at";

export class DatabaseRepositoryError extends Error {
  readonly retryable = false;

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DatabaseRepositoryError";
  }
}

export function fromValueError(error: unknown): never {
  if (error instanceof DatabaseValueError) {
    throw new DatabaseRepositoryError(error.code, error.message, 400, { property_id: error.propertyId });
  }
  throw error;
}

export function parseJsonObject(value: string, code = "CORRUPT_DATABASE_DATA") {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new DatabaseRepositoryError(code, "Stored database JSON is invalid", 500);
  }
}

export function toDatabase(row: DatabaseRow): Database {
  return row;
}

export function toProperty(row: PropertyRow): DatabaseProperty {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    database_id: row.database_id,
    name: row.name,
    type: row.type,
    config: parseJsonObject(row.config_json),
    position: row.position,
    hidden: Boolean(row.is_hidden),
    read_only: Boolean(row.is_read_only),
    revision: row.revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toRecord(row: RecordRow, values: Record<string, unknown>): DatabaseRecord {
  return { ...row, values };
}

export function toView(row: ViewRow): DatabaseView {
  return { ...row, config: parseJsonObject(row.config_json) as DatabaseView["config"] };
}

export function toTemplate(row: TemplateRow): DatabaseTemplate {
  return { ...row, default_values: parseJsonObject(row.default_values_json) };
}

export function toComment(row: CommentRow, databaseId: string): DatabaseComment {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    database_id: databaseId,
    record_id: row.entity_id,
    author_user_id: row.author_user_id,
    parent_id: row.parent_id,
    body: row.body,
    revision: row.revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function cursorFingerprint(value: unknown) {
  const source = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1-${(hash >>> 0).toString(16)}`;
}

export function encodeRecordCursor(
  record: Pick<DatabaseRecord, "updated_at" | "id">,
  sortValues?: readonly unknown[],
  fingerprint?: string,
) {
  if (sortValues || fingerprint) {
    return encodeURIComponent(JSON.stringify({
      ...(sortValues ? { sort_values: sortValues } : {}),
      ...(fingerprint ? { fingerprint } : {}),
      updated_at: record.updated_at,
      id: record.id,
    }));
  }
  return encodeURIComponent(`${record.updated_at}\n${record.id}`);
}

export function decodeRecordCursor(cursor: string) {
  try {
    const decoded = decodeURIComponent(cursor);
    if (decoded.startsWith("{")) {
      const parsed = JSON.parse(decoded) as { sort_values?: unknown; fingerprint?: unknown; updated_at?: unknown; id?: unknown };
      if ((parsed.sort_values !== undefined && !Array.isArray(parsed.sort_values)) || (parsed.fingerprint !== undefined && typeof parsed.fingerprint !== "string") || typeof parsed.updated_at !== "string" || typeof parsed.id !== "string") throw new Error("invalid");
      return { updatedAt: parsed.updated_at, id: parsed.id, sortValues: parsed.sort_values as unknown[] | undefined, fingerprint: parsed.fingerprint as string | undefined };
    }
    const separator = decoded.indexOf("\n");
    if (separator <= 0 || separator === decoded.length - 1) throw new Error("invalid");
    return { updatedAt: decoded.slice(0, separator), id: decoded.slice(separator + 1) };
  } catch {
    throw new DatabaseRepositoryError("INVALID_CURSOR", "Record cursor is invalid", 400);
  }
}

export function placeholders(length: number) {
  return Array.from({ length }, () => "?").join(", ");
}

export function isUniqueGuardError(error: unknown, signature: "workspaces.id" | "workspaces.slug" | "users.email" | "database_records.id" | "databases.id") {
  return error instanceof Error && new RegExp(`(?:^|: )UNIQUE constraint failed: ${signature.replace(".", "\\.")}(?=:|$)`).test(error.message);
}
