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
