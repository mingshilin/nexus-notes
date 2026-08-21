import type {
  DatabasePermission,
  DeleteDatabasePermissionInput,
  DeleteFieldPermissionInput,
  FieldPermission,
  SetDatabasePermissionInput,
  SetFieldPermissionInput,
  WorkspaceContext,
} from "@nexus/contracts";

import { assertRevision, DatabaseRepositoryBase } from "./database-repository-base";
import { DatabaseRepositoryError } from "./database-model";

interface DatabasePermissionRow {
  id: string;
  workspace_id: string;
  database_id: string;
  subject_type: DatabasePermission["subject_type"];
  subject_id: string;
  access_level: DatabasePermission["role"];
  revision: number;
  updated_at: string;
}

interface FieldPermissionRow {
  id: string;
  workspace_id: string;
  database_id: string;
  property_id: string;
  subject_type: FieldPermission["subject_type"];
  subject_id: string;
  can_read: number;
  can_write: number;
  revision: number;
  updated_at: string;
}

function toDatabasePermission(row: DatabasePermissionRow): DatabasePermission {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    database_id: row.database_id,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    role: row.access_level,
    revision: row.revision,
    updated_at: row.updated_at,
  };
}

function toFieldPermission(row: FieldPermissionRow): FieldPermission {
  return { ...row, can_read: Boolean(row.can_read), can_write: Boolean(row.can_write) };
}

export class D1DatabasePermissionRepository extends DatabaseRepositoryBase {
  async listDatabasePermissions(context: WorkspaceContext, databaseId: string) {
    await this.access.assert(context, databaseId, "manage");
    const result = await this.db.prepare(
      `SELECT id, workspace_id, database_id, subject_type, subject_id, access_level, revision, updated_at
       FROM database_permissions
       WHERE workspace_id = ? AND database_id = ?
       ORDER BY subject_type, subject_id, id`,
    ).bind(context.workspaceId, databaseId).all<DatabasePermissionRow>();
    return (result.results ?? []).map(toDatabasePermission);
  }

  async deleteDatabasePermission(
    context: WorkspaceContext,
    databaseId: string,
    permissionId: string,
    input: DeleteDatabasePermissionInput,
  ) {
    await this.access.assert(context, databaseId, "manage");
    const current = await this.db.prepare(
      `SELECT id, revision FROM database_permissions
       WHERE workspace_id = ? AND database_id = ? AND id = ?`,
    ).bind(context.workspaceId, databaseId, permissionId).first<{ id: string; revision: number }>();
    if (!current) throw new DatabaseRepositoryError("DATABASE_PERMISSION_NOT_FOUND", "Database permission not found", 404);
    assertRevision(current.revision, input.base_revision);
    const result = await this.db.prepare(
      `DELETE FROM database_permissions
       WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?`,
    ).bind(context.workspaceId, databaseId, permissionId, input.base_revision).run();
    if (result.meta.changes === 0) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
    return { id: permissionId };
  }

  async listFieldPermissions(context: WorkspaceContext, databaseId: string, propertyId: string) {
    const fields = await this.access.fields(context, databaseId, "manage");
    this.access.findProperty(fields.properties, propertyId);
    const result = await this.db.prepare(
      `SELECT id, workspace_id, database_id, property_id, subject_type, subject_id, can_read, can_write, revision, updated_at
       FROM field_permissions
       WHERE workspace_id = ? AND database_id = ? AND property_id = ?
       ORDER BY subject_type, subject_id, id`,
    ).bind(context.workspaceId, databaseId, propertyId).all<FieldPermissionRow>();
    return (result.results ?? []).map(toFieldPermission);
  }

