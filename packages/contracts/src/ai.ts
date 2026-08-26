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

export const AiChatInputSchema = z.object({
  messages: z.array(AiMessageSchema).min(1).max(20),
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
}).strict();
export type AiChatResponse = z.infer<typeof AiChatResponseSchema>;

const AiBaseUrlSchema = z.string().trim().url().max(2048).refine((value) => new URL(value).protocol === "https:", "AI base URL must use HTTPS");
const AiModelSchema = z.string().trim().min(1).max(128);
const AiKeySchema = z.string().trim().min(16).max(512);
const PositiveRevisionSchema = z.number().int().positive();

export const AI_ACTION_PROPOSAL_TTL_MS = 10 * 60 * 1000;

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

export const AiToolNameSchema = z.enum(["create_note", "create_reminder", "create_notification", "send_email"]);
export type AiToolName = z.infer<typeof AiToolNameSchema>;

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
