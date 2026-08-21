import {
  DatabaseViewConfigSchema,
  type ApplyDatabaseTemplateInput,
  type CreateDatabaseTemplateInput,
  type CreateDatabaseViewInput,
  type DatabaseProperty,
  type DatabaseRecord,
  type DatabaseTemplate,
  type DatabaseView,
  type UpdateDatabaseTemplateInput,
  type UpdateDatabaseViewInput,
  type WorkspaceContext,
} from "@nexus/contracts";
import { filterDatabaseFields } from "@nexus/domain";

import { assertRevision, DatabaseRepositoryBase } from "./database-repository-base";
import {
  TEMPLATE_COLUMNS,
  VIEW_COLUMNS,
  DatabaseRepositoryError,
  type TemplateRow,
  type ViewRow,
  toTemplate,
  toView,
} from "./database-model";
import type { D1DatabaseRecordRepository } from "./d1-database-records";

export class D1DatabaseViewRepository extends DatabaseRepositoryBase {
  constructor(
    db: D1Database,
    options: ConstructorParameters<typeof DatabaseRepositoryBase>[1],
    private readonly records: D1DatabaseRecordRepository,
  ) {
    super(db, options);
  }

  async getDatabase(context: WorkspaceContext, databaseId: string) {
    const fields = await this.access.fields(context, databaseId, "read");
    const [viewsResult, templatesResult] = await Promise.all([
      this.db.prepare(
        `SELECT ${VIEW_COLUMNS} FROM database_views WHERE workspace_id = ? AND database_id = ? ORDER BY position, id`,
      ).bind(context.workspaceId, databaseId).all<ViewRow>(),
      this.db.prepare(
        `SELECT ${TEMPLATE_COLUMNS} FROM database_templates WHERE workspace_id = ? AND database_id = ? ORDER BY updated_at DESC, id DESC`,
      ).bind(context.workspaceId, databaseId).all<TemplateRow>(),
    ]);
    const visible = filterDatabaseFields({
      properties: fields.properties,
      readablePropertyIds: fields.readable,
      records: [] as DatabaseRecord[],
      templates: (templatesResult.results ?? []).map(toTemplate),
    });
    return {
      database: fields.database,
      role: fields.role,
      properties: visible.properties,
      views: (viewsResult.results ?? []).map(toView).map((view) => this.filterView(view, fields.readable)),
      templates: visible.templates,
    };
  }

