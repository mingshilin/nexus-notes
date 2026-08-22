import { z } from "zod";

const TimestampSchema = z.string().datetime({ offset: true });

export const ProfileSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  display_name: z.string().max(80),
  biography: z.string().max(500),
  locale: z.string().min(2).max(16),
  timezone: z.string().min(1).max(64),
  avatar_url: z.string().min(1).nullable(),
  updated_at: TimestampSchema,
}).strict();

export const UpdateProfileInputSchema = z.object({
  display_name: z.string().trim().min(1).max(80).optional(),
  biography: z.string().trim().max(500).optional(),
  locale: z.string().trim().min(2).max(16).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one profile field is required");

export const AccountSessionSchema = z.object({
  id: z.string().min(1),
  current: z.boolean(),
  user_agent: z.string().max(512),
  created_at: TimestampSchema,
  last_seen_at: TimestampSchema,
  expires_at: TimestampSchema,
}).strict();

export const RequestEmailChangeInputSchema = z.object({
  new_email: z.string().email(),
  current_password: z.string().min(1).max(128),
}).strict();

export const ConfirmEmailChangeInputSchema = z.object({
  new_email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
}).strict();

export const ChangePasswordInputSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: z.string().min(10).max(128),
}).strict();

export const DeleteAccountInputSchema = z.object({
  current_password: z.string().min(1).max(128),
  confirmation: z.literal("永久删除我的账户"),
}).strict();

export type Profile = z.infer<typeof ProfileSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;
export type AccountSession = z.infer<typeof AccountSessionSchema>;
export type RequestEmailChangeInput = z.infer<typeof RequestEmailChangeInputSchema>;
export type ConfirmEmailChangeInput = z.infer<typeof ConfirmEmailChangeInputSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordInputSchema>;
export type DeleteAccountInput = z.infer<typeof DeleteAccountInputSchema>;
