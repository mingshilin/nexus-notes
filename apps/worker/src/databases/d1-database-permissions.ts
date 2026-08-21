import type {
  DatabasePermission,
  FieldPermission,
  SetDatabasePermissionInput,
  SetFieldPermissionInput,
  WorkspaceContext,
} from "@nexus/contracts";

import { assertRevision, DatabaseRepositoryBase } from "./database-repository-base";
import { DatabaseRepositoryError } from "./database-model";

export class D1DatabasePermissionRepository extends DatabaseRepositoryBase {
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
    await this.db.prepare(
      `INSERT INTO database_permissions
       (id, workspace_id, database_id, subject_type, subject_id, can_read, can_write, revision, updated_at, access_level)
       VALUES (?, ?, ?, ?, ?, 1, ?, 1, ?, ?)
       ON CONFLICT(database_id, subject_type, subject_id) DO UPDATE SET
         can_read = 1, can_write = excluded.can_write, access_level = excluded.access_level,
         revision = database_permissions.revision + 1, updated_at = excluded.updated_at`,
    ).bind(id, context.workspaceId, databaseId, input.subject_type, input.subject_id, Number(input.role !== "viewer"), now, input.role).run();
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
    await this.db.prepare(
      `INSERT INTO field_permissions
       (id, workspace_id, database_id, property_id, subject_type, subject_id, can_read, can_write, revision, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(property_id, subject_type, subject_id) DO UPDATE SET
         can_read = excluded.can_read, can_write = excluded.can_write,
         revision = field_permissions.revision + 1, updated_at = excluded.updated_at`,
    ).bind(id, context.workspaceId, databaseId, propertyId, input.subject_type, input.subject_id, Number(input.can_read), Number(input.can_write), now).run();
    const permission: FieldPermission = {
      id, workspace_id: context.workspaceId, database_id: databaseId, property_id: propertyId,
      subject_type: input.subject_type, subject_id: input.subject_id,
      can_read: input.can_read, can_write: input.can_write,
      revision: current ? current.revision + 1 : 1, updated_at: now,
    };
    return permission;
  }
}
