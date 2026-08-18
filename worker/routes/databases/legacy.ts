import {
  assertBooleanOrUndefined,
  assertString,
  HttpError,
  jsonSuccess,
  okMessage,
  parseJson,
} from "../../http";
import {
  archiveNoteById,
  deleteDatabaseTemplateById,
  deleteDatabaseViewById,
  deleteDatabaseById,
  deleteDatabasePropertyById,
  detachNotesFromDatabase,
  duplicateDatabaseNote,
  getDatabaseById,
  getDatabasePropertyById,
  getDatabaseTemplateById,
  getDatabaseViewById,
  getDatabaseFieldPermission,
  getKnowledgeDiagnostics,
  getNoteById,
  insertActivityLog,
  insertComment,
  insertDatabaseTemplate,
  insertSavedSearch,
  insertDatabaseView,
  insertDatabase,
  insertDatabaseProperty,
  insertNote,
  listAuditLogs,
  listActivityLogs,
  listComments,
  listDatabaseDuplicateTitleGroups,
  listDatabasePermissions,
  listDatabaseTemplates,
  listDatabaseViews,
  listDatabaseNotes,
  listDatabaseProperties,
  listDatabases,
  listSavedSearches,
  listWorkspaceMembers,
  deleteSavedSearchById,
  replaceDatabasePermissions,
  unarchiveNoteById,
  updateDatabaseViewById,
  updateDatabaseById,
  updateDatabasePropertyById,
  updateDatabaseTemplateById,
  updateNoteById,
  upsertDatabaseFieldPermission,
  upsertNotePropertyValues,
} from "../../db/queries";
import { assertDatabaseReadable, assertFieldWritable, type WorkspaceRole } from "../../permissions/databases";

type DatabasePropertyType =
  | "title"
  | "text"
  | "number"
  | "checkbox"
  | "date"
  | "url"
  | "email"
  | "phone"
  | "rating"
  | "progress"
  | "single_select"
  | "multi_select"
  | "member";

interface SelectOptionInput {
  id?: string;
  name: string;
  color?: string;
}

interface DatabaseConfigInput {
  options?: SelectOptionInput[];
  multi?: boolean;
}

interface CreateDatabaseBody {
  name?: string;
  description?: string;
  icon?: string;
  initial_status_property?: boolean;
  initial_date_property?: boolean;
  bind_board_property?: boolean;
  bind_calendar_property?: boolean;
}

interface UpdateDatabaseBody {
  name?: string;
  description?: string | null;
  icon?: string | null;
  board_property_id?: string | null;
  calendar_property_id?: string | null;
}

interface CreateDatabasePropertyBody {
  name?: string;
  type?: DatabasePropertyType;
  config?: DatabaseConfigInput;
}

interface UpdateDatabasePropertyBody {
  name?: string;
  config?: DatabaseConfigInput;
  sort_order?: number;
}

interface UpdateDatabaseValuesBody {
  values?: Array<{
    property_id?: string;
    value_text?: string | null;
    value_number?: number | null;
    value_boolean?: boolean | null;
    value_date?: string | null;
    value_json?: string[] | null;
  }>;
}

interface DatabaseTemplateBody {
  name?: string;
  title?: string;
  content?: string;
  default_values?: UpdateDatabaseValuesBody["values"];
}

interface DatabaseBatchBody {
  note_ids?: string[];
  action?: "archive" | "unarchive" | "duplicate" | "update_values";
  values?: UpdateDatabaseValuesBody["values"];
}

interface DatabasePermissionsBody {
  permissions?: Array<{
    subject_type?: "workspace_role" | "member";
    subject_id?: string;
    role?: "viewer" | "editor" | "admin";
  }>;
}

interface FieldPermissionsBody {
  viewer_roles?: string[];
  editor_roles?: string[];
}

interface CommentBody {
  note_id?: string | null;
  database_id?: string | null;
  body?: string;
  mentions?: string[];
}

interface SavedSearchBody {
  name?: string;
  query?: string;
  filters?: unknown;
}

interface UpdateDatabaseMembershipBody {
  database_id?: string | null;
}

interface DatabaseAccessOptions {
  userId: string;
  workspaceRole: WorkspaceRole;
}

