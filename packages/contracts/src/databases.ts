import { z } from "zod";

const EntityIdSchema = z.string().trim().min(1).max(128);
const RevisionSchema = z.number().int().positive();
const TimestampSchema = z.string().datetime({ offset: true });
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const NameSchema = z.string().trim().min(1).max(160);
const PropertyValuesSchema = z.record(EntityIdSchema, z.unknown());
const PermissionSubjectTypeSchema = z.enum(["user", "role"]);

export const DatabasePropertyTypeSchema = z.enum([
  "text",
  "number",
  "checkbox",
  "select",
  "multi_select",
  "date",
  "url",
  "email",
  "member",
  "relation",
]);

export type DatabasePropertyType = z.infer<typeof DatabasePropertyTypeSchema>;

export const DatabasePermissionRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type DatabasePermissionRole = z.infer<typeof DatabasePermissionRoleSchema>;

export const DatabaseSelectOptionSchema = z.object({
  id: EntityIdSchema,
  name: NameSchema,
  color: z.string().trim().max(40).default(""),
}).strict();

const EmptyConfigSchema = z.object({}).strict();
const propertyConfigSchemas: Record<DatabasePropertyType, z.ZodType> = {
  text: z.object({ max_length: z.number().int().positive().max(200_000).optional() }).strict(),
  number: z.object({ precision: z.number().int().min(0).max(12).optional() }).strict(),
  checkbox: EmptyConfigSchema,
  select: z.object({ options: z.array(DatabaseSelectOptionSchema).max(100) }).strict(),
  multi_select: z.object({ options: z.array(DatabaseSelectOptionSchema).max(100) }).strict(),
  date: EmptyConfigSchema,
  url: EmptyConfigSchema,
  email: EmptyConfigSchema,
  member: z.object({ allow_multiple: z.boolean().optional() }).strict(),
  relation: z.object({ target_database_id: EntityIdSchema, allow_multiple: z.boolean().optional() }).strict(),
};

function validatePropertyConfig(
  value: { type: DatabasePropertyType; config: unknown },
  context: z.RefinementCtx,
) {
  const parsed = propertyConfigSchemas[value.type].safeParse(value.config);
  if (!parsed.success) {
    context.addIssue({
      code: "custom",
      path: ["config"],
      message: `Invalid ${value.type} property configuration`,
    });
  }
}

const DatabasePropertyDefinitionSchema = z.object({
  name: NameSchema,
  type: DatabasePropertyTypeSchema,
  config: z.unknown().default({}),
  position: z.number().int().min(0).max(10_000).default(0),
  hidden: z.boolean().default(false),
  read_only: z.boolean().default(false),
}).strict().superRefine(validatePropertyConfig);

export const DatabaseSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  name: NameSchema,
  description: z.string().max(4_000),
  created_by: EntityIdSchema,
  revision: RevisionSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();

export type Database = z.infer<typeof DatabaseSchema>;

export const DatabasePropertySchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  database_id: EntityIdSchema,
  name: NameSchema,
  type: DatabasePropertyTypeSchema,
  config: z.unknown(),
  position: z.number().int().min(0),
  hidden: z.boolean(),
  read_only: z.boolean(),
  revision: RevisionSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict().superRefine(validatePropertyConfig);

export type DatabaseProperty = z.infer<typeof DatabasePropertySchema>;

export const DatabaseRecordSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  database_id: EntityIdSchema,
  note_id: EntityIdSchema.nullable(),
  values: PropertyValuesSchema,
  created_by: EntityIdSchema,
  updated_by: EntityIdSchema,
  revision: RevisionSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();

export type DatabaseRecord = z.infer<typeof DatabaseRecordSchema>;

export const DatabaseRecordCursorPageSchema = z.object({
  items: z.array(DatabaseRecordSchema).max(100),
  next_cursor: z.string().trim().min(1).nullable(),
}).strict();

export type DatabaseRecordCursorPage = z.infer<typeof DatabaseRecordCursorPageSchema>;

export const DatabaseFilterSchema = z.object({
  property_id: EntityIdSchema,
  operator: z.enum(["equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty", "before", "after"]),
  value: z.unknown().optional(),
}).strict();

export const DatabaseSortSchema = z.object({
  property_id: EntityIdSchema,
  direction: z.enum(["asc", "desc"]),
}).strict();

export const DatabaseViewConfigSchema = z.object({
  filters: z.array(DatabaseFilterSchema).max(20),
  sorts: z.array(DatabaseSortSchema).max(10),
  grouping: z.object({ property_id: EntityIdSchema }).strict().nullable(),
  visible_columns: z.array(EntityIdSchema).max(100),
  page_size: z.number().int().min(1).max(100),
  settings: z.object({
    frozen_property_id: EntityIdSchema.nullable().optional(),
    row_height: z.enum(["compact", "default", "comfortable"]).optional(),
    card_properties: z.array(EntityIdSchema).max(20).optional(),
    hide_empty_groups: z.boolean().optional(),
    segment_size: z.number().int().min(10).max(200).optional(),
    date_property_id: EntityIdSchema.nullable().optional(),
    show_undated: z.boolean().optional(),
    week_start: z.enum(["monday", "sunday"]).optional(),
  }).strict(),
}).strict();

