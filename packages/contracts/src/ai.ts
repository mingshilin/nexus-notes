import { z } from "zod";

const EntityIdSchema = z.string().trim().min(1).max(128);
const TimestampSchema = z.string().datetime({ offset: true });

const AiMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4_000),
}).strict().transform((message) => ({
  role: message.role,
  content: message.content.trim(),
}));

export const AiReadToolNameSchema = z.enum([
  "search_notes",
  "get_note",
  "list_reminders",
  "search_databases",
  "get_database_record",
]);
export type AiReadToolName = z.infer<typeof AiReadToolNameSchema>;

export const AiReadContextSchema = z.object({
  workspaceId: EntityIdSchema,
  userId: EntityIdSchema,
  selectedNoteIds: z.array(EntityIdSchema).max(100).transform((ids) => [...new Set(ids)]),
  selectedDatabaseIds: z.array(EntityIdSchema).max(100).transform((ids) => [...new Set(ids)]),
  allowWorkspaceSearch: z.boolean(),
}).strict();
export type AiReadContext = z.infer<typeof AiReadContextSchema>;

export const AiReadScopeInputSchema = z.object({
  selected_note_ids: z.array(EntityIdSchema).max(100).default([]),
  selected_database_ids: z.array(EntityIdSchema).max(100).default([]),
  allow_workspace_search: z.boolean().default(false),
}).strict();
export type AiReadScopeInput = z.infer<typeof AiReadScopeInputSchema>;

export const AiChatInputSchema = z.object({
  messages: z.array(AiMessageSchema).min(1).max(20),
  read_context: AiReadScopeInputSchema.optional(),
}).strict().superRefine((input, context) => {
  const totalCharacters = input.messages.reduce((total, message) => total + message.content.length, 0);
  if (totalCharacters > 32_000) {
    context.addIssue({ code: "custom", message: "AI conversation exceeds the 32,000 character limit" });
  }
});
export type AiChatInput = z.infer<typeof AiChatInputSchema>;
export type AiChatMessage = AiChatInput["messages"][number];

export const AiChatResponseSchema = z.object({
  message: z.string().trim().min(1).max(8_000),
  model: z.string().trim().min(1).max(128),
  action_proposals: z.array(z.lazy(() => AiActionProposalSchema)).optional(),
  read_results: z.array(z.lazy(() => AiReadResultSchema)).max(5).optional(),
}).strict();
export type AiChatResponse = z.infer<typeof AiChatResponseSchema>;

const AiBaseUrlSchema = z.string().trim().url().max(2048).refine((value) => new URL(value).protocol === "https:", "AI base URL must use HTTPS");
const AiModelSchema = z.string().trim().min(1).max(128);
const AiKeySchema = z.string().trim().min(16).max(512);
const PositiveRevisionSchema = z.number().int().positive();

export const AI_ACTION_PROPOSAL_TTL_MS = 10 * 60 * 1000;
export const AI_TRUSTED_MODE_TTL_MS = 24 * 60 * 60 * 1000;

const ReadLimitSchema = z.coerce.number().int().min(1).max(1_000).default(20);
const ReadCursorSchema = z.string().trim().min(1).max(1_024).optional();

const AiSearchNotesInputSchema = z.object({
  query: z.string().trim().max(500).default(""),
  limit: ReadLimitSchema,
  cursor: ReadCursorSchema,
}).strict();
const AiGetNoteInputSchema = z.object({ note_id: EntityIdSchema }).strict();
const AiListRemindersInputSchema = z.object({
  include_completed: z.boolean().default(false),
  query: z.string().trim().max(160).optional(),
  limit: ReadLimitSchema,
  cursor: ReadCursorSchema,
}).strict();
const AiSearchDatabasesInputSchema = z.object({
  query: z.string().trim().max(500).default(""),
  limit: ReadLimitSchema,
  cursor: ReadCursorSchema,
}).strict();
const AiGetDatabaseRecordInputSchema = z.object({
  database_id: EntityIdSchema,
  record_id: EntityIdSchema,
}).strict();

export const AiReadToolCallSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("search_notes"), input: AiSearchNotesInputSchema }).strict(),
  z.object({ tool: z.literal("get_note"), input: AiGetNoteInputSchema }).strict(),
  z.object({ tool: z.literal("list_reminders"), input: AiListRemindersInputSchema }).strict(),
  z.object({ tool: z.literal("search_databases"), input: AiSearchDatabasesInputSchema }).strict(),
  z.object({ tool: z.literal("get_database_record"), input: AiGetDatabaseRecordInputSchema }).strict(),
]);
export type AiReadToolCall = z.infer<typeof AiReadToolCallSchema>;

export const AiReadSourceTypeSchema = z.enum(["note", "reminder", "database", "database_record"]);
export type AiReadSourceType = z.infer<typeof AiReadSourceTypeSchema>;