async function requireReadableDatabase(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  access?: DatabaseAccessOptions,
) {
  if (access) {
    return (await assertDatabaseReadable({
      db,
      workspaceId,
      databaseId,
      userId: access.userId,
      workspaceRole: access.workspaceRole,
    })).database;
  }
  const database = await getDatabaseById(db, workspaceId, databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");
  return database;
}

async function filterReadableDatabases<T extends { id: string }>(
  db: D1Database,
  workspaceId: string,
  items: T[],
  access?: DatabaseAccessOptions,
) {
  if (!access || access.workspaceRole === "owner") return items;
  const readable: T[] = [];
  for (const item of items) {
    try {
      await assertDatabaseReadable({
        db,
        workspaceId,
        databaseId: item.id,
        userId: access.userId,
        workspaceRole: access.workspaceRole,
      });
      readable.push(item);
    } catch (error) {
      if (error instanceof HttpError && (error.status === 403 || error.status === 404)) continue;
      throw error;
    }
  }
  return readable;
}

async function filterReadableProperties<T extends { id: string }>(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  properties: T[],
  access?: DatabaseAccessOptions,
) {
  if (!access || access.workspaceRole === "owner") return properties;
  const readable: T[] = [];
  for (const property of properties) {
    const permission = await getDatabaseFieldPermission(db, workspaceId, databaseId, property.id);
    if (permission.viewer_roles.includes(access.workspaceRole)) readable.push(property);
  }
  return readable;
}

function filterDatabaseValuesByProperties<T extends { database_values?: Record<string, unknown> }>(
  notes: T[],
  properties: Array<{ id: string }>,
) {
  const readablePropertyIds = new Set(properties.map((property) => property.id));
  return notes.map((note) => {
    if (!note.database_values) return note;
    return {
      ...note,
      database_values: Object.fromEntries(
        Object.entries(note.database_values).filter(([propertyId]) => readablePropertyIds.has(propertyId)),
      ),
    };
  });
}

async function requireWritableProperty(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  propertyId: string,
  access?: DatabaseAccessOptions,
) {
  if (!access) return;
  await assertFieldWritable({
    db,
    workspaceId,
    databaseId,
    propertyId,
    userId: access.userId,
    workspaceRole: access.workspaceRole,
  });
}

function normalizeSavedSearchFilters(filters: unknown): Record<string, unknown> {
  if (filters === undefined || filters === null) return {};
  if (typeof filters !== "object" || Array.isArray(filters)) {
    throw new HttpError(400, "VALIDATION_ERROR", "filters must be an object");
  }
  return filters as Record<string, unknown>;
}

interface DatabaseAdvancedFilterInput {
  mode?: "and" | "or";
  rules?: Array<{
    id?: string;
    property_id?: string;
    operator?: string;
    value?: string | null;
    values?: string[] | null;
  }>;
}

interface CreateDatabaseViewBody {
  name?: string;
  view?: "table" | "board" | "calendar";
  visibleColumnIds?: string[];
  filterQuery?: string;
  filterPropertyId?: string;
  filterPropertyValue?: string;
  advancedFilter?: DatabaseAdvancedFilterInput;
  sortField?: string;
  sortDirection?: "asc" | "desc";
}

interface UpdateDatabaseViewBody extends Partial<CreateDatabaseViewBody> {}

interface DatabaseViewConfigShape {
  view: "table" | "board" | "calendar";
  visibleColumnIds: string[];
  filterQuery: string;
  filterPropertyId: string;
  filterPropertyValue: string;
  advancedFilter: ReturnType<typeof normalizeAdvancedFilter>;
  sortField: string;
  sortDirection: "asc" | "desc";
}

interface DatabaseViewShape extends DatabaseViewConfigShape {
  id: string;
  database_id: string;
  name: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

const PROPERTY_TYPES: DatabasePropertyType[] = ["title", "text", "number", "checkbox", "date", "url", "email", "phone", "rating", "progress", "single_select", "multi_select", "member"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T.*)?$/;
const FILTER_OPERATORS = new Set([
  "contains",
  "equals",
  "not_equals",
  "is_empty",
  "not_empty",
  "gt",
  "gte",
  "lt",
  "lte",
  "on",
  "before",
  "after",
  "on_or_before",
  "on_or_after",
  "has_any",
  "has_all",
]);

function normalizeOptionalText(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return assertString(value, field, { allowEmpty: true }).trim();
}

function assertPropertyType(value: unknown): DatabasePropertyType {
  const type = assertString(value, "type", { allowEmpty: false }) as DatabasePropertyType;
  if (!PROPERTY_TYPES.includes(type)) {
    throw new HttpError(400, "VALIDATION_ERROR", "unsupported property type");
  }
  return type;
}

function sanitizePropertyConfig(type: DatabasePropertyType, config: DatabaseConfigInput | undefined) {
  if (!config) return {};
  const normalized: Record<string, unknown> = {};

  if ((type === "single_select" || type === "multi_select") && config.options) {
    const seen = new Set<string>();
    normalized.options = config.options.map((option) => {
      const id = option.id?.trim() || crypto.randomUUID();
      if (seen.has(id)) {
        throw new HttpError(400, "VALIDATION_ERROR", "select option ids must be unique");
      }
      seen.add(id);
      return {
        id,
        name: assertString(option.name, "option.name", { allowEmpty: false, max: 80 }).trim(),
        color: option.color?.trim() || "#6B9EFF",
      };
    });
  }

  if (type === "member") {
    normalized.multi = config.multi ?? true;
  }

  return normalized;
}

async function validateDatabaseViewBindings(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  boardPropertyId: string | null | undefined,
  calendarPropertyId: string | null | undefined,
) {
  if (boardPropertyId) {
    const property = await getDatabasePropertyById(db, workspaceId, databaseId, boardPropertyId);
    if (!property) throw new HttpError(404, "NOT_FOUND", "board property not found");
    if (property.type !== "single_select" && property.type !== "member" && property.type !== "checkbox") {
      throw new HttpError(400, "VALIDATION_ERROR", "board property must be single_select, member, or checkbox");
    }
  }

  if (calendarPropertyId) {
    const property = await getDatabasePropertyById(db, workspaceId, databaseId, calendarPropertyId);
    if (!property) throw new HttpError(404, "NOT_FOUND", "calendar property not found");
    if (property.type !== "date") {
      throw new HttpError(400, "VALIDATION_ERROR", "calendar property must be date");
    }
  }
}

async function validateTitlePropertyUniqueness(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  type: DatabasePropertyType,
  ignorePropertyId?: string,
) {
  if (type !== "title") return;
  const properties = await listDatabaseProperties(db, workspaceId, databaseId);
  const exists = properties.some((property) => property.type === "title" && property.id !== ignorePropertyId);
  if (exists) {
    throw new HttpError(400, "VALIDATION_ERROR", "database can only have one title property");
  }
}

async function validateMemberIds(
  db: D1Database,
  workspaceId: string,
  memberIds: string[],
) {
  const members = await listWorkspaceMembers(db, workspaceId);
  const allowed = new Set(members.map((member) => member.user_id));
  for (const memberId of memberIds) {
    if (!allowed.has(memberId)) {
      throw new HttpError(400, "VALIDATION_ERROR", "member ids must belong to the current workspace");
    }
  }
}

function assertStringList(value: unknown, field: string) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} must be an array`);
  }
  return value.map((item) => assertString(item, field, { allowEmpty: false }).trim());
}

function normalizeDatabaseViewConfig(body: CreateDatabaseViewBody | UpdateDatabaseViewBody): DatabaseViewConfigShape {
  const view = body.view === "board" || body.view === "calendar" ? body.view : "table";
  const visibleColumnIds = assertStringList(body.visibleColumnIds, "visibleColumnIds");
  const filterQuery = body.filterQuery === undefined ? "" : assertString(body.filterQuery, "filterQuery", { allowEmpty: true, max: 200 }).trim();
  const filterPropertyId = body.filterPropertyId === undefined ? "" : assertString(body.filterPropertyId, "filterPropertyId", { allowEmpty: true, max: 120 }).trim();
  const filterPropertyValue = body.filterPropertyValue === undefined ? "" : assertString(body.filterPropertyValue, "filterPropertyValue", { allowEmpty: true, max: 200 }).trim();
  const sortField = body.sortField === undefined ? "updated_at" : assertString(body.sortField, "sortField", { allowEmpty: false, max: 120 }).trim();
  const sortDirection = body.sortDirection === "asc" ? "asc" : "desc";
  const advancedFilter = normalizeAdvancedFilter(body.advancedFilter);
  return {
    view,
    visibleColumnIds,
    filterQuery,
    filterPropertyId,
    filterPropertyValue,
    advancedFilter,
    sortField,
    sortDirection,
  };
}

function normalizeAdvancedFilter(input: DatabaseAdvancedFilterInput | undefined): { mode: "and" | "or"; rules: Array<{ id: string; property_id: string; operator: string; value: string; values: string[] }> } {
  const mode = input?.mode === "or" ? "or" : "and";
  const rules = Array.isArray(input?.rules)
    ? input.rules.map((rule) => {
      const propertyId = assertString(rule.property_id, "advancedFilter.rules.property_id", { allowEmpty: false, max: 120 }).trim();
      const operator = assertString(rule.operator, "advancedFilter.rules.operator", { allowEmpty: false, max: 40 }).trim();
      if (!FILTER_OPERATORS.has(operator)) {
        throw new HttpError(400, "VALIDATION_ERROR", "unsupported advanced filter operator");
      }
      return {
        id: rule.id?.trim() || crypto.randomUUID(),
        property_id: propertyId,
        operator,
        value: rule.value === undefined || rule.value === null ? "" : assertString(rule.value, "advancedFilter.rules.value", { allowEmpty: true, max: 200 }).trim(),
        values: Array.isArray(rule.values) ? rule.values.map((item) => assertString(item, "advancedFilter.rules.values", { allowEmpty: false, max: 120 }).trim()) : [],
      };
    })
    : [];
  return { mode, rules };
}

function escapeCsvCell(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values.map((item) => item.replace(/\r/g, "").trim());
}

function parseCsvText(text: string) {
  const rows: string[][] = [];
  let currentLine = "";
  let inQuotes = false;
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index] ?? "";
    currentLine += char;
    if (char === "\"") {
      if (inQuotes && normalized[index + 1] === "\"") {
        currentLine += normalized[index + 1] ?? "";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "\n" && !inQuotes) {
      const line = currentLine.trimEnd();
      if (line.trim()) rows.push(parseCsvLine(line));
      currentLine = "";
    }
  }

  const lastLine = currentLine.trimEnd();
  if (lastLine.trim()) rows.push(parseCsvLine(lastLine));
  return rows;
}

async function normalizeDatabaseValueInput(
  db: D1Database,
  workspaceId: string,
  property: Awaited<ReturnType<typeof listDatabaseProperties>>[number],
  value: NonNullable<UpdateDatabaseValuesBody["values"]>[number],
) {
  if (property.type === "title") {
    throw new HttpError(400, "VALIDATION_ERROR", "title property cannot be written as a database value");
  }

  if (property.type === "text") {
    return {
      propertyId: property.id,
      valueText: value.value_text === undefined || value.value_text === null ? null : assertString(value.value_text, "value_text", { allowEmpty: true }),
      valueNumber: null,
      valueBoolean: null,
      valueDate: null,
      valueJson: null,
    };
  }

  if (property.type === "url" || property.type === "email" || property.type === "phone") {
    const normalizedText = value.value_text === undefined || value.value_text === null
      ? null
      : assertString(value.value_text, "value_text", { allowEmpty: true, max: 400 }).trim();
    if (property.type === "email" && normalizedText && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedText)) {
      throw new HttpError(400, "VALIDATION_ERROR", "email property must contain a valid email");
    }
    if (property.type === "url" && normalizedText && !/^https?:\/\//i.test(normalizedText)) {
      throw new HttpError(400, "VALIDATION_ERROR", "url property must start with http:// or https://");
    }
    return {
      propertyId: property.id,
      valueText: normalizedText,
      valueNumber: null,
      valueBoolean: null,
      valueDate: null,
      valueJson: null,
    };
  }

  if (property.type === "number" || property.type === "rating" || property.type === "progress") {
    if (value.value_number !== null && value.value_number !== undefined && (typeof value.value_number !== "number" || !Number.isFinite(value.value_number))) {
      throw new HttpError(400, "VALIDATION_ERROR", "number property must be a finite number");
    }
    if (property.type === "rating" && value.value_number !== null && value.value_number !== undefined && (value.value_number < 0 || value.value_number > 5)) {
      throw new HttpError(400, "VALIDATION_ERROR", "rating property must be between 0 and 5");
    }
    if (property.type === "progress" && value.value_number !== null && value.value_number !== undefined && (value.value_number < 0 || value.value_number > 100)) {
      throw new HttpError(400, "VALIDATION_ERROR", "progress property must be between 0 and 100");
    }
    return {
      propertyId: property.id,
      valueText: null,
      valueNumber: value.value_number ?? null,
      valueBoolean: null,
      valueDate: null,
      valueJson: null,
    };
  }

  if (property.type === "checkbox") {
    if (value.value_boolean !== null && value.value_boolean !== undefined && typeof value.value_boolean !== "boolean") {
      throw new HttpError(400, "VALIDATION_ERROR", "checkbox property must be boolean");
    }
    return {
      propertyId: property.id,
      valueText: null,
      valueNumber: null,
      valueBoolean: value.value_boolean ?? null,
      valueDate: null,
      valueJson: null,
    };
  }

  if (property.type === "date") {
    if (value.value_date && !DATE_PATTERN.test(value.value_date)) {
      throw new HttpError(400, "VALIDATION_ERROR", "date property must be ISO-like date text");
    }
    return {
      propertyId: property.id,
      valueText: null,
      valueNumber: null,
      valueBoolean: null,
      valueDate: value.value_date ?? null,
      valueJson: null,
    };
  }

  if (property.type === "single_select" || property.type === "multi_select") {
    const selectedIds = assertStringList(value.value_json, "value_json");
    if (property.type === "single_select" && selectedIds.length > 1) {
      throw new HttpError(400, "VALIDATION_ERROR", "single_select property accepts at most one option");
    }
    const options = Array.isArray(property.config.options) ? property.config.options : [];
    const allowed = new Set(options.map((option) => option.id));
    for (const optionId of selectedIds) {
      if (!allowed.has(optionId)) {
        throw new HttpError(400, "VALIDATION_ERROR", "select value must reference an existing option");
      }
    }
    return {
      propertyId: property.id,
      valueText: null,
      valueNumber: null,
      valueBoolean: null,
      valueDate: null,
      valueJson: selectedIds,
    };
  }

  const memberIds = assertStringList(value.value_json, "value_json");
  if (property.config.multi === false && memberIds.length > 1) {
    throw new HttpError(400, "VALIDATION_ERROR", "single member property accepts at most one member");
  }
  await validateMemberIds(db, workspaceId, memberIds);
  return {
    propertyId: property.id,
    valueText: null,
    valueNumber: null,
    valueBoolean: null,
    valueDate: null,
    valueJson: memberIds,
  };
}

export async function handleListDatabases(
  db: D1Database,
  userId: string,
  workspaceId: string,
  access?: DatabaseAccessOptions,
) {
  const databases = await listDatabases(db, userId, workspaceId);
  return jsonSuccess(await filterReadableDatabases(db, workspaceId, databases, access));
}

export async function handleCreateDatabase(
  db: D1Database,
  userId: string,
  workspaceId: string,
  request: Request,
) {
  const body = await parseJson<CreateDatabaseBody>(request);
  const name = assertString(body.name, "name", { allowEmpty: false, max: 120 }).trim();
  const description = normalizeOptionalText(body.description, "description");
  const icon = normalizeOptionalText(body.icon, "icon");
  const initialStatusProperty = assertBooleanOrUndefined(body.initial_status_property, "initial_status_property") ?? false;
  const initialDateProperty = assertBooleanOrUndefined(body.initial_date_property, "initial_date_property") ?? false;
  const bindBoardProperty = assertBooleanOrUndefined(body.bind_board_property, "bind_board_property") ?? false;
  const bindCalendarProperty = assertBooleanOrUndefined(body.bind_calendar_property, "bind_calendar_property") ?? false;
  const databaseId = crypto.randomUUID();
  const statusPropertyId = initialStatusProperty ? crypto.randomUUID() : null;
  const datePropertyId = initialDateProperty ? crypto.randomUUID() : null;

  await insertDatabase(db, {
    id: databaseId,
    workspaceId,
    name,
    description: description || null,
    icon: icon || null,
    createdByUserId: userId,
  });

  await insertDatabaseProperty(db, {
    id: crypto.randomUUID(),
    databaseId,
    name: "标题",
    type: "title",
    configJson: JSON.stringify({}),
    sortOrder: 0,
  });

  if (statusPropertyId) {
    await insertDatabaseProperty(db, {
      id: statusPropertyId,
      databaseId,
      name: "Status",
      type: "single_select",
      configJson: JSON.stringify({
        options: [
          { id: crypto.randomUUID(), name: "To do", color: "#8E8E93" },
          { id: crypto.randomUUID(), name: "Doing", color: "#FF9500" },
          { id: crypto.randomUUID(), name: "Done", color: "#34C759" },
        ],
      }),
      sortOrder: 1,
    });
  }

  if (datePropertyId) {
    await insertDatabaseProperty(db, {
      id: datePropertyId,
      databaseId,
      name: "Date",
      type: "date",
      configJson: JSON.stringify({}),
      sortOrder: statusPropertyId ? 2 : 1,
    });
  }

  if ((bindBoardProperty && statusPropertyId) || (bindCalendarProperty && datePropertyId)) {
    await updateDatabaseById(db, workspaceId, databaseId, {
      boardPropertyId: bindBoardProperty ? statusPropertyId : undefined,
      calendarPropertyId: bindCalendarProperty ? datePropertyId : undefined,
    });
  }

  const created = await getDatabaseById(db, workspaceId, databaseId);
  if (!created) throw new HttpError(500, "INTERNAL_ERROR", "failed to create database");
  await insertActivityLog(db, { workspaceId, actorUserId: userId, action: "database.create", entityType: "database", entityId: databaseId, audit: true, metadata: { name } });
  return jsonSuccess(created, { status: 201 });
}

export async function handleGetDatabaseById(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  access?: DatabaseAccessOptions,
) {
  return jsonSuccess(await requireReadableDatabase(db, workspaceId, databaseId, access));
}

export async function handleUpdateDatabase(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  request: Request,
  actorUserId?: string,
) {
  const database = await getDatabaseById(db, workspaceId, databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");

  const body = await parseJson<UpdateDatabaseBody>(request);
  const name = body.name === undefined ? undefined : assertString(body.name, "name", { allowEmpty: false, max: 120 }).trim();
  const description = normalizeOptionalText(body.description, "description");
  const icon = normalizeOptionalText(body.icon, "icon");
  const boardPropertyId = body.board_property_id === undefined ? undefined : body.board_property_id;
  const calendarPropertyId = body.calendar_property_id === undefined ? undefined : body.calendar_property_id;

  await validateDatabaseViewBindings(
    db,
    workspaceId,
    databaseId,
    boardPropertyId === undefined ? undefined : boardPropertyId,
    calendarPropertyId === undefined ? undefined : calendarPropertyId,
  );

  await updateDatabaseById(db, workspaceId, databaseId, {
    name,
    description: description === undefined ? undefined : description,
    icon: icon === undefined ? undefined : icon,
    boardPropertyId: boardPropertyId === undefined ? undefined : boardPropertyId,
    calendarPropertyId: calendarPropertyId === undefined ? undefined : calendarPropertyId,
  });

  const updated = await getDatabaseById(db, workspaceId, databaseId);
  if (!updated) throw new HttpError(500, "INTERNAL_ERROR", "failed to update database");
  if (actorUserId) await insertActivityLog(db, { workspaceId, actorUserId, action: "database.update", entityType: "database", entityId: databaseId, audit: true });
  return jsonSuccess(updated);
}

export async function handleDeleteDatabase(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  actorUserId?: string,
) {
  const database = await getDatabaseById(db, workspaceId, databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");
  await detachNotesFromDatabase(db, workspaceId, databaseId);
  await deleteDatabaseById(db, workspaceId, databaseId);
  if (actorUserId) await insertActivityLog(db, { workspaceId, actorUserId, action: "database.delete", entityType: "database", entityId: databaseId, audit: true });
  return okMessage(databaseId);
}

export async function handleListDatabaseProperties(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  access?: DatabaseAccessOptions,
) {
  await requireReadableDatabase(db, workspaceId, databaseId, access);
  const properties = await listDatabaseProperties(db, workspaceId, databaseId);
  return jsonSuccess(await filterReadableProperties(db, workspaceId, databaseId, properties, access));
}

export async function handleCreateDatabaseProperty(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  request: Request,
  actorUserId?: string,
) {
  const database = await getDatabaseById(db, workspaceId, databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");

  const body = await parseJson<CreateDatabasePropertyBody>(request);
  const type = assertPropertyType(body.type);
  const name = assertString(body.name, "name", { allowEmpty: false, max: 80 }).trim();
  await validateTitlePropertyUniqueness(db, workspaceId, databaseId, type);
  const current = await listDatabaseProperties(db, workspaceId, databaseId);
  const config = sanitizePropertyConfig(type, body.config);

  await insertDatabaseProperty(db, {
    id: crypto.randomUUID(),
    databaseId,
    name,
    type,
    configJson: JSON.stringify(config),
    sortOrder: current.length,
  });

  if (actorUserId) await insertActivityLog(db, { workspaceId, actorUserId, action: "database_property.create", entityType: "database_property", entityId: databaseId, audit: true, metadata: { name, type } });
  return jsonSuccess(await listDatabaseProperties(db, workspaceId, databaseId), { status: 201 });
}

export async function handleUpdateDatabaseProperty(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  propertyId: string,
  request: Request,
  actorUserId?: string,
) {
  const property = await getDatabasePropertyById(db, workspaceId, databaseId, propertyId);
  if (!property) throw new HttpError(404, "NOT_FOUND", "database property not found");

  const body = await parseJson<UpdateDatabasePropertyBody>(request);
  const name = body.name === undefined ? undefined : assertString(body.name, "name", { allowEmpty: false, max: 80 }).trim();
  const sortOrder = body.sort_order;
  if (sortOrder !== undefined && (!Number.isFinite(sortOrder) || sortOrder < 0)) {
    throw new HttpError(400, "VALIDATION_ERROR", "sort_order is invalid");
  }
  const config = body.config === undefined ? undefined : sanitizePropertyConfig(property.type, body.config);

  await updateDatabasePropertyById(db, workspaceId, databaseId, propertyId, {
    name,
    sortOrder,
    configJson: config === undefined ? undefined : JSON.stringify(config),
  });

  if (actorUserId) await insertActivityLog(db, { workspaceId, actorUserId, action: "database_property.update", entityType: "database_property", entityId: propertyId, audit: true });
  return jsonSuccess(await listDatabaseProperties(db, workspaceId, databaseId));
}

export async function handleDeleteDatabaseProperty(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  propertyId: string,
  actorUserId?: string,
) {
  const property = await getDatabasePropertyById(db, workspaceId, databaseId, propertyId);
  if (!property) throw new HttpError(404, "NOT_FOUND", "database property not found");
  if (property.type === "title") {
    throw new HttpError(400, "VALIDATION_ERROR", "title property cannot be deleted");
  }

  const database = await getDatabaseById(db, workspaceId, databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");

  await deleteDatabasePropertyById(db, workspaceId, databaseId, propertyId);

  if (database.board_property_id === propertyId || database.calendar_property_id === propertyId) {
    await updateDatabaseById(db, workspaceId, databaseId, {
      boardPropertyId: database.board_property_id === propertyId ? null : undefined,
      calendarPropertyId: database.calendar_property_id === propertyId ? null : undefined,
    });
  }

  if (actorUserId) await insertActivityLog(db, { workspaceId, actorUserId, action: "database_property.delete", entityType: "database_property", entityId: propertyId, audit: true });
  return jsonSuccess(await listDatabaseProperties(db, workspaceId, databaseId));
}

export async function handleListDatabaseViews(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
) {
  const database = await getDatabaseById(db, workspaceId, databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");
  return jsonSuccess(await listDatabaseViews(db, workspaceId, databaseId));
}

export async function handleCreateDatabaseView(
  db: D1Database,
  userId: string,
  workspaceId: string,
  databaseId: string,
  request: Request,
) {
  const database = await getDatabaseById(db, workspaceId, databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");

  const body = await parseJson<CreateDatabaseViewBody>(request);
  const name = assertString(body.name, "name", { allowEmpty: false, max: 80 }).trim();
  const config = normalizeDatabaseViewConfig(body);

  await insertDatabaseView(db, {
    id: crypto.randomUUID(),
    databaseId,
    name,
    viewKind: config.view,
    configJson: JSON.stringify(config),
    createdByUserId: userId,
  });

  await insertActivityLog(db, { workspaceId, actorUserId: userId, action: "database_view.create", entityType: "database_view", entityId: databaseId, audit: true, metadata: { name, view: config.view } });
  return jsonSuccess(await listDatabaseViews(db, workspaceId, databaseId), { status: 201 });
}

export async function handleUpdateDatabaseView(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  viewId: string,
  request: Request,
  actorUserId?: string,
) {
  const current = await getDatabaseViewById(db, workspaceId, databaseId, viewId) as DatabaseViewShape | null;
  if (!current) throw new HttpError(404, "NOT_FOUND", "database view not found");
  const body = await parseJson<UpdateDatabaseViewBody>(request);
  const nextName = body.name === undefined ? undefined : assertString(body.name, "name", { allowEmpty: false, max: 80 }).trim();
  const config = normalizeDatabaseViewConfig({
    ...current,
    ...body,
    advancedFilter: body.advancedFilter ?? current.advancedFilter,
    visibleColumnIds: body.visibleColumnIds ?? current.visibleColumnIds,
  });

  await updateDatabaseViewById(db, workspaceId, databaseId, viewId, {
    name: nextName,
    viewKind: config.view,
    configJson: JSON.stringify(config),
  });

  if (actorUserId) await insertActivityLog(db, { workspaceId, actorUserId, action: "database_view.update", entityType: "database_view", entityId: viewId, audit: true });
  return jsonSuccess(await listDatabaseViews(db, workspaceId, databaseId));
}

export async function handleDeleteDatabaseView(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  viewId: string,
  actorUserId?: string,
) {
  const current = await getDatabaseViewById(db, workspaceId, databaseId, viewId) as DatabaseViewShape | null;
  if (!current) throw new HttpError(404, "NOT_FOUND", "database view not found");
  await deleteDatabaseViewById(db, workspaceId, databaseId, viewId);
  if (actorUserId) await insertActivityLog(db, { workspaceId, actorUserId, action: "database_view.delete", entityType: "database_view", entityId: viewId, audit: true });
  return jsonSuccess(await listDatabaseViews(db, workspaceId, databaseId));
}

async function normalizeTemplateDefaultValues(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  values: UpdateDatabaseValuesBody["values"] | undefined,
) {
  const properties = await listDatabaseProperties(db, workspaceId, databaseId);
  const propertyMap = new Map(properties.map((property) => [property.id, property]));
  const normalized = [];
  for (const value of values ?? []) {
    const propertyId = assertString(value.property_id, "property_id", { allowEmpty: false });
    const property = propertyMap.get(propertyId);
    if (!property) throw new HttpError(404, "NOT_FOUND", "database property not found");
    normalized.push(await normalizeDatabaseValueInput(db, workspaceId, property, value));
  }
  return normalized.map((value) => ({
    property_id: value.propertyId,
    value_text: value.valueText,
    value_number: value.valueNumber,
    value_boolean: value.valueBoolean,
    value_date: value.valueDate,
    value_json: value.valueJson,
  }));
}

export async function handleListDatabaseTemplates(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
) {
  const database = await getDatabaseById(db, workspaceId, databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");
  return jsonSuccess(await listDatabaseTemplates(db, workspaceId, databaseId));
}

export async function handleCreateDatabaseTemplate(
  db: D1Database,
  userId: string,
  workspaceId: string,
  databaseId: string,
  request: Request,
) {
  const database = await getDatabaseById(db, workspaceId, databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");
  const body = await parseJson<DatabaseTemplateBody>(request);
  const name = assertString(body.name, "name", { allowEmpty: false, max: 80 }).trim();
  const title = body.title === undefined ? "" : assertString(body.title, "title", { allowEmpty: true, max: 160 });
  const content = body.content === undefined ? "" : assertString(body.content, "content", { allowEmpty: true, max: 200000 });
  const defaultValues = await normalizeTemplateDefaultValues(db, workspaceId, databaseId, body.default_values);
  await insertDatabaseTemplate(db, {
    id: crypto.randomUUID(),
    databaseId,
    name,
    title,
    content,
    defaultValuesJson: JSON.stringify(defaultValues),
    createdByUserId: userId,
  });
  await insertActivityLog(db, { workspaceId, actorUserId: userId, action: "database_template.create", entityType: "database", entityId: databaseId, audit: true, metadata: { name } });
  return jsonSuccess(await listDatabaseTemplates(db, workspaceId, databaseId), { status: 201 });
}

export async function handleUpdateDatabaseTemplate(
  db: D1Database,
  userId: string,
  workspaceId: string,
  databaseId: string,
  templateId: string,
  request: Request,
) {
  const current = await getDatabaseTemplateById(db, workspaceId, databaseId, templateId);
  if (!current) throw new HttpError(404, "NOT_FOUND", "database template not found");
  const body = await parseJson<DatabaseTemplateBody>(request);
  const name = body.name === undefined ? undefined : assertString(body.name, "name", { allowEmpty: false, max: 80 }).trim();
  const title = body.title === undefined ? undefined : assertString(body.title, "title", { allowEmpty: true, max: 160 });
  const content = body.content === undefined ? undefined : assertString(body.content, "content", { allowEmpty: true, max: 200000 });
  const defaultValues = body.default_values === undefined ? undefined : await normalizeTemplateDefaultValues(db, workspaceId, databaseId, body.default_values);
  await updateDatabaseTemplateById(db, workspaceId, databaseId, templateId, {
    name,
    title,
    content,
    defaultValuesJson: defaultValues === undefined ? undefined : JSON.stringify(defaultValues),
  });
  await insertActivityLog(db, { workspaceId, actorUserId: userId, action: "database_template.update", entityType: "database_template", entityId: templateId, audit: true });
  return jsonSuccess(await listDatabaseTemplates(db, workspaceId, databaseId));
}

export async function handleDeleteDatabaseTemplate(
  db: D1Database,
  userId: string,
  workspaceId: string,
  databaseId: string,
  templateId: string,
) {
  await deleteDatabaseTemplateById(db, workspaceId, databaseId, templateId);
  await insertActivityLog(db, { workspaceId, actorUserId: userId, action: "database_template.delete", entityType: "database_template", entityId: templateId, audit: true });
  return jsonSuccess(await listDatabaseTemplates(db, workspaceId, databaseId));
}

export async function handleBatchDatabaseNotes(
  db: D1Database,
  userId: string,
  workspaceId: string,
  databaseId: string,
  request: Request,
  access?: DatabaseAccessOptions,
) {
  const database = await getDatabaseById(db, workspaceId, databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");
  const body = await parseJson<DatabaseBatchBody>(request);
  const noteIds = assertStringList(body.note_ids, "note_ids").slice(0, 200);
  if (noteIds.length === 0) throw new HttpError(400, "VALIDATION_ERROR", "note_ids are required");
  if (!body.action) throw new HttpError(400, "VALIDATION_ERROR", "batch action is required");

  if (body.action === "update_values") {
    const properties = await listDatabaseProperties(db, workspaceId, databaseId);
    const propertyMap = new Map(properties.map((property) => [property.id, property]));
    for (const value of body.values ?? []) {
      const propertyId = assertString(value.property_id, "property_id", { allowEmpty: false });
      if (!propertyMap.has(propertyId)) throw new HttpError(404, "NOT_FOUND", "database property not found");
      await requireWritableProperty(db, workspaceId, databaseId, propertyId, access);
    }
    for (const noteId of noteIds) {
      const note = await getNoteById(db, userId, workspaceId, noteId, true);
      if (!note || note.database_id !== databaseId) continue;
      const normalizedValues = [];
      for (const value of body.values ?? []) {
        const propertyId = assertString(value.property_id, "property_id", { allowEmpty: false });
        const property = propertyMap.get(propertyId);
        if (!property) throw new HttpError(404, "NOT_FOUND", "database property not found");
        normalizedValues.push(await normalizeDatabaseValueInput(db, workspaceId, property, value));
      }
      await upsertNotePropertyValues(db, workspaceId, noteId, normalizedValues);
    }
  }

  if (body.action === "archive") {
    await Promise.all(noteIds.map((noteId) => archiveNoteById(db, userId, workspaceId, noteId)));
  }

  if (body.action === "unarchive") {
    await Promise.all(noteIds.map((noteId) => unarchiveNoteById(db, userId, workspaceId, noteId)));
  }

  if (body.action === "duplicate") {
    await Promise.all(noteIds.map((noteId) => duplicateDatabaseNote(db, userId, workspaceId, noteId)));
  }

  await insertActivityLog(db, { workspaceId, actorUserId: userId, action: `database_notes.${body.action}`, entityType: "database", entityId: databaseId, audit: true, metadata: { count: noteIds.length } });
  return jsonSuccess(await listDatabaseNotes(db, userId, workspaceId, databaseId));
}

export async function handleListDatabaseDuplicates(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
) {
  const database = await getDatabaseById(db, workspaceId, databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");
  return jsonSuccess(await listDatabaseDuplicateTitleGroups(db, workspaceId, databaseId));
}

export async function handleListDatabasePermissions(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
) {
  const database = await getDatabaseById(db, workspaceId, databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");
  return jsonSuccess(await listDatabasePermissions(db, workspaceId, databaseId));
}

export async function handleUpdateDatabasePermissions(
  db: D1Database,
  userId: string,
  workspaceId: string,
  databaseId: string,
  request: Request,
) {
  const database = await getDatabaseById(db, workspaceId, databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");
  const body = await parseJson<DatabasePermissionsBody>(request);
  const permissions = (body.permissions ?? []).map((permission) => {
    const subjectType = permission.subject_type === "member" ? "member" : "workspace_role";
    const subjectId = assertString(permission.subject_id, "subject_id", { allowEmpty: false, max: 120 }).trim();
    const role = permission.role === "admin" || permission.role === "editor" ? permission.role : "viewer";
    return { subjectType, subjectId, role };
  });
  await replaceDatabasePermissions(db, workspaceId, databaseId, permissions);
  await insertActivityLog(db, { workspaceId, actorUserId: userId, action: "database_permissions.update", entityType: "database", entityId: databaseId, audit: true });
  return jsonSuccess(await listDatabasePermissions(db, workspaceId, databaseId));
}

export async function handleGetFieldPermissions(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  propertyId: string,
) {
  return jsonSuccess(await getDatabaseFieldPermission(db, workspaceId, databaseId, propertyId));
}

export async function handleUpdateFieldPermissions(
  db: D1Database,
  userId: string,
  workspaceId: string,
  databaseId: string,
  propertyId: string,
  request: Request,
) {
  const body = await parseJson<FieldPermissionsBody>(request);
  const validRoles = new Set(["owner", "editor", "viewer"]);
  const viewerRoles = assertStringList(body.viewer_roles, "viewer_roles").filter((role) => validRoles.has(role));
  const editorRoles = assertStringList(body.editor_roles, "editor_roles").filter((role) => validRoles.has(role));
  await upsertDatabaseFieldPermission(db, workspaceId, databaseId, propertyId, { viewerRoles, editorRoles });
  await insertActivityLog(db, { workspaceId, actorUserId: userId, action: "database_field_permissions.update", entityType: "database_property", entityId: propertyId, audit: true });
  return jsonSuccess(await getDatabaseFieldPermission(db, workspaceId, databaseId, propertyId));
}

export async function handleListDatabaseActivity(db: D1Database, workspaceId: string) {
  return jsonSuccess(await listActivityLogs(db, workspaceId));
}

export async function handleListDatabaseAudit(db: D1Database, workspaceId: string) {
  return jsonSuccess(await listAuditLogs(db, workspaceId));
}

export async function handleListComments(
  db: D1Database,
  workspaceId: string,
  request: Request,
  access?: DatabaseAccessOptions,
) {
  const url = new URL(request.url);
  const noteId = url.searchParams.get("noteId");
  const databaseId = url.searchParams.get("databaseId");
  if (!noteId && !databaseId) throw new HttpError(400, "VALIDATION_ERROR", "noteId or databaseId is required");
  if (databaseId) await requireReadableDatabase(db, workspaceId, databaseId, access);
  return jsonSuccess(await listComments(db, workspaceId, { noteId, databaseId }));
}

export async function handleCreateComment(
  db: D1Database,
  userId: string,
  workspaceId: string,
  request: Request,
) {
  const body = await parseJson<CommentBody>(request);
  const noteId = body.note_id ?? null;
  const databaseId = body.database_id ?? null;
  if (!noteId && !databaseId) throw new HttpError(400, "VALIDATION_ERROR", "note_id or database_id is required");
  const text = assertString(body.body, "body", { allowEmpty: false, max: 4000 }).trim();
  const mentions = assertStringList(body.mentions, "mentions");
  if (noteId) {
    const note = await getNoteById(db, userId, workspaceId, noteId, true);
    if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  }
  if (databaseId) {
    const database = await getDatabaseById(db, workspaceId, databaseId);
    if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");
  }
  await insertComment(db, { id: crypto.randomUUID(), workspaceId, noteId, databaseId, body: text, mentions, createdByUserId: userId });
  for (const mentionedUserId of mentions.filter((id) => id && id !== userId)) {
    await db
      .prepare(
        `INSERT INTO notifications (id, workspace_id, user_id, type, title, body, entity_type, entity_id)
         VALUES (?, ?, ?, 'mention', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        workspaceId,
        mentionedUserId,
        "你在评论中被提及",
        text.slice(0, 240),
        noteId ? "note" : "database",
        noteId ?? databaseId ?? "",
      )
      .run();
  }
  await insertActivityLog(db, { workspaceId, actorUserId: userId, action: "comment.create", entityType: noteId ? "note" : "database", entityId: noteId ?? databaseId ?? "", metadata: { mentions } });
  return jsonSuccess(await listComments(db, workspaceId, { noteId, databaseId }), { status: 201 });
}