  async deleteFieldPermission(
    context: WorkspaceContext,
    databaseId: string,
    propertyId: string,
    permissionId: string,
    input: DeleteFieldPermissionInput,
  ) {
    const fields = await this.access.fields(context, databaseId, "manage");
    this.access.findProperty(fields.properties, propertyId);
    const current = await this.db.prepare(
      `SELECT id, revision FROM field_permissions
       WHERE workspace_id = ? AND database_id = ? AND property_id = ? AND id = ?`,
    ).bind(context.workspaceId, databaseId, propertyId, permissionId).first<{ id: string; revision: number }>();
    if (!current) throw new DatabaseRepositoryError("FIELD_PERMISSION_NOT_FOUND", "Field permission not found", 404);
    assertRevision(current.revision, input.base_revision);
    const result = await this.db.prepare(
      `DELETE FROM field_permissions
       WHERE workspace_id = ? AND database_id = ? AND property_id = ? AND id = ? AND revision = ?`,
    ).bind(context.workspaceId, databaseId, propertyId, permissionId, input.base_revision).run();
    if (result.meta.changes === 0) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
    return { id: permissionId };
  }

  async setDatabasePermission(context: WorkspaceContext, databaseId: string, input: SetDatabasePermissionInput) {
    await this.access.assert(context, databaseId, "manage");
    const current = await this.db.prepare(
      `SELECT id, revision FROM database_permissions
       WHERE workspace_id = ? AND database_id = ? AND subject_type = ? AND subject_id = ?`,
    ).bind(context.workspaceId, databaseId, input.subject_type, input.subject_id).first<{ id: string; revision: number }>();
    if (current) assertRevision(current.revision, input.base_revision);
    else assertRevision(1, input.base_revision);
    const now = this.now();
    const id = current?.id ?? this.id();
    const result = await this.db.prepare(
      `INSERT INTO database_permissions
       (id, workspace_id, database_id, subject_type, subject_id, can_read, can_write, revision, updated_at, access_level)
       VALUES (?, ?, ?, ?, ?, 1, ?, 1, ?, ?)
       ON CONFLICT(database_id, subject_type, subject_id) DO UPDATE SET
         can_read = 1, can_write = excluded.can_write, access_level = excluded.access_level,
         revision = database_permissions.revision + 1, updated_at = excluded.updated_at
       WHERE database_permissions.revision = ?`,
    ).bind(id, context.workspaceId, databaseId, input.subject_type, input.subject_id, Number(input.role !== "viewer"), now, input.role, input.base_revision).run();
    if (result.meta.changes !== 1) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
    const permission: DatabasePermission = {
      id, workspace_id: context.workspaceId, database_id: databaseId,
      subject_type: input.subject_type, subject_id: input.subject_id, role: input.role,
      revision: current ? current.revision + 1 : 1, updated_at: now,
    };
    return permission;
  }

  async setFieldPermission(context: WorkspaceContext, databaseId: string, propertyId: string, input: SetFieldPermissionInput) {
    const fields = await this.access.fields(context, databaseId, "manage");
    this.access.findProperty(fields.properties, propertyId);
    const current = await this.db.prepare(
      `SELECT id, revision FROM field_permissions
       WHERE workspace_id = ? AND database_id = ? AND property_id = ? AND subject_type = ? AND subject_id = ?`,
    ).bind(context.workspaceId, databaseId, propertyId, input.subject_type, input.subject_id).first<{ id: string; revision: number }>();
    if (current) assertRevision(current.revision, input.base_revision);
    else assertRevision(1, input.base_revision);
    if (input.can_write && !input.can_read) throw new DatabaseRepositoryError("INVALID_FIELD_PERMISSION", "Writable fields must be readable", 400);
    const now = this.now();
    const id = current?.id ?? this.id();
    const result = await this.db.prepare(
      `INSERT INTO field_permissions
       (id, workspace_id, database_id, property_id, subject_type, subject_id, can_read, can_write, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(property_id, subject_type, subject_id) DO UPDATE SET
         can_read = excluded.can_read, can_write = excluded.can_write,
         revision = field_permissions.revision + 1, updated_at = excluded.updated_at
       WHERE field_permissions.revision = ?`,
    ).bind(id, context.workspaceId, databaseId, propertyId, input.subject_type, input.subject_id, Number(input.can_read), Number(input.can_write), now, input.base_revision).run();
    if (result.meta.changes !== 1) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
    const permission: FieldPermission = {
      id, workspace_id: context.workspaceId, database_id: databaseId, property_id: propertyId,
      subject_type: input.subject_type, subject_id: input.subject_id,
      can_read: input.can_read, can_write: input.can_write,
      revision: current ? current.revision + 1 : 1, updated_at: now,
    };
    return permission;
  }
}