export const DatabaseViewSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  database_id: EntityIdSchema,
  name: NameSchema,
  type: z.enum(["table", "board", "calendar"]),
  config: DatabaseViewConfigSchema,
  position: z.number().int().min(0),
  revision: RevisionSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();

export type DatabaseView = z.infer<typeof DatabaseViewSchema>;

export const DatabaseTemplateSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  database_id: EntityIdSchema,
  name: NameSchema,
  default_values: PropertyValuesSchema,
  revision: RevisionSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();

export type DatabaseTemplate = z.infer<typeof DatabaseTemplateSchema>;

export const DatabaseCommentSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  database_id: EntityIdSchema,
  record_id: EntityIdSchema,
  author_user_id: EntityIdSchema,
  parent_id: EntityIdSchema.nullable(),
  body: z.string().trim().min(1).max(20_000),
  revision: RevisionSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();

export type DatabaseComment = z.infer<typeof DatabaseCommentSchema>;

export const DatabasePermissionSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  database_id: EntityIdSchema,
  subject_type: PermissionSubjectTypeSchema,
  subject_id: EntityIdSchema,
  role: DatabasePermissionRoleSchema,
  revision: RevisionSchema,
  updated_at: TimestampSchema,
}).strict();

export type DatabasePermission = z.infer<typeof DatabasePermissionSchema>;

export const FieldPermissionSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  database_id: EntityIdSchema,
  property_id: EntityIdSchema,
  subject_type: PermissionSubjectTypeSchema,
  subject_id: EntityIdSchema,
  can_read: z.boolean(),
  can_write: z.boolean(),
  revision: RevisionSchema,
  updated_at: TimestampSchema,
}).strict().refine((permission) => !permission.can_write || permission.can_read, {
  message: "Writable fields must also be readable",
  path: ["can_write"],
});

export type FieldPermission = z.infer<typeof FieldPermissionSchema>;

export const CreateDatabaseInputSchema = z.object({
  name: NameSchema,
  description: z.string().max(4_000).default(""),
}).strict();
export type CreateDatabaseInput = z.infer<typeof CreateDatabaseInputSchema>;

export const UpdateDatabaseInputSchema = z.object({
  base_revision: RevisionSchema,
  name: NameSchema.optional(),
  description: z.string().max(4_000).optional(),
}).strict().refine((input) => input.name !== undefined || input.description !== undefined, {
  message: "At least one database field must change",
});
export type UpdateDatabaseInput = z.infer<typeof UpdateDatabaseInputSchema>;

export const DeleteDatabaseInputSchema = z.object({ base_revision: RevisionSchema }).strict();
export type DeleteDatabaseInput = z.infer<typeof DeleteDatabaseInputSchema>;

export const CreateDatabasePropertyInputSchema = DatabasePropertyDefinitionSchema;
export type CreateDatabasePropertyInput = z.infer<typeof CreateDatabasePropertyInputSchema>;

export const UpdateDatabasePropertyInputSchema = z.object({
  base_revision: RevisionSchema,
  name: NameSchema.optional(),
  config: z.unknown().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  hidden: z.boolean().optional(),
  read_only: z.boolean().optional(),
}).strict().refine((input) => Object.keys(input).some((key) => key !== "base_revision"), {
  message: "At least one property field must change",
});
export type UpdateDatabasePropertyInput = z.infer<typeof UpdateDatabasePropertyInputSchema>;

export const CreateDatabaseRecordInputSchema = z.object({
  note_id: EntityIdSchema.nullable().default(null),
  values: PropertyValuesSchema.default({}),
}).strict();
export type CreateDatabaseRecordInput = z.infer<typeof CreateDatabaseRecordInputSchema>;

export const UpdateDatabaseRecordInputSchema = z.object({
  base_revision: RevisionSchema,
  values: PropertyValuesSchema.refine((values) => Object.keys(values).length > 0, "At least one value must change"),
}).strict();
export type UpdateDatabaseRecordInput = z.infer<typeof UpdateDatabaseRecordInputSchema>;

export const DeleteDatabaseRecordInputSchema = z.object({ base_revision: RevisionSchema }).strict();
export type DeleteDatabaseRecordInput = z.infer<typeof DeleteDatabaseRecordInputSchema>;

export const CreateDatabaseViewInputSchema = z.object({
  name: NameSchema,
  type: z.enum(["table", "board", "calendar"]),
  config: DatabaseViewConfigSchema,
  position: z.number().int().min(0).max(10_000).default(0),
}).strict();
export type CreateDatabaseViewInput = z.infer<typeof CreateDatabaseViewInputSchema>;

