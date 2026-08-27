import type { DatabasePermissionRole, DatabaseProperty, WorkspaceContext } from "@nexus/contracts";
import { canUseDatabase, resolveFieldAccess, type DatabaseAction } from "@nexus/domain";

import {
  DATABASE_COLUMNS,
  PROPERTY_COLUMNS,
  DatabaseRepositoryError,
  type DatabaseRow,
  type PropertyRow,
  toDatabase,
  toProperty,
} from "./database-model";

interface PermissionRow {
  subject_type: "user" | "role";
  subject_id: string;
  access_level: DatabasePermissionRole;
}

interface FieldPermissionRow {
  property_id: string;
  subject_type: "user" | "role";
  subject_id: string;
  can_read: number;
  can_write: number;
}

export class D1DatabaseAccess {
  constructor(private readonly db: D1Database) {}

  async database(context: WorkspaceContext, databaseId: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const row = await this.db.prepare(
      `SELECT ${DATABASE_COLUMNS} FROM databases WHERE workspace_id = ? AND id = ? LIMIT 1`,
    ).bind(context.workspaceId, databaseId).first<DatabaseRow>();
    signal?.throwIfAborted();
    if (!row) throw new DatabaseRepositoryError("DATABASE_NOT_FOUND", "Database not found", 404);
    return toDatabase(row);
  }

  async role(context: WorkspaceContext, databaseId: string, signal?: AbortSignal): Promise<DatabasePermissionRole> {
    const database = await this.database(context, databaseId, signal);
    if (context.role === "owner" || database.created_by === context.userId) return "owner";
    const result = await this.db.prepare(
      `SELECT subject_type, subject_id, access_level
       FROM database_permissions
       WHERE workspace_id = ? AND database_id = ?
         AND ((subject_type = 'user' AND subject_id = ?) OR (subject_type = 'role' AND subject_id = ?))`,
    ).bind(context.workspaceId, databaseId, context.userId, context.role).all<PermissionRow>();
    signal?.throwIfAborted();
    const rows = result.results ?? [];
    const direct = rows.find((row) => row.subject_type === "user" && row.subject_id === context.userId);
    const inherited = rows.find((row) => row.subject_type === "role" && row.subject_id === context.role);
    return direct?.access_level ?? inherited?.access_level ?? context.role;
  }

  async assert(context: WorkspaceContext, databaseId: string, action: DatabaseAction, signal?: AbortSignal) {
    const database = await this.database(context, databaseId, signal);
    const role = await this.role(context, databaseId, signal);
    if (!canUseDatabase(role, action)) {
      const code = action === "read" ? "DATABASE_READ_DENIED" : action === "write" ? "DATABASE_WRITE_DENIED" : "DATABASE_MANAGE_DENIED";
      throw new DatabaseRepositoryError(code, "Database permission denied", 403);
    }
    return { database, role };
  }

  async fields(context: WorkspaceContext, databaseId: string, action: DatabaseAction = "read", signal?: AbortSignal) {
    const access = await this.assert(context, databaseId, action, signal);
    const propertyResult = await this.db.prepare(
      `SELECT ${PROPERTY_COLUMNS} FROM database_properties
       WHERE workspace_id = ? AND database_id = ? ORDER BY position, id`,
    ).bind(context.workspaceId, databaseId).all<PropertyRow>();
    signal?.throwIfAborted();
    const properties = (propertyResult.results ?? []).map(toProperty);
    const permissionResult = await this.db.prepare(
      `SELECT property_id, subject_type, subject_id, can_read, can_write
       FROM field_permissions
       WHERE workspace_id = ? AND database_id = ?
         AND ((subject_type = 'user' AND subject_id = ?) OR (subject_type = 'role' AND subject_id = ?))`,
    ).bind(context.workspaceId, databaseId, context.userId, context.role).all<FieldPermissionRow>();
    signal?.throwIfAborted();
    const permissionRows = permissionResult.results ?? [];
    const readable = new Set<string>();
    const writable = new Set<string>();
    for (const property of properties) {
      const direct = permissionRows.find((row) => row.property_id === property.id && row.subject_type === "user" && row.subject_id === context.userId);
      const inherited = permissionRows.find((row) => row.property_id === property.id && row.subject_type === "role" && row.subject_id === context.role);
      const selected = direct ?? inherited;
      const fieldAccess = resolveFieldAccess(access.role, selected ? {
        can_read: Boolean(selected.can_read),
        can_write: Boolean(selected.can_write),
      } : undefined);
      if (!property.hidden && fieldAccess.canRead) readable.add(property.id);
      if (!property.hidden && !property.read_only && fieldAccess.canWrite) writable.add(property.id);
    }
    return { ...access, properties, readable, writable };
  }

  findProperty(properties: readonly DatabaseProperty[], propertyId: string) {
    const property = properties.find((candidate) => candidate.id === propertyId);
    if (!property) throw new DatabaseRepositoryError("PROPERTY_NOT_FOUND", "Database property not found", 404);
    return property;
  }
}
