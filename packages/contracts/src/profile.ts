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

const QuietHoursSchema = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u),
}).strict();

export const UserPreferencesSchema = z.object({
  user_id: z.string().min(1),
  default_domain: z.enum(["notes", "databases", "knowledge", "reminders", "ai"]).default("notes"),
  density: z.enum(["comfortable", "compact"]).default("comfortable"),
  reduced_motion: z.boolean().default(false),
  week_starts_on: z.union([z.literal(0), z.literal(1)]).default(1),
  date_format: z.enum(["yyyy-MM-dd", "yyyy年M月d日", "MM/dd/yyyy", "dd/MM/yyyy"]).default("yyyy-MM-dd"),
  default_snooze_minutes: z.number().int().min(5).max(1440).default(10),
  email_reminders: z.boolean().default(false),
  push_reminders: z.boolean().default(false),
  in_app_reminders: z.boolean().default(true),
  quiet_hours: QuietHoursSchema.nullable().default(null),
  show_push_title: z.boolean().default(false),
  revision: z.number().int().positive(),
  updated_at: TimestampSchema,
}).strict();

export const UpdateUserPreferencesInputSchema = z.object({
  base_revision: z.number().int().positive(),
  default_domain: z.enum(["notes", "databases", "knowledge", "reminders", "ai"]).optional(),
  density: z.enum(["comfortable", "compact"]).optional(),
  reduced_motion: z.boolean().optional(),
  week_starts_on: z.union([z.literal(0), z.literal(1)]).optional(),
  date_format: z.enum(["yyyy-MM-dd", "yyyy年M月d日", "MM/dd/yyyy", "dd/MM/yyyy"]).optional(),
  default_snooze_minutes: z.number().int().min(5).max(1440).optional(),
  email_reminders: z.boolean().optional(),
  push_reminders: z.boolean().optional(),
  in_app_reminders: z.boolean().optional(),
  quiet_hours: QuietHoursSchema.nullable().optional(),
  show_push_title: z.boolean().optional(),
}).strict()
  .refine((value) => Object.keys(value).some((key) => key !== "base_revision"), "At least one preference must change");

export const AccountActivitySchema = z.object({
  id: z.string().min(1),
  event: z.string().regex(/^[a-z][a-z0-9_.-]{2,127}$/u),
  request_id: z.string().min(1).max(128),
  created_at: TimestampSchema,
}).strict();

export const AccountOverviewSchema = z.object({
  counts: z.object({
    workspaces: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    notes: z.number().int().nonnegative(),
    databases: z.number().int().nonnegative(),
    upcoming_reminders: z.number().int().nonnegative(),
  }).strict(),
  profile_complete: z.boolean(),
  ai_configured: z.boolean(),
  recent_activity: z.array(AccountActivitySchema).max(10),
}).strict();

export const PushSubscriptionInputSchema = z.object({
  endpoint: z.string().url().max(2048).refine((value) => new URL(value).protocol === "https:", "Push endpoint must use HTTPS"),
  expiration_time: z.number().int().positive().nullable(),
  keys: z.object({
    p256dh: z.string().min(43).max(256),
    auth: z.string().min(22).max(256),
  }).strict(),
  device_name: z.string().trim().min(1).max(120),
}).strict();

export const PushSubscriptionSummarySchema = z.object({
  id: z.string().min(1),
  device_name: z.string().min(1).max(120),
  status: z.enum(["active", "disabled"]),
  last_success_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
}).strict();

export type Profile = z.infer<typeof ProfileSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;
export type AccountSession = z.infer<typeof AccountSessionSchema>;
export type RequestEmailChangeInput = z.infer<typeof RequestEmailChangeInputSchema>;
export type ConfirmEmailChangeInput = z.infer<typeof ConfirmEmailChangeInputSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordInputSchema>;
export type DeleteAccountInput = z.infer<typeof DeleteAccountInputSchema>;
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
export type UpdateUserPreferencesInput = z.infer<typeof UpdateUserPreferencesInputSchema>;
export type AccountActivity = z.infer<typeof AccountActivitySchema>;
export type AccountOverview = z.infer<typeof AccountOverviewSchema>;
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInputSchema>;
export type PushSubscriptionSummary = z.infer<typeof PushSubscriptionSummarySchema>;