export const AiReadItemSchema = z.object({
  source_type: AiReadSourceTypeSchema,
  source_id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  title: z.string().max(160),
  excerpt: z.string().max(1_000).optional(),
  content: z.string().max(20_000).optional(),
  values: z.record(EntityIdSchema, z.unknown()).optional(),
  hit_sources: z.array(z.enum(["title", "content", "tags", "properties", "attachment_name", "ocr"])).max(6).optional(),
  remind_at: TimestampSchema.optional(),
  status: z.string().trim().min(1).max(32).optional(),
  revision: PositiveRevisionSchema,
  updated_at: TimestampSchema,
}).strict().superRefine((item, context) => {
  try {
    const serialized = JSON.stringify(item.values);
    if (serialized && new TextEncoder().encode(serialized).byteLength > 16_000) {
      context.addIssue({ code: "custom", path: ["values"], message: "AI read values exceed the bounded response size" });
    }
  } catch {
    context.addIssue({ code: "custom", path: ["values"], message: "AI read values must be JSON serializable" });
  }
});
export type AiReadItem = z.infer<typeof AiReadItemSchema>;

export const AiReadResultSchema = z.object({
  tool: AiReadToolNameSchema,
  items: z.array(AiReadItemSchema).max(50),
  next_cursor: z.string().trim().min(1).max(1_024).nullable(),
  scope: z.object({ workspace_id: EntityIdSchema, selected_only: z.boolean() }).strict(),
}).strict();
export type AiReadResult = z.infer<typeof AiReadResultSchema>;

export const AiToolRiskSchema = z.enum([
  "read",
  "safe_write",
  "confirmed_write",
  "external_or_destructive",
]);
export type AiToolRisk = z.infer<typeof AiToolRiskSchema>;

export const AiToolTargetSchema = z.enum(["current", "selected", "workspace"]);
export type AiToolTarget = z.infer<typeof AiToolTargetSchema>;

export const AI_TOOL_CATALOG = [
  { name: "search_notes", risk: "read" },
  { name: "get_note", risk: "read" },
  { name: "list_reminders", risk: "read" },
  { name: "search_databases", risk: "read" },
  { name: "get_database_record", risk: "read" },
  { name: "create_note", risk: "safe_write" },
  { name: "create_reminder", risk: "safe_write" },
  { name: "create_notification", risk: "safe_write" },
  { name: "create_folder", risk: "confirmed_write" },
  { name: "update_note", risk: "confirmed_write" },
  { name: "move_note", risk: "confirmed_write" },
  { name: "archive_note", risk: "confirmed_write" },
  { name: "restore_note", risk: "confirmed_write" },
  { name: "delete_note", risk: "confirmed_write" },
  { name: "apply_tag", risk: "confirmed_write" },
  { name: "create_database_record", risk: "confirmed_write" },
  { name: "update_database_record", risk: "confirmed_write" },
  { name: "apply_template", risk: "confirmed_write" },
  { name: "complete_reminder", risk: "confirmed_write" },
  { name: "send_email", risk: "external_or_destructive" },
  { name: "change_permissions", risk: "external_or_destructive" },
  { name: "delete_database", risk: "external_or_destructive" },
] as const satisfies readonly { name: string; risk: AiToolRisk }[];

type AiCatalogToolName = typeof AI_TOOL_CATALOG[number]["name"];
const AiToolNames = AI_TOOL_CATALOG.map((entry) => entry.name) as [AiCatalogToolName, ...AiCatalogToolName[]];

export const AiToolNameSchema = z.enum(AiToolNames);
export type AiToolName = z.infer<typeof AiToolNameSchema>;

export const AiActionToolNameSchema = z.enum([
  "create_note",
  "create_reminder",
  "create_notification",
  "send_email",
]);
export type AiActionToolName = z.infer<typeof AiActionToolNameSchema>;

export const AiTrustedModeSchema = z.object({
  workspace_id: EntityIdSchema,
  enabled: z.boolean(),
  expires_at: TimestampSchema.nullable(),
  revision: PositiveRevisionSchema,
}).strict().superRefine((value, context) => {
  if (value.enabled && value.expires_at === null) {
    context.addIssue({ code: "custom", path: ["expires_at"], message: "Enabled trusted mode requires an expiry" });
  }
  if (!value.enabled && value.expires_at !== null) {
    context.addIssue({ code: "custom", path: ["expires_at"], message: "Disabled trusted mode cannot have an expiry" });
  }
});
export type AiTrustedMode = z.infer<typeof AiTrustedModeSchema>;

export const UpdateAiTrustedModeInputSchema = z.object({
  enabled: z.boolean(),
  expires_at: TimestampSchema.nullable(),
  base_revision: PositiveRevisionSchema,
}).strict().superRefine((value, context) => {
  if (value.enabled && value.expires_at === null) {
    context.addIssue({ code: "custom", path: ["expires_at"], message: "Enabled trusted mode requires an expiry" });
  }
  if (!value.enabled && value.expires_at !== null) {
    context.addIssue({ code: "custom", path: ["expires_at"], message: "Disabled trusted mode cannot have an expiry" });
  }
});
export type UpdateAiTrustedModeInput = z.infer<typeof UpdateAiTrustedModeInputSchema>;

