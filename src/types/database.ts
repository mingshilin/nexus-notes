export type DatabasePropertyType =
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

export type DatabaseViewKind = "table" | "board" | "calendar";
export type DatabaseSortDirection = "asc" | "desc";
export type DatabaseFilterMode = "and" | "or";
export type DatabasePermissionRole = "viewer" | "editor" | "admin";
export type DatabaseFilterOperator =
  | "contains"
  | "equals"
  | "not_equals"
  | "is_empty"
  | "not_empty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "on"
  | "before"
  | "after"
  | "on_or_before"
  | "on_or_after"
  | "has_any"
  | "has_all";

export interface SelectOption {
  id: string;
  name: string;
  color: string;
}

export interface DatabasePropertyConfig {
  options?: SelectOption[];
  multi?: boolean;
}

export interface DatabaseFilterRule {
  id: string;
  property_id: string;
  operator: DatabaseFilterOperator;
  value?: string | null;
  values?: string[];
}

export interface DatabaseAdvancedFilter {
  mode: DatabaseFilterMode;
  rules: DatabaseFilterRule[];
}

export interface DatabaseViewSnapshot {
  view: DatabaseViewKind;
  visibleColumnIds: string[];
  filterQuery: string;
  filterPropertyId: string;
  filterPropertyValue: string;
  advancedFilter: DatabaseAdvancedFilter;
  sortField: "updated_at" | "title" | string;
  sortDirection: DatabaseSortDirection;
}

export interface DatabaseView extends DatabaseViewSnapshot {
  id: string;
  database_id: string;
  name: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface DatabaseRecordTemplate {
  id: string;
  database_id: string;
  name: string;
  title: string;
  content: string;
  default_values: UpdateDatabaseNoteValuesPayload["values"];
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface DatabasePermission {
  id: string;
  database_id: string;
  subject_type: "workspace_role" | "member";
  subject_id: string;
  role: DatabasePermissionRole;
  created_at: string;
  updated_at: string;
}

export interface DatabaseFieldPermission {
  id: string;
  property_id: string;
  viewer_roles: string[];
  editor_roles: string[];
  created_at: string;
  updated_at: string;
}

export interface DatabaseDuplicateGroup {
  title: string;
  notes: Array<{ id: string; title: string; updated_at: string }>;
}

export interface Database {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  created_by_user_id: string;
  board_property_id: string | null;
  calendar_property_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DatabaseProperty {
  id: string;
  database_id: string;
  name: string;
  type: DatabasePropertyType;
  config: DatabasePropertyConfig;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DatabaseNoteValue {
  property_id: string;
  type: DatabasePropertyType;
  value_text?: string | null;
  value_number?: number | null;
  value_boolean?: boolean | null;
  value_date?: string | null;
  value_json?: string[] | null;
}

export type DatabaseNoteValuesMap = Record<string, DatabaseNoteValue>;

export interface MemberPropertyValue {
  property_id: string;
  member_ids: string[];
}

export interface CreateDatabasePayload {
  name: string;
  description?: string;
  icon?: string;
  initial_status_property?: boolean;
  initial_date_property?: boolean;
  bind_board_property?: boolean;
  bind_calendar_property?: boolean;
}

export interface UpdateDatabasePayload {
  name?: string;
  description?: string | null;
  icon?: string | null;
  board_property_id?: string | null;
  calendar_property_id?: string | null;
}

export interface CreateDatabasePropertyPayload {
  name: string;
  type: DatabasePropertyType;
  config?: DatabasePropertyConfig;
}

export interface UpdateDatabasePropertyPayload {
  name?: string;
  config?: DatabasePropertyConfig;
  sort_order?: number;
}

export interface CreateDatabaseViewPayload {
  name: string;
  view: DatabaseViewKind;
  visibleColumnIds: string[];
  filterQuery: string;
  filterPropertyId: string;
  filterPropertyValue: string;
  advancedFilter: DatabaseAdvancedFilter;
  sortField: "updated_at" | "title" | string;
  sortDirection: DatabaseSortDirection;
}

export interface UpdateDatabaseViewPayload extends Partial<CreateDatabaseViewPayload> {}

export interface UpdateDatabaseNoteValuesPayload {
  values: Array<{
    property_id: string;
    value_text?: string | null;
    value_number?: number | null;
    value_boolean?: boolean | null;
    value_date?: string | null;
    value_json?: string[] | null;
  }>;
}

export interface CreateDatabaseTemplatePayload {
  name: string;
  title?: string;
  content?: string;
  default_values?: UpdateDatabaseNoteValuesPayload["values"];
}

export interface UpdateDatabaseTemplatePayload extends Partial<CreateDatabaseTemplatePayload> {}

export interface BatchDatabaseNotesPayload {
  note_ids: string[];
  action: "archive" | "unarchive" | "duplicate" | "update_values";
  values?: UpdateDatabaseNoteValuesPayload["values"];
}