export async function handleListSavedSearches(db: D1Database, workspaceId: string) {
  return jsonSuccess(await listSavedSearches(db, workspaceId));
}

export async function handleCreateSavedSearch(
  db: D1Database,
  userId: string,
  workspaceId: string,
  request: Request,
) {
  const body = await parseJson<SavedSearchBody>(request);
  const name = assertString(body.name, "name", { allowEmpty: false, max: 80 }).trim();
  const query = body.query === undefined ? "" : assertString(body.query, "query", { allowEmpty: true, max: 300 }).trim();
  const filters = normalizeSavedSearchFilters(body.filters);
  await insertSavedSearch(db, {
    id: crypto.randomUUID(),
    workspaceId,
    name,
    query,
    filtersJson: JSON.stringify(filters),
    createdByUserId: userId,
  });
  await insertActivityLog(db, { workspaceId, actorUserId: userId, action: "saved_search.create", entityType: "saved_search", entityId: name });
  return jsonSuccess(await listSavedSearches(db, workspaceId), { status: 201 });
}

export async function handleDeleteSavedSearch(db: D1Database, workspaceId: string, searchId: string) {
  await deleteSavedSearchById(db, workspaceId, searchId);
  return jsonSuccess(await listSavedSearches(db, workspaceId));
}

export async function handleKnowledgeDiagnostics(db: D1Database, workspaceId: string) {
  return jsonSuccess(await getKnowledgeDiagnostics(db, workspaceId));
}

