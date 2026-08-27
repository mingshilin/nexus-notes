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
  async listDatabases(context: WorkspaceContext, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const result = await this.db.prepare(
      `SELECT ${DATABASE_COLUMNS} FROM databases WHERE workspace_id = ? ORDER BY updated_at DESC, id DESC`,
    ).bind(context.workspaceId).all<DatabaseRow>();
    signal?.throwIfAborted();
    return (result.results ?? []).map(toDatabase);
  }

  async getStats(context: WorkspaceContext, databaseId: string) {
    const fields = await this.access.fields(context, databaseId, "read");
    const count = async (table: string) => {
      const row = await this.db.prepare(
        `SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ? AND database_id = ?`,
      ).bind(context.workspaceId, databaseId).first<{ count: number }>();
      return Number(row?.count ?? 0);
    };
    const commentCountPromise = this.db.prepare(
      `SELECT COUNT(*) AS count
       FROM comments c
       INNER JOIN database_records r
         ON r.workspace_id = c.workspace_id AND r.id = c.entity_id
       WHERE c.workspace_id = ? AND r.database_id = ?
         AND c.entity_type = 'database_record' AND c.deleted_at IS NULL`,
    ).bind(context.workspaceId, databaseId).first<{ count: number }>()
      .then((row) => Number(row?.count ?? 0));
    const [recordCount, viewCount, templateCount, commentCount] = await Promise.all([
      count("database_records"),
      count("database_views"),
      count("database_templates"),
      commentCountPromise,
    ]);
    const permissionCounts = fields.role === "owner" ? await Promise.all([
      count("database_permissions"),
      count("field_permissions"),
    ]) : [null, null] as const;
    return {
      record_count: recordCount,
      property_count: fields.readable.size,
      view_count: viewCount,
      template_count: templateCount,
      comment_count: commentCount,
      updated_at: fields.database.updated_at,
      role: fields.role,
      database_permission_count: permissionCounts[0],
      field_permission_count: permissionCounts[1],
    };
  }

  async createDatabase(context: WorkspaceContext, input: CreateDatabaseInput) {
    if (context.role === "viewer") throw new DatabaseRepositoryError("DATABASE_WRITE_DENIED", "Database permission denied", 403);
    const now = this.now();
    const database: Database = {
      id: this.id(), workspace_id: context.workspaceId, name: input.name.trim(),
      description: input.description ?? "", created_by: context.userId,
      revision: 1, created_at: now, updated_at: now,
    };
    const insert = this.db.prepare(
      `INSERT INTO databases (id, workspace_id, name, description, created_by, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(database.id, database.workspace_id, database.name, database.description, database.created_by, now, now);
    const operation = this.beginOperation("database.create", context.workspaceId, database.id, "1 = 1");
    await this.db.batch([
      ...operation.statements,
      insert,
      ...this.auditStatements(context, "database.created", "database", database.id, 1, now, this.operationCondition(operation.operationId)),
      this.operationCleanup(operation.operationId),
    ]);
    await this.notifyPresence(context.workspaceId, "database", database.id, database.revision);
    return database;
  }

  async updateDatabase(context: WorkspaceContext, databaseId: string, input: UpdateDatabaseInput) {
    const { database } = await this.access.assert(context, databaseId, "write");
    assertRevision(database.revision, input.base_revision);
    const name = input.name ?? database.name;
    const description = input.description ?? database.description;
    const now = this.now();
    const update = this.db.prepare(
      `UPDATE databases SET name = ?, description = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND revision = ?`,
    ).bind(name, description, now, context.workspaceId, databaseId, input.base_revision);
    const operation = this.beginOperation(
      "database.update", context.workspaceId, databaseId,
      "EXISTS (SELECT 1 FROM databases WHERE workspace_id = ? AND id = ? AND revision = ?)",
      [context.workspaceId, databaseId, input.base_revision],
    );
    let results: D1Result[];
    try {
      results = await this.db.batch([
      ...operation.statements,
      update,
      ...this.auditStatements(
        context,
        "database.updated",
        "database",
        databaseId,
        input.base_revision + 1,
        now,
        this.operationCondition(operation.operationId),
      ),
      this.operationCleanup(operation.operationId),
      ]);
    } catch (error) {
      if (this.isOperationGuardError(error)) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
      throw error;
    }
    if (results[operation.statements.length]?.meta.changes === 0) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
    const updated = { ...database, name, description, revision: database.revision + 1, updated_at: now };
    await this.notifyPresence(context.workspaceId, "database", databaseId, updated.revision);
    return updated;
  }

  async deleteDatabase(context: WorkspaceContext, databaseId: string, input: DeleteDatabaseInput) {
    const { database } = await this.access.assert(context, databaseId, "manage");
    assertRevision(database.revision, input.base_revision);
    const now = this.now();
    const operation = this.beginOperation(
      "database.delete", context.workspaceId, databaseId,
      "EXISTS (SELECT 1 FROM databases WHERE workspace_id = ? AND id = ? AND revision = ?)",
      [context.workspaceId, databaseId, input.base_revision],
    );
    const deleteStatement = this.db.prepare(
      "DELETE FROM databases WHERE workspace_id = ? AND id = ? AND revision = ?",
    ).bind(context.workspaceId, databaseId, input.base_revision);
    const statements: D1PreparedStatement[] = [
      ...operation.statements,
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
      deleteStatement,
      this.operationAbortWhen(
        "EXISTS (SELECT 1 FROM databases WHERE workspace_id = ? AND id = ?)",
        [context.workspaceId, databaseId],
      ),
      ...this.auditStatements(
        context,
        "database.deleted",
        "database",
        databaseId,
        input.base_revision + 1,
        now,
        this.operationCondition(operation.operationId),
      ),
      this.operationCleanup(operation.operationId),
    ];
    try {
      const results = await this.db.batch(statements);
      if (results[statements.indexOf(deleteStatement)]?.meta.changes === 0) {
        throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
      }
    } catch (error) {
      if (this.isOperationGuardError(error)) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
      throw error;
    }
    await this.notifyPresence(context.workspaceId, "database", databaseId, input.base_revision + 1);
    return { id: databaseId };
  }

  async createProperty(context: WorkspaceContext, databaseId: string, input: CreateDatabasePropertyInput) {
    await this.access.assert(context, databaseId, "manage");
    const candidate = {
      ...input, config: input.config ?? {}, position: input.position ?? 0,
      hidden: input.hidden ?? false, read_only: input.read_only ?? false,
    };
    if (!CreateDatabasePropertyInputSchema.safeParse(candidate).success) {
      throw new DatabaseRepositoryError("INVALID_PROPERTY", "Database property is invalid", 400);
    }
    await this.assertRelationTarget(context, candidate);
    const now = this.now();
    const property: DatabaseProperty = {
      id: this.id(), workspace_id: context.workspaceId, database_id: databaseId,
      name: candidate.name.trim(), type: candidate.type, config: candidate.config,
      position: candidate.position, hidden: candidate.hidden, read_only: candidate.read_only,
      revision: 1, created_at: now, updated_at: now,
    };
    const insert = this.db.prepare(
      `INSERT INTO database_properties
       (id, workspace_id, database_id, name, type, config_json, position, is_hidden, is_read_only, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      property.id, property.workspace_id, property.database_id, property.name, property.type,
      JSON.stringify(property.config), property.position, Number(property.hidden), Number(property.read_only), now, now,
    );
    const operation = this.beginOperation("database_property.create", context.workspaceId, property.id, "1 = 1");
    await this.db.batch([
      ...operation.statements,
      insert,
      ...this.auditStatements(context, "database_property.created", "database_property", property.id, 1, now, this.operationCondition(operation.operationId)),
      this.operationCleanup(operation.operationId),
    ]);
    await this.notifyPresence(context.workspaceId, "database_property", property.id, property.revision);
    return property;
  }

  async updateProperty(context: WorkspaceContext, databaseId: string, propertyId: string, input: UpdateDatabasePropertyInput) {
    const fields = await this.access.fields(context, databaseId, "manage");
    const property = this.access.findProperty(fields.properties, propertyId);
    if (!fields.writable.has(property.id)) {
      throw new DatabaseRepositoryError("FIELD_WRITE_DENIED", "Field write denied", 403, { property_id: property.id });
    }
    assertRevision(property.revision, input.base_revision);
    const candidate = {
      name: input.name ?? property.name, type: property.type, config: input.config ?? property.config,
      position: input.position ?? property.position, hidden: input.hidden ?? property.hidden,
      read_only: input.read_only ?? property.read_only,
    };
    if (!CreateDatabasePropertyInputSchema.safeParse(candidate).success) {
      throw new DatabaseRepositoryError("INVALID_PROPERTY", "Database property is invalid", 400);
    }
    await this.assertRelationTarget(context, candidate);
    const now = this.now();
    const update = this.db.prepare(
      `UPDATE database_properties SET name = ?, config_json = ?, position = ?, is_hidden = ?, is_read_only = ?,
       revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?`,
    ).bind(
      candidate.name, JSON.stringify(candidate.config), candidate.position, Number(candidate.hidden), Number(candidate.read_only),
      now, context.workspaceId, databaseId, propertyId, input.base_revision,
    );
    const operation = this.beginOperation(
      "database_property.update", context.workspaceId, propertyId,
      "EXISTS (SELECT 1 FROM database_properties WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?)",
      [context.workspaceId, databaseId, propertyId, input.base_revision],
    );
    let results: D1Result[];
    try {
      results = await this.db.batch([
      ...operation.statements,
      update,
      ...this.auditStatements(
        context,
        "database_property.updated",
        "database_property",
        propertyId,
        input.base_revision + 1,
        now,
        this.operationCondition(operation.operationId),
      ),
      this.operationCleanup(operation.operationId),
      ]);
    } catch (error) {
      if (this.isOperationGuardError(error)) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
      throw error;
    }
    if (results[operation.statements.length]?.meta.changes === 0) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
    const updated = { ...property, ...candidate, revision: property.revision + 1, updated_at: now };
    await this.notifyPresence(context.workspaceId, "database_property", propertyId, updated.revision);
    return updated;
  }

  async deleteProperty(context: WorkspaceContext, databaseId: string, propertyId: string, input: { base_revision: number }) {
    const fields = await this.access.fields(context, databaseId, "manage");
    const property = this.access.findProperty(fields.properties, propertyId);
    if (!fields.writable.has(property.id)) {
      throw new DatabaseRepositoryError("FIELD_WRITE_DENIED", "Field write denied", 403, { property_id: property.id });
    }
    assertRevision(property.revision, input.base_revision);
    const remove = this.db.prepare(
      "DELETE FROM database_properties WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?",
    ).bind(context.workspaceId, databaseId, propertyId, input.base_revision);
    const now = this.now();
    const operation = this.beginOperation(
      "database_property.delete", context.workspaceId, propertyId,
      "EXISTS (SELECT 1 FROM database_properties WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?)",
      [context.workspaceId, databaseId, propertyId, input.base_revision],
    );
    const results = await this.db.batch([
      ...operation.statements,
      remove,
      ...this.auditStatements(
        context,
        "database_property.deleted",
        "database_property",
        propertyId,
        input.base_revision + 1,
        now,
        this.operationCondition(operation.operationId),
      ),
      this.operationCleanup(operation.operationId),
    ]);
    const result = results[operation.statements.length]!;
    if (result.meta.changes === 0) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
    await this.notifyPresence(context.workspaceId, "database_property", propertyId, input.base_revision + 1);
    return { id: propertyId };
  }

  private async assertRelationTarget(
    context: WorkspaceContext,
    property: Pick<DatabaseProperty, "type" | "config">,
  ) {
    if (property.type !== "relation") return;
    const targetId = (property.config as Record<string, unknown>).target_database_id;
    const target = typeof targetId === "string"
      ? await this.db.prepare("SELECT id FROM databases WHERE workspace_id = ? AND id = ?").bind(context.workspaceId, targetId).first()
      : null;
    if (!target) throw new DatabaseRepositoryError("INVALID_RELATION_TARGET", "Relation target is not in this workspace", 400);
  }
}
