import { z } from "zod";

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
}).strict();
export type AiChatResponse = z.infer<typeof AiChatResponseSchema>;

const AiBaseUrlSchema = z.string().trim().url().max(2048).refine((value) => new URL(value).protocol === "https:", "AI base URL must use HTTPS");
const AiModelSchema = z.string().trim().min(1).max(128);
const AiKeySchema = z.string().trim().min(16).max(512);

export const AiUserConfigSummarySchema = z.object({
  configured: z.boolean(),
  source: z.enum(["personal", "server_default", "unconfigured"]),
  base_url: AiBaseUrlSchema.optional(),
  model: AiModelSchema.optional(),
  key_hint: z.string().min(1).max(32).optional(),
  verified_at: z.string().datetime({ offset: true }).nullable().optional(),
  revision: z.number().int().positive().optional(),
}).strict();

export const UpsertAiUserConfigInputSchema = z.object({
  base_url: AiBaseUrlSchema,
  model: AiModelSchema,
  api_key: AiKeySchema.optional(),
  base_revision: z.number().int().positive().nullable().optional(),
}).strict();

export const TestAiUserConfigInputSchema = z.object({
  base_url: AiBaseUrlSchema.optional(),
  model: AiModelSchema.optional(),
  api_key: AiKeySchema.optional(),
}).strict();

export const DeleteAiUserConfigInputSchema = z.object({
  base_revision: z.number().int().positive(),
}).strict();

export const AiStatusSchema = AiUserConfigSummarySchema;
export type AiStatus = z.infer<typeof AiStatusSchema>;
export type AiUserConfigSummary = z.infer<typeof AiUserConfigSummarySchema>;
export type UpsertAiUserConfigInput = z.infer<typeof UpsertAiUserConfigInputSchema>;
export type TestAiUserConfigInput = z.infer<typeof TestAiUserConfigInputSchema>;
export type DeleteAiUserConfigInput = z.infer<typeof DeleteAiUserConfigInputSchema>;