export async function handleExportDatabaseCsv(
  db: D1Database,
  userId: string,
  workspaceId: string,
  databaseId: string,
  access?: DatabaseAccessOptions,
) {
  const database = await requireReadableDatabase(db, workspaceId, databaseId, access);
  const [allProperties, rawNotes, members] = await Promise.all([
    listDatabaseProperties(db, workspaceId, databaseId),
    listDatabaseNotes(db, userId, workspaceId, databaseId),
    listWorkspaceMembers(db, workspaceId),
  ]);
  const properties = await filterReadableProperties(db, workspaceId, databaseId, allProperties, access);
  const notes = filterDatabaseValuesByProperties(rawNotes, properties);
  const memberMap = new Map(members.map((member) => [member.user_id, member.display_name || member.email || member.user_id]));
  const headers = ["Title", ...properties.filter((property) => property.type !== "title").map((property) => property.name)];
  const lines = [headers.map(escapeCsvCell).join(",")];

  for (const note of notes) {
    const row = [note.title || ""];
    for (const property of properties.filter((item) => item.type !== "title")) {
      const value = note.database_values?.[property.id];
      if (!value) {
        row.push("");
        continue;
      }
      if (property.type === "single_select" || property.type === "multi_select") {
        const options = Array.isArray(property.config.options) ? property.config.options : [];
        row.push((value.value_json ?? []).map((id) => options.find((option) => option.id === id)?.name ?? id).join(" | "));
        continue;
      }
      if (property.type === "member") {
        row.push((value.value_json ?? []).map((id) => memberMap.get(id) ?? id).join(" | "));
        continue;
      }
      if (property.type === "checkbox") {
        row.push(value.value_boolean ? "true" : "false");
        continue;
      }
      if (property.type === "number" || property.type === "rating" || property.type === "progress") {
        row.push(value.value_number?.toString() ?? "");
        continue;
      }
      if (property.type === "date") {
        row.push(value.value_date ?? "");
        continue;
      }
      row.push(value.value_text ?? "");
    }
    lines.push(row.map(escapeCsvCell).join(","));
  }

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${encodeURIComponent(database.name || "database")}.csv"`,
    },
  });
}

