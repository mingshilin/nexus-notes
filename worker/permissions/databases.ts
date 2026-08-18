import {
  getDatabaseById,
  getDatabaseFieldPermission,
  getDatabasePropertyById,
  listDatabasePermissions,
  type DatabasePermissionRow,
} from "../db/queries";
import { HttpError } from "../http";

export type WorkspaceRole = "owner" | "editor" | "viewer";
export type DatabaseAccessRole = "admin" | "editor" | "viewer";

export interface DatabasePermissionContext {
  db: D1Database;
  workspaceId: string;
  databaseId: string;
  userId: string;
  workspaceRole: WorkspaceRole;
}

export interface FieldPermissionContext extends DatabasePermissionContext {
  propertyId: string;
}

function inheritedDatabaseRole(workspaceRole: WorkspaceRole): DatabaseAccessRole {
  if (workspaceRole === "owner") return "admin";
  if (workspaceRole === "editor") return "editor";
  return "viewer";
}

function resolveExplicitDatabaseRole(
  permissions: DatabasePermissionRow[],
  userId: string,
  workspaceRole: WorkspaceRole,
) {
  return permissions.find((permission) => permission.subject_type === "member" && permission.subject_id === userId)?.role
    ?? permissions.find((permission) => permission.subject_type === "workspace_role" && permission.subject_id === workspaceRole)?.role
    ?? (permissions.length === 0 ? inheritedDatabaseRole(workspaceRole) : null);
}

async function resolveDatabaseAccessRole(context: DatabasePermissionContext) {
  const database = await getDatabaseById(context.db, context.workspaceId, context.databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");
  if (context.workspaceRole === "owner") return { database, role: "admin" as const };
  const permissions = await listDatabasePermissions(context.db, context.workspaceId, context.databaseId);
  return { database, role: resolveExplicitDatabaseRole(permissions, context.userId, context.workspaceRole) };
}

export async function assertDatabaseReadable(context: DatabasePermissionContext) {
  const access = await resolveDatabaseAccessRole(context);
  if (!access.role) {
    throw new HttpError(403, "FORBIDDEN", "database read permission required");
  }
  return access;
}

export async function assertDatabaseWritable(context: DatabasePermissionContext) {
  const access = await resolveDatabaseAccessRole(context);
  if (access.role !== "admin" && access.role !== "editor") {
    throw new HttpError(403, "FORBIDDEN", "database write permission required");
  }
  return access;
}

export async function assertFieldReadable(context: FieldPermissionContext) {
  await assertDatabaseReadable(context);
  const property = await getDatabasePropertyById(context.db, context.workspaceId, context.databaseId, context.propertyId);
  if (!property) throw new HttpError(404, "NOT_FOUND", "database property not found");
  if (context.workspaceRole === "owner") return { property };
  const permission = await getDatabaseFieldPermission(context.db, context.workspaceId, context.databaseId, context.propertyId);
  if (!permission.viewer_roles.includes(context.workspaceRole)) {
    throw new HttpError(403, "FORBIDDEN", "field read permission required");
  }
  return { property };
}

export async function assertFieldWritable(context: FieldPermissionContext) {
  await assertDatabaseWritable(context);
  const property = await getDatabasePropertyById(context.db, context.workspaceId, context.databaseId, context.propertyId);
  if (!property) throw new HttpError(404, "NOT_FOUND", "database property not found");
  if (context.workspaceRole === "owner") return { property };
  const permission = await getDatabaseFieldPermission(context.db, context.workspaceId, context.databaseId, context.propertyId);
  if (!permission.editor_roles.includes(context.workspaceRole)) {
    throw new HttpError(403, "FORBIDDEN", "field write permission required");
  }
  return { property };
}