export const AiUserConfigSummarySchema = z.object({
  configured: z.boolean(),
  source: z.enum(["personal", "server_default", "unconfigured"]),
  base_url: AiBaseUrlSchema.optional(),
  model: AiModelSchema.optional(),
  key_hint: z.string().min(1).max(32).optional(),
  verified_at: TimestampSchema.nullable().optional(),
  revision: PositiveRevisionSchema.optional(),
}).strict();

export const UpsertAiUserConfigInputSchema = z.object({
  base_url: AiBaseUrlSchema,
  model: AiModelSchema,
  api_key: AiKeySchema.optional(),
  base_revision: PositiveRevisionSchema.nullable().optional(),
}).strict();

export const TestAiUserConfigInputSchema = z.object({
  base_url: AiBaseUrlSchema.optional(),
  model: AiModelSchema.optional(),
  api_key: AiKeySchema.optional(),
}).strict();

export const DeleteAiUserConfigInputSchema = z.object({
  base_revision: PositiveRevisionSchema,
}).strict();

const BoundedJsonSchema: z.ZodType<unknown> = z.unknown().superRefine((value, context) => {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      context.addIssue({ code: "custom", message: "AI action input must be JSON serializable" });
      return;
    }
    if (serialized.length > 16_000) {
      context.addIssue({ code: "custom", message: "AI action input exceeds the 16 KB limit" });
    }
  } catch {
    context.addIssue({ code: "custom", message: "AI action input must be JSON serializable" });
  }
});

const EmailSchema = z.email().max(320);
const AiActionSummarySchema = z.string().trim().min(1).max(280);
const AiActionReasonSchema = z.string().trim().min(1).max(500);
const NoteTitleSchema = z.string().trim().max(160);
const NoteContentSchema = z.string().max(20_000);

export const AiActionStatusSchema = z.enum(["proposed", "confirmed", "rejected", "expired", "executed", "failed"]);
export type AiActionStatus = z.infer<typeof AiActionStatusSchema>;

const CreateNoteActionInputSchema = z.object({
  title: NoteTitleSchema.default(""),
  content: NoteContentSchema.default(""),
  folder_id: EntityIdSchema.nullable().optional(),
  daily_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable().optional(),
}).strict();

const CreateReminderActionInputSchema = z.object({
  note_id: EntityIdSchema.nullable().optional(),
  title: z.string().trim().max(160).default(""),
  remind_at: TimestampSchema,
  timezone: z.string().trim().min(1).max(64).default("UTC"),
}).strict();

const CreateNotificationActionInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body_text: z.string().trim().min(1).max(2_000),
}).strict();

const SendEmailActionInputSchema = z.object({
  to_email: EmailSchema,
  subject: z.string().trim().min(1).max(160),
  body_text: z.string().trim().min(1).max(8_000),
}).strict();

const AiActionInputSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("create_note"), input: CreateNoteActionInputSchema }).strict(),
  z.object({ tool: z.literal("create_reminder"), input: CreateReminderActionInputSchema }).strict(),
  z.object({ tool: z.literal("create_notification"), input: CreateNotificationActionInputSchema }).strict(),
  z.object({ tool: z.literal("send_email"), input: SendEmailActionInputSchema }).strict(),
]).superRefine((value, context) => {
  const result = BoundedJsonSchema.safeParse(value.input);
  if (!result.success) {
    for (const issue of result.error.issues) {
      context.addIssue({ ...issue, path: ["input", ...issue.path] });
    }
  }
});

export const AiActionProposalSchema = z.object({
  action_id: EntityIdSchema,
  summary: AiActionSummarySchema,
  requires_confirmation: z.literal(true),
  expires_at: TimestampSchema,
}).and(AiActionInputSchema);
export type AiActionProposal = z.infer<typeof AiActionProposalSchema>;

export const AiActionConfirmSchema = z.object({
  action_id: EntityIdSchema,
  base_revision: PositiveRevisionSchema,
}).strict();

export const AiActionRejectSchema = z.object({
  action_id: EntityIdSchema,
  base_revision: PositiveRevisionSchema,
  reason: AiActionReasonSchema.optional(),
}).strict();

export const AiStatusSchema = AiUserConfigSummarySchema;
export type AiStatus = z.infer<typeof AiStatusSchema>;
export type AiUserConfigSummary = z.infer<typeof AiUserConfigSummarySchema>;
export type UpsertAiUserConfigInput = z.infer<typeof UpsertAiUserConfigInputSchema>;
export type TestAiUserConfigInput = z.infer<typeof TestAiUserConfigInputSchema>;
export type DeleteAiUserConfigInput = z.infer<typeof DeleteAiUserConfigInputSchema>;