export async function handleImportDatabaseCsv(
  db: D1Database,
  userId: string,
  workspaceId: string,
  databaseId: string,
  request: Request,
  access?: DatabaseAccessOptions,
) {
  const database = await getDatabaseById(db, workspaceId, databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file || typeof file.text !== "function") {
    throw new HttpError(400, "VALIDATION_ERROR", "csv file is required");
  }

  const [properties, existingNotes, members] = await Promise.all([
    listDatabaseProperties(db, workspaceId, databaseId),
    listDatabaseNotes(db, userId, workspaceId, databaseId),
    listWorkspaceMembers(db, workspaceId),
  ]);
  const rows = parseCsvText(await file.text());
  if (rows.length < 2) {
    throw new HttpError(400, "VALIDATION_ERROR", "csv must include a header row and at least one data row");
  }

  const titleAliases = new Set(["title", "标题", "name", "名称"]);
  const propertiesByName = new Map(properties.filter((property) => property.type !== "title").map((property) => [property.name.trim().toLowerCase(), property]));
  const headerRow = rows[0];
  const seenHeaders = new Set<string>();
  for (const header of headerRow) {
    const normalized = header.trim().toLowerCase();
    if (!normalized) continue;
    if (seenHeaders.has(normalized)) {
      throw new HttpError(400, "VALIDATION_ERROR", "csv headers must be unique");
    }
    seenHeaders.add(normalized);
  }
  const columnBindings = headerRow.map((header, index) => {
    const normalized = header.trim().toLowerCase();
    if (titleAliases.has(normalized)) return { kind: "title" as const, index };
    const property = propertiesByName.get(normalized);
    return property ? { kind: "property" as const, index, property } : { kind: "ignored" as const, index };
  });

  if (!columnBindings.some((binding) => binding.kind === "title")) {
    throw new HttpError(400, "VALIDATION_ERROR", "csv must include a Title column");
  }

  for (const binding of columnBindings) {
    if (binding.kind === "property") {
      await requireWritableProperty(db, workspaceId, databaseId, binding.property.id, access);
    }
  }

  const existingTitles = new Set(existingNotes.map((note) => note.title.trim().toLowerCase()).filter(Boolean));
  const memberLookup = new Map(
    members.flatMap((member) => {
      const labels = [member.user_id, member.email, member.display_name].filter((item): item is string => Boolean(item));
      return labels.map((label) => [label.trim().toLowerCase(), member.user_id] as const);
    }),
  );
  const selectConfigUpdates = new Map<string, { property: Awaited<ReturnType<typeof listDatabaseProperties>>[number]; options: Array<{ id: string; name: string; color: string }> }>();
  const warnings: string[] = [];
  const noteInserts: Array<{ id: string; title: string }> = [];
  const valueInserts: Array<{
    noteId: string;
    propertyId: string;
    valueText?: string | null;
    valueNumber?: number | null;
    valueBoolean?: boolean | null;
    valueDate?: string | null;
    valueJson?: string[] | null;
  }> = [];
  let imported = 0;

  for (const row of rows.slice(1)) {
    const titleCell = columnBindings.find((binding) => binding.kind === "title");
    const title = titleCell ? (row[titleCell.index] ?? "").trim() : "";
    if (!title) continue;
    if (existingTitles.has(title.toLowerCase())) {
      warnings.push(`duplicate title: ${title}`);
    }

    const noteId = crypto.randomUUID();
    noteInserts.push({ id: noteId, title });

    const valuesToWrite: Array<{
      propertyId: string;
      valueText?: string | null;
      valueNumber?: number | null;
      valueBoolean?: boolean | null;
      valueDate?: string | null;
      valueJson?: string[] | null;
    }> = [];

    for (const binding of columnBindings) {
      if (binding.kind !== "property") continue;
      const property = binding.property;
      const raw = (row[binding.index] ?? "").trim();
      if (!raw) continue;

      if (property.type === "single_select" || property.type === "multi_select") {
        const currentOptions = selectConfigUpdates.get(property.id)?.options ?? [...(Array.isArray(property.config.options) ? property.config.options : [])];
        const names = raw.split("|").map((item) => item.trim()).filter(Boolean);
        const nextIds: string[] = [];
        for (const name of names) {
          let option = currentOptions.find((item) => item.name.toLowerCase() === name.toLowerCase());
          if (!option) {
            option = { id: crypto.randomUUID(), name, color: "#6B9EFF" };
            currentOptions.push(option);
          }
          nextIds.push(option.id);
        }
        selectConfigUpdates.set(property.id, { property, options: currentOptions });
        valuesToWrite.push({
          propertyId: property.id,
          valueJson: property.type === "single_select" ? nextIds.slice(0, 1) : nextIds,
        });
        continue;
      }

      if (property.type === "member") {
        const nextIds = raw
          .split("|")
          .map((item) => memberLookup.get(item.trim().toLowerCase()) ?? "")
          .filter(Boolean);
        valuesToWrite.push({ propertyId: property.id, valueJson: property.config.multi === false ? nextIds.slice(0, 1) : nextIds });
        continue;
      }

      if (property.type === "checkbox") {
        valuesToWrite.push({ propertyId: property.id, valueBoolean: raw.toLowerCase() === "true" || raw === "1" || raw === "yes" });
        continue;
      }

      if (property.type === "number" || property.type === "rating" || property.type === "progress") {
        valuesToWrite.push({ propertyId: property.id, valueNumber: Number(raw) });
        continue;
      }

      if (property.type === "date") {
        valuesToWrite.push({ propertyId: property.id, valueDate: raw });
        continue;
      }

      valuesToWrite.push({ propertyId: property.id, valueText: raw });
    }

    if (valuesToWrite.length > 0) {
      const propertyMap = new Map(properties.map((property) => {
        const selectUpdate = selectConfigUpdates.get(property.id);
        return [property.id, selectUpdate ? { ...property, config: { ...property.config, options: selectUpdate.options } } : property];
      }));
      const normalizedValues = [];
      for (const value of valuesToWrite) {
        const property = propertyMap.get(value.propertyId);
        if (!property) continue;
        normalizedValues.push(await normalizeDatabaseValueInput(db, workspaceId, property, {
          property_id: value.propertyId,
          value_text: value.valueText,
          value_number: value.valueNumber,
          value_boolean: value.valueBoolean,
          value_date: value.valueDate,
          value_json: value.valueJson ?? undefined,
        }));
      }
      if (normalizedValues.length > 0) {
        valueInserts.push(...normalizedValues.map((value) => ({
          noteId,
          propertyId: value.propertyId,
          valueText: value.valueText,
          valueNumber: value.valueNumber,
          valueBoolean: value.valueBoolean,
          valueDate: value.valueDate,
          valueJson: value.valueJson,
        })));
      }
    }

    imported += 1;
  }

  const statements: D1PreparedStatement[] = [];
  for (const update of selectConfigUpdates.values()) {
    statements.push(
      db
        .prepare(
          `UPDATE database_properties
           SET config_json = ?, updated_at = datetime('now')
           WHERE id = ? AND database_id = ?
             AND EXISTS (SELECT 1 FROM databases WHERE id = ? AND workspace_id = ?)`,
        )
        .bind(JSON.stringify({ ...update.property.config, options: update.options }), update.property.id, databaseId, databaseId, workspaceId),
    );
  }

  for (const note of noteInserts) {
    statements.push(
      db
        .prepare(
          `INSERT INTO notes (id, user_id, workspace_id, folder_id, database_id, title, content, is_favorite, is_daily, daily_date)
           VALUES (?, ?, ?, NULL, ?, ?, '', 0, 0, NULL)`,
        )
        .bind(note.id, userId, workspaceId, databaseId, note.title),
    );
  }

  for (const value of valueInserts) {
    statements.push(
      db
        .prepare(
          `INSERT INTO note_property_values (
             note_id, property_id, value_text, value_number, value_boolean, value_date, value_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(note_id, property_id) DO UPDATE SET
             value_text = excluded.value_text,
             value_number = excluded.value_number,
             value_boolean = excluded.value_boolean,
             value_date = excluded.value_date,
             value_json = excluded.value_json,
             updated_at = datetime('now')`,
        )
        .bind(
          value.noteId,
          value.propertyId,
          value.valueText ?? null,
          value.valueNumber ?? null,
          value.valueBoolean === undefined || value.valueBoolean === null ? null : value.valueBoolean ? 1 : 0,
          value.valueDate ?? null,
          value.valueJson ? JSON.stringify(value.valueJson) : null,
        ),
    );
  }

  if (statements.length > 0) {
    try {
      await db.batch(statements);
    } catch (error) {
      throw error instanceof HttpError ? error : new HttpError(500, "CSV_IMPORT_FAILED", error instanceof Error ? error.message : "csv import failed and was rolled back");
    }
  }

  return jsonSuccess({
    imported,
    warnings,
    properties: await listDatabaseProperties(db, workspaceId, databaseId),
    notes: await listDatabaseNotes(db, userId, workspaceId, databaseId),
  }, { status: 201 });
}