export const UpdateDatabaseViewInputSchema = z.object({
  base_revision: RevisionSchema,
  name: NameSchema.optional(),
  config: DatabaseViewConfigSchema.optional(),
  position: z.number().int().min(0).max(10_000).optional(),
}).strict().refine((input) => Object.keys(input).some((key) => key !== "base_revision"), {
  message: "At least one view field must change",
});
export type UpdateDatabaseViewInput = z.infer<typeof UpdateDatabaseViewInputSchema>;

export const CreateDatabaseTemplateInputSchema = z.object({
  name: NameSchema,
  default_values: PropertyValuesSchema,
}).strict();
export type CreateDatabaseTemplateInput = z.infer<typeof CreateDatabaseTemplateInputSchema>;

export const UpdateDatabaseTemplateInputSchema = z.object({
  base_revision: RevisionSchema,
  name: NameSchema.optional(),
  default_values: PropertyValuesSchema.optional(),
}).strict().refine((input) => Object.keys(input).some((key) => key !== "base_revision"), {
  message: "At least one template field must change",
});
export type UpdateDatabaseTemplateInput = z.infer<typeof UpdateDatabaseTemplateInputSchema>;

export const CreateDatabaseCommentInputSchema = z.object({
  record_id: EntityIdSchema,
  parent_id: EntityIdSchema.nullable().optional(),
  body: z.string().trim().min(1).max(20_000),
}).strict();
export type CreateDatabaseCommentInput = z.infer<typeof CreateDatabaseCommentInputSchema>;

export const UpdateDatabaseCommentInputSchema = z.object({
  base_revision: RevisionSchema,
  body: z.string().trim().min(1).max(20_000),
}).strict();
export type UpdateDatabaseCommentInput = z.infer<typeof UpdateDatabaseCommentInputSchema>;

export const SetDatabasePermissionInputSchema = z.object({
  subject_type: PermissionSubjectTypeSchema,
  subject_id: EntityIdSchema,
  role: DatabasePermissionRoleSchema,
  base_revision: RevisionSchema,
}).strict();
export type SetDatabasePermissionInput = z.infer<typeof SetDatabasePermissionInputSchema>;

export const SetFieldPermissionInputSchema = z.object({
  subject_type: PermissionSubjectTypeSchema,
  subject_id: EntityIdSchema,
  can_read: z.boolean(),
  can_write: z.boolean(),
  base_revision: RevisionSchema,
}).strict().refine((permission) => !permission.can_write || permission.can_read, {
  message: "Writable fields must also be readable",
  path: ["can_write"],
});
export type SetFieldPermissionInput = z.infer<typeof SetFieldPermissionInputSchema>;

const RecordMutationSchema = z.object({
  record_id: EntityIdSchema,
  base_revision: RevisionSchema,
  values: PropertyValuesSchema.refine((values) => Object.keys(values).length > 0, "At least one value must change"),
}).strict();

export const BulkEditRecordsInputSchema = z.object({
  mutations: z.array(RecordMutationSchema).min(1).max(100),
}).strict();
export type BulkEditRecordsInput = z.infer<typeof BulkEditRecordsInputSchema>;

export const BoardMoveInputSchema = z.object({
  record_id: EntityIdSchema,
  property_id: EntityIdSchema,
  option_id: EntityIdSchema.nullable(),
  base_revision: RevisionSchema,
}).strict();
export type BoardMoveInput = z.infer<typeof BoardMoveInputSchema>;

export const CalendarAssignmentInputSchema = z.object({
  record_id: EntityIdSchema,
  property_id: EntityIdSchema,
  date: DateSchema.nullable(),
  base_revision: RevisionSchema,
}).strict();
export type CalendarAssignmentInput = z.infer<typeof CalendarAssignmentInputSchema>;

export const ApplyDatabaseTemplateInputSchema = z.object({
  template_id: EntityIdSchema,
  records: z.array(z.object({
    record_id: EntityIdSchema,
    base_revision: RevisionSchema,
  }).strict()).min(1).max(100),
}).strict();
export type ApplyDatabaseTemplateInput = z.infer<typeof ApplyDatabaseTemplateInputSchema>;

export const CsvImportInputSchema = z.object({
  csv: z.string().min(1).max(2 * 1024 * 1024),
  header_property_ids: z.record(z.string().trim().min(1).max(160), EntityIdSchema),
}).strict();
export type CsvImportInput = z.infer<typeof CsvImportInputSchema>;

export const CsvExportInputSchema = z.object({
  property_ids: z.array(EntityIdSchema).min(1).max(100),
  cursor: z.string().trim().min(1).nullable().default(null),
  page_size: z.number().int().min(1).max(1_000).default(100),
}).strict();
export type CsvExportInput = z.infer<typeof CsvExportInputSchema>;
