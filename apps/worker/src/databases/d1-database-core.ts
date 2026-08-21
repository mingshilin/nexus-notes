import {
  CreateDatabasePropertyInputSchema,
  type CreateDatabaseInput,
  type CreateDatabasePropertyInput,
  type Database,
  type DatabaseProperty,
  type DeleteDatabaseInput,
  type UpdateDatabaseInput,
  type UpdateDatabasePropertyInput,
  type WorkspaceContext,
} from "@nexus/contracts";

import { assertRevision, DatabaseRepositoryBase } from "./database-repository-base";
import {
  DATABASE_COLUMNS,
  DatabaseRepositoryError,
  type DatabaseRow,
  toDatabase,
} from "./database-model";

export class D1DatabaseCoreRepository extends DatabaseRepositoryBase {
  async listDatabases(context: WorkspaceContext) {
    const result = await this.db.prepare(
      `SELECT ${DATABASE_COLUMNS} FROM databases WHERE workspace_id = ? ORDER BY updated_at DESC, id DESC`,
    ).bind(context.workspaceId).all<DatabaseRow>();
    return (result.results ?? []).map(toDatabase);
  }

  async createDatabase(context: WorkspaceContext, input: CreateDatabaseInput) {
    if (context.role === "viewer") throw new DatabaseRepositoryError("DATABASE_WRITE_DENIED", "Database permission denied", 403);
    const now = this.now();
    const database: Database = {
      id: this.id(), workspace_id: context.workspaceId, name: input.name.trim(),
      description: input.description ?? "", created_by: context.userId,
      revision: 1, created_at: now, updated_at: now,
    };
    await this.db.prepare(
      `INSERT INTO databases (id, workspace_id, name, description, created_by, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(database.id, database.workspace_id, database.name, database.description, database.created_by, now, now).run();
    return database;
  }

  async updateDatabase(context: WorkspaceContext, databaseId: string, input: UpdateDatabaseInput) {
    const { database } = await this.access.assert(context, databaseId, "write");
    assertRevision(database.revision, input.base_revision);
    const name = input.name ?? database.name;
    const description = input.description ?? database.description;
    const now = this.now();
    await this.db.prepare(
      `UPDATE databases SET name = ?, description = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND revision = ?`,
    ).bind(name, description, now, context.workspaceId, databaseId, input.base_revision).run();
    return { ...database, name, description, revision: database.revision + 1, updated_at: now };
  }

  async deleteDatabase(context: WorkspaceContext, databaseId: string, input: DeleteDatabaseInput) {
    const { database } = await this.access.assert(context, databaseId, "manage");
    assertRevision(database.revision, input.base_revision);
    const now = this.now();
    await this.db.batch([
      this.db.prepare(
        `UPDATE notes SET database_id = NULL, revision = revision + 1, updated_at = ?
         WHERE workspace_id = ? AND database_id = ?`,
      ).bind(now, context.workspaceId, databaseId),
      this.db.prepare(
        `UPDATE database_records SET note_id = NULL, revision = revision + 1, updated_at = ?
         WHERE workspace_id = ? AND database_id = ?`,
      ).bind(now, context.workspaceId, databaseId),
      this.db.prepare(
        `UPDATE attachments SET record_id = NULL, revision = revision + 1, updated_at = ?
         WHERE workspace_id = ? AND record_id IN (
           SELECT id FROM database_records WHERE workspace_id = ? AND database_id = ?
         )`,
      ).bind(now, context.workspaceId, context.workspaceId, databaseId),
      this.db.prepare(
        "DELETE FROM databases WHERE workspace_id = ? AND id = ? AND revision = ?",
      ).bind(context.workspaceId, databaseId, input.base_revision),
    ]);
    return { id: databaseId };
  }

  async createProperty(context: WorkspaceContext, databaseId: string, input: CreateDatabasePropertyInput) {
    await this.access.assert(context, databaseId, "write");
    const candidate = {
      ...input, config: input.config ?? {}, position: input.position ?? 0,
      hidden: input.hidden ?? false, read_only: input.read_only ?? false,
    };
    if (!CreateDatabasePropertyInputSchema.safeParse(candidate).success) {
      throw new DatabaseRepositoryError("INVALID_PROPERTY", "Database property is invalid", 400);
    }
    const now = this.now();
    const property: DatabaseProperty = {
      id: this.id(), workspace_id: context.workspaceId, database_id: databaseId,
      name: candidate.name.trim(), type: candidate.type, config: candidate.config,
      position: candidate.position, hidden: candidate.hidden, read_only: candidate.read_only,
      revision: 1, created_at: now, updated_at: now,
    };
    await this.db.prepare(
      `INSERT INTO database_properties
       (id, workspace_id, database_id, name, type, config_json, position, is_hidden, is_read_only, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      property.id, property.workspace_id, property.database_id, property.name, property.type,
      JSON.stringify(property.config), property.position, Number(property.hidden), Number(property.read_only), now, now,
    ).run();
    return property;
  }

  async updateProperty(context: WorkspaceContext, databaseId: string, propertyId: string, input: UpdateDatabasePropertyInput) {
    const fields = await this.access.fields(context, databaseId, "write");
    const property = this.access.findProperty(fields.properties, propertyId);
    assertRevision(property.revision, input.base_revision);
    const candidate = {
      name: input.name ?? property.name, type: property.type, config: input.config ?? property.config,
      position: input.position ?? property.position, hidden: input.hidden ?? property.hidden,
      read_only: input.read_only ?? property.read_only,
    };
    if (!CreateDatabasePropertyInputSchema.safeParse(candidate).success) {
      throw new DatabaseRepositoryError("INVALID_PROPERTY", "Database property is invalid", 400);
    }
    const now = this.now();
    await this.db.prepare(
      `UPDATE database_properties SET name = ?, config_json = ?, position = ?, is_hidden = ?, is_read_only = ?,
       revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?`,
    ).bind(
      candidate.name, JSON.stringify(candidate.config), candidate.position, Number(candidate.hidden), Number(candidate.read_only),
      now, context.workspaceId, databaseId, propertyId, input.base_revision,
    ).run();
    return { ...property, ...candidate, revision: property.revision + 1, updated_at: now };
  }

  async deleteProperty(context: WorkspaceContext, databaseId: string, propertyId: string, input: { base_revision: number }) {
    const fields = await this.access.fields(context, databaseId, "write");
    const property = this.access.findProperty(fields.properties, propertyId);
    assertRevision(property.revision, input.base_revision);
    await this.db.prepare(
      "DELETE FROM database_properties WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?",
    ).bind(context.workspaceId, databaseId, propertyId, input.base_revision).run();
    return { id: propertyId };
  }
}