export async function handleListDatabaseNotes(
  db: D1Database,
  userId: string,
  workspaceId: string,
  databaseId: string,
  access?: DatabaseAccessOptions,
) {
  await requireReadableDatabase(db, workspaceId, databaseId, access);
  const [properties, notes] = await Promise.all([
    listDatabaseProperties(db, workspaceId, databaseId),
    listDatabaseNotes(db, userId, workspaceId, databaseId),
  ]);
  const readableProperties = await filterReadableProperties(db, workspaceId, databaseId, properties, access);
  return jsonSuccess(filterDatabaseValuesByProperties(notes, readableProperties));
}

export async function handleCreateDatabaseNote(
  db: D1Database,
  userId: string,
  workspaceId: string,
  databaseId: string,
  request?: Request,
) {
  const database = await getDatabaseById(db, workspaceId, databaseId);
  if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");
  const templateId = request ? new URL(request.url).searchParams.get("templateId") : null;
  const template = templateId ? await getDatabaseTemplateById(db, workspaceId, databaseId, templateId) : null;

  const id = crypto.randomUUID();
  await insertNote(db, userId, workspaceId, {
    id,
    title: template?.title ?? "",
    content: template?.content ?? "",
    isFavorite: false,
    databaseId,
    folderId: null,
  });
  if (template?.default_values?.length) {
    const properties = await listDatabaseProperties(db, workspaceId, databaseId);
    const propertyMap = new Map(properties.map((property) => [property.id, property]));
    const normalizedValues = [];
    for (const value of template.default_values as NonNullable<UpdateDatabaseValuesBody["values"]>) {
      const property = propertyMap.get(value.property_id ?? "");
      if (!property) continue;
      normalizedValues.push(await normalizeDatabaseValueInput(db, workspaceId, property, value));
    }
    await upsertNotePropertyValues(db, workspaceId, id, normalizedValues);
  }
  await insertActivityLog(db, { workspaceId, actorUserId: userId, action: "database_note.create", entityType: "database", entityId: databaseId, metadata: { template_id: template?.id ?? null } });

  const note = await getNoteById(db, userId, workspaceId, id);
  if (!note) throw new HttpError(500, "INTERNAL_ERROR", "failed to create database note");
  return jsonSuccess(note, { status: 201 });
}