  async createView(context: WorkspaceContext, databaseId: string, input: CreateDatabaseViewInput) {
    const fields = await this.access.fields(context, databaseId, "write");
    this.assertViewFields(input.config, fields.properties);
    const now = this.now();
    const view: DatabaseView = {
      id: this.id(), workspace_id: context.workspaceId, database_id: databaseId,
      name: input.name, type: input.type, config: input.config, position: input.position ?? 0,
      revision: 1, created_at: now, updated_at: now,
    };
    const insert = this.db.prepare(
      `INSERT INTO database_views (id, workspace_id, database_id, name, type, config_json, position, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(view.id, view.workspace_id, databaseId, view.name, view.type, JSON.stringify(view.config), view.position, now, now);
    const operation = this.beginOperation("database_view.create", context.workspaceId, view.id, "1 = 1");
    await this.db.batch([
      ...operation.statements,
      insert,
      ...this.auditStatements(context, "database_view.created", "database_view", view.id, 1, now, this.operationCondition(operation.operationId)),
      this.operationCleanup(operation.operationId),
    ]);
    await this.notifyPresence(context.workspaceId, "database_view", view.id, view.revision);
    return view;
  }

  async updateView(context: WorkspaceContext, databaseId: string, viewId: string, input: UpdateDatabaseViewInput) {
    const fields = await this.access.fields(context, databaseId, "write");
    const view = await this.view(context.workspaceId, databaseId, viewId);
    assertRevision(view.revision, input.base_revision);
    const config = input.config ?? view.config;
    this.assertViewFields(config, fields.properties);
    const now = this.now();
    const updated = { ...view, name: input.name ?? view.name, config, position: input.position ?? view.position, revision: view.revision + 1, updated_at: now };
    const update = this.db.prepare(
      `UPDATE database_views SET name = ?, config_json = ?, position = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?`,
    ).bind(updated.name, JSON.stringify(config), updated.position, now, context.workspaceId, databaseId, viewId, input.base_revision);
    const operation = this.beginOperation(
      "database_view.update", context.workspaceId, viewId,
      "EXISTS (SELECT 1 FROM database_views WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?)",
      [context.workspaceId, databaseId, viewId, input.base_revision],
    );
    let results: D1Result[];
    try {
      results = await this.db.batch([
        ...operation.statements,
        update,
        ...this.auditStatements(context, "database_view.updated", "database_view", viewId, input.base_revision + 1, now, this.operationCondition(operation.operationId)),
        this.operationCleanup(operation.operationId),
      ]);
    } catch (error) {
      if (this.isOperationGuardError(error)) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
      throw error;
    }
    if (results[operation.statements.length]?.meta.changes === 0) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
    await this.notifyPresence(context.workspaceId, "database_view", viewId, updated.revision);
    return updated;
  }

  async deleteView(context: WorkspaceContext, databaseId: string, viewId: string, input: { base_revision: number }) {
    await this.access.assert(context, databaseId, "write");
    const view = await this.view(context.workspaceId, databaseId, viewId);
    assertRevision(view.revision, input.base_revision);
    const remove = this.db.prepare(
      "DELETE FROM database_views WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?",
    ).bind(context.workspaceId, databaseId, viewId, input.base_revision);
    const now = this.now();
    const operation = this.beginOperation(
      "database_view.delete", context.workspaceId, viewId,
      "EXISTS (SELECT 1 FROM database_views WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?)",
      [context.workspaceId, databaseId, viewId, input.base_revision],
    );
    const results = await this.db.batch([
      ...operation.statements,
      remove,
      ...this.auditStatements(context, "database_view.deleted", "database_view", viewId, input.base_revision + 1, now, this.operationCondition(operation.operationId)),
      this.operationCleanup(operation.operationId),
    ]);
    if (results[operation.statements.length]?.meta.changes === 0) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
    await this.notifyPresence(context.workspaceId, "database_view", viewId, input.base_revision + 1);
    return { id: viewId };
  }

  async createTemplate(context: WorkspaceContext, databaseId: string, input: CreateDatabaseTemplateInput) {
    const fields = await this.access.fields(context, databaseId, "write");
    const defaults = this.normalize(fields.properties, input.default_values, fields.writable);
    const referenceCollector = this.referenceCollector(fields.properties);
    referenceCollector.add(defaults);
    const references = referenceCollector.items();
    await this.validateReferenceItems(context, references);
    const now = this.now();
    const template: DatabaseTemplate = {
      id: this.id(), workspace_id: context.workspaceId, database_id: databaseId,
      name: input.name, default_values: defaults, revision: 1, created_at: now, updated_at: now,
    };
    const operation = this.beginOperation("database_template.create", context.workspaceId, template.id, "1 = 1");
    const statements: D1PreparedStatement[] = [...operation.statements];
    statements.push(...this.referenceGuards(context, references));
    statements.push(this.db.prepare(
      `INSERT INTO database_templates (id, workspace_id, database_id, name, default_values_json, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(template.id, context.workspaceId, databaseId, template.name, JSON.stringify(defaults), now, now));
    statements.push(...this.referenceGuards(context, references));
    statements.push(...this.auditStatements(context, "database_template.created", "database_template", template.id, 1, now, this.operationCondition(operation.operationId)));
    statements.push(this.operationCleanup(operation.operationId));
    try {
      await this.db.batch(statements);
    } catch (error) {
      const referenceFailure = this.referenceGuardFailure(error, references);
      if (referenceFailure) throw referenceFailure;
      throw error;
    }
    await this.notifyPresence(context.workspaceId, "database_template", template.id, template.revision);
    return template;
  }

  async updateTemplate(context: WorkspaceContext, databaseId: string, templateId: string, input: UpdateDatabaseTemplateInput) {
    const fields = await this.access.fields(context, databaseId, "write");
    const template = await this.template(context.workspaceId, databaseId, templateId);
    assertRevision(template.revision, input.base_revision);
    const defaults = input.default_values === undefined
      ? template.default_values
      : this.normalize(fields.properties, input.default_values, fields.writable);
    const referenceCollector = this.referenceCollector(fields.properties);
    referenceCollector.add(defaults);
    const references = referenceCollector.items();
    await this.validateReferenceItems(context, references);
    const now = this.now();
    const updated = { ...template, name: input.name ?? template.name, default_values: defaults, revision: template.revision + 1, updated_at: now };
    const operation = this.beginOperation(
      "database_template.update", context.workspaceId, templateId,
      "EXISTS (SELECT 1 FROM database_templates WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?)",
      [context.workspaceId, databaseId, templateId, input.base_revision],
    );
    const statements: D1PreparedStatement[] = [...operation.statements];
    const beforeReferenceGuards = this.referenceGuards(context, references);
    statements.push(...beforeReferenceGuards);
    statements.push(this.db.prepare(
      `UPDATE database_templates SET name = ?, default_values_json = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?`,
    ).bind(updated.name, JSON.stringify(defaults), now, context.workspaceId, databaseId, templateId, input.base_revision));
    statements.push(...this.referenceGuards(context, references));
    statements.push(...this.auditStatements(context, "database_template.updated", "database_template", templateId, updated.revision, now, this.operationCondition(operation.operationId)));
    statements.push(this.operationCleanup(operation.operationId));
    try {
      const results = await this.db.batch(statements);
      const update = results[operation.statements.length + beforeReferenceGuards.length]!;
      if (update.meta.changes === 0) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
    } catch (error) {
      const referenceFailure = this.referenceGuardFailure(error, references);
      if (referenceFailure) throw referenceFailure;
      if (this.isOperationGuardError(error)) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
      throw error;
    }
    await this.notifyPresence(context.workspaceId, "database_template", templateId, updated.revision);
    return updated;
  }

  async deleteTemplate(context: WorkspaceContext, databaseId: string, templateId: string, input: { base_revision: number }) {
    await this.access.assert(context, databaseId, "write");
    const template = await this.template(context.workspaceId, databaseId, templateId);
    assertRevision(template.revision, input.base_revision);
    const remove = this.db.prepare(
      "DELETE FROM database_templates WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?",
    ).bind(context.workspaceId, databaseId, templateId, input.base_revision);
    const now = this.now();
    const operation = this.beginOperation(
      "database_template.delete", context.workspaceId, templateId,
      "EXISTS (SELECT 1 FROM database_templates WHERE workspace_id = ? AND database_id = ? AND id = ? AND revision = ?)",
      [context.workspaceId, databaseId, templateId, input.base_revision],
    );
    const results = await this.db.batch([
      ...operation.statements,
      remove,
      ...this.auditStatements(context, "database_template.deleted", "database_template", templateId, input.base_revision + 1, now, this.operationCondition(operation.operationId)),
      this.operationCleanup(operation.operationId),
    ]);
    if (results[operation.statements.length]?.meta.changes === 0) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
    await this.notifyPresence(context.workspaceId, "database_template", templateId, input.base_revision + 1);
    return { id: templateId };
  }

  async applyTemplate(context: WorkspaceContext, databaseId: string, input: ApplyDatabaseTemplateInput) {
    const fields = await this.access.fields(context, databaseId, "write");
    const template = await this.template(context.workspaceId, databaseId, input.template_id);
    const defaults = this.normalize(fields.properties, template.default_values, fields.writable);
    return this.records.bulkEditRecords(context, databaseId, {
      mutations: input.records.map((record) => ({ ...record, values: defaults })),
    });
  }

  private async view(workspaceId: string, databaseId: string, viewId: string) {
    const row = await this.db.prepare(
      `SELECT ${VIEW_COLUMNS} FROM database_views WHERE workspace_id = ? AND database_id = ? AND id = ?`,
    ).bind(workspaceId, databaseId, viewId).first<ViewRow>();
    if (!row) throw new DatabaseRepositoryError("VIEW_NOT_FOUND", "Database view not found", 404);
    return toView(row);
  }

  private async template(workspaceId: string, databaseId: string, templateId: string) {
    const row = await this.db.prepare(
      `SELECT ${TEMPLATE_COLUMNS} FROM database_templates WHERE workspace_id = ? AND database_id = ? AND id = ?`,
    ).bind(workspaceId, databaseId, templateId).first<TemplateRow>();
    if (!row) throw new DatabaseRepositoryError("TEMPLATE_NOT_FOUND", "Database template not found", 404);
    return toTemplate(row);
  }

  private assertViewFields(config: DatabaseView["config"], properties: readonly DatabaseProperty[]) {
    if (!DatabaseViewConfigSchema.safeParse(config).success) {
      throw new DatabaseRepositoryError("INVALID_VIEW", "Database view configuration is invalid", 400);
    }
    const propertyIds = new Set(properties.map((property) => property.id));
    const referenced = [
      ...config.filters.map((filter) => filter.property_id), ...config.sorts.map((sort) => sort.property_id),
      ...config.visible_columns, ...(config.grouping ? [config.grouping.property_id] : []),
      ...(config.settings.card_properties ?? []),
      ...(config.settings.date_property_id ? [config.settings.date_property_id] : []),
      ...(config.settings.frozen_property_id ? [config.settings.frozen_property_id] : []),
    ];
    if (referenced.some((propertyId) => !propertyIds.has(propertyId))) {
      throw new DatabaseRepositoryError("UNKNOWN_FIELD", "View references an unknown field", 400);
    }
  }

  private filterView(view: DatabaseView, readable: ReadonlySet<string>) {
    const settings = {
      ...view.config.settings,
      card_properties: view.config.settings.card_properties?.filter((id) => readable.has(id)),
      date_property_id: view.config.settings.date_property_id && readable.has(view.config.settings.date_property_id)
        ? view.config.settings.date_property_id : null,
      frozen_property_id: view.config.settings.frozen_property_id && readable.has(view.config.settings.frozen_property_id)
        ? view.config.settings.frozen_property_id : null,
    };
    return {
      ...view,
      config: {
        ...view.config,
        filters: view.config.filters.filter((filter) => readable.has(filter.property_id)),
        sorts: view.config.sorts.filter((sort) => readable.has(sort.property_id)),
        grouping: view.config.grouping && readable.has(view.config.grouping.property_id) ? view.config.grouping : null,
        visible_columns: view.config.visible_columns.filter((propertyId) => readable.has(propertyId)),
        settings,
      },
    };
  }
}