export async function handleUpdateDatabaseNoteValues(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
  request: Request,
  access?: DatabaseAccessOptions,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId, true);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  if (!note.database_id) throw new HttpError(400, "VALIDATION_ERROR", "note does not belong to a database");

  const body = await parseJson<UpdateDatabaseValuesBody>(request);
  const values = body.values ?? [];
  const properties = await listDatabaseProperties(db, workspaceId, note.database_id);
  const propertyMap = new Map(properties.map((property) => [property.id, property]));

  const normalizedValues = [];
  for (const value of values) {
    const propertyId = assertString(value.property_id, "property_id", { allowEmpty: false });
    const property = propertyMap.get(propertyId);
    if (!property) throw new HttpError(404, "NOT_FOUND", "database property not found");
    await requireWritableProperty(db, workspaceId, note.database_id, propertyId, access);
    normalizedValues.push(await normalizeDatabaseValueInput(db, workspaceId, property, value));
  }

  await upsertNotePropertyValues(db, workspaceId, noteId, normalizedValues);
  const refreshed = await getNoteById(db, userId, workspaceId, noteId, true);
  if (!refreshed) throw new HttpError(500, "INTERNAL_ERROR", "failed to refresh note");
  return jsonSuccess(refreshed);
}

export async function handleUpdateDatabaseMembership(
  db: D1Database,
  workspaceId: string,
  noteId: string,
  request: Request,
) {
  const note = await getNoteById(db, "", workspaceId, noteId, true);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");

  const body = await parseJson<UpdateDatabaseMembershipBody>(request);
  const databaseId = body.database_id === undefined ? undefined : body.database_id;
  if (databaseId !== null && databaseId !== undefined) {
    const database = await getDatabaseById(db, workspaceId, databaseId);
    if (!database) throw new HttpError(404, "NOT_FOUND", "database not found");
  }

  await updateNoteById(db, "", workspaceId, noteId, {
    databaseId: databaseId === undefined ? undefined : databaseId,
  });
  const refreshed = await getNoteById(db, "", workspaceId, noteId, true);
  if (!refreshed) throw new HttpError(500, "INTERNAL_ERROR", "failed to refresh note");
  return jsonSuccess(refreshed);
}
