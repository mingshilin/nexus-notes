import { z } from "zod";

const EntityIdSchema = z.string().trim().min(1).max(128);
const TimestampSchema = z.string().datetime({ offset: true });
const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");

export const CalendarFeedQuerySchema = z.object({
  from: CalendarDateSchema,
  to: CalendarDateSchema,
}).refine(({ from, to }) => from <= to, { message: "Calendar range must be ordered", path: ["to"] })
  .refine(({ from, to }) => {
    const start = Date.parse(`${from}T00:00:00.000Z`);
    const end = Date.parse(`${to}T00:00:00.000Z`);
    return end - start <= 62 * 24 * 60 * 60 * 1000;
  }, { message: "Calendar range cannot exceed 62 days", path: ["to"] });
export type CalendarFeedQuery = z.infer<typeof CalendarFeedQuerySchema>;

export const CalendarFeedItemSchema = z.object({
  id: EntityIdSchema,
  kind: z.enum(["daily_note", "reminder", "database_record"]),
  date: CalendarDateSchema,
  title: z.string().max(160),
  entity_id: EntityIdSchema,
  note_id: EntityIdSchema.nullable().optional(),
  database_id: EntityIdSchema.nullable().optional(),
  status: z.string().max(32).nullable().optional(),
});
export type CalendarFeedItem = z.infer<typeof CalendarFeedItemSchema>;

export const CalendarFeedSchema = z.object({
  items: z.array(CalendarFeedItemSchema).max(500),
});
export type CalendarFeed = z.infer<typeof CalendarFeedSchema>;

export const CalendarProviderSchema = z.enum(["google", "outlook"]);
export type CalendarProvider = z.infer<typeof CalendarProviderSchema>;

export const CalendarConnectionStatusSchema = z.enum(["active", "error", "revoked"]);
export type CalendarConnectionStatus = z.infer<typeof CalendarConnectionStatusSchema>;

export const CalendarConnectionSummarySchema = z.object({
  id: EntityIdSchema,
  provider: CalendarProviderSchema,
  status: CalendarConnectionStatusSchema,
  last_synced_at: TimestampSchema.nullable(),
  last_error_code: z.string().trim().min(1).max(128).nullable(),
}).strict();
export type CalendarConnectionSummary = z.infer<typeof CalendarConnectionSummarySchema>;

export const CalendarConnectionListSchema = z.object({
  items: z.array(CalendarConnectionSummarySchema).max(10),
}).strict();

export const CalendarConnectResponseSchema = z.object({
  provider: CalendarProviderSchema,
  status: z.enum(["ready", "unconfigured"]),
  authorization_url: z.string().url().max(4096).optional(),
}).strict();
export type CalendarConnectResponse = z.infer<typeof CalendarConnectResponseSchema>;

export const CalendarEventSchema = z.object({
  id: EntityIdSchema,
  connection_id: EntityIdSchema,
  provider: CalendarProviderSchema,
  provider_event_id: z.string().trim().min(1).max(512),
  title: z.string().max(240),
  starts_at: TimestampSchema,
  ends_at: TimestampSchema,
  timezone: z.string().trim().min(1).max(64),
  all_day: z.boolean(),
  status: z.enum(["confirmed", "tentative", "cancelled"]).default("confirmed"),
  updated_at: TimestampSchema,
}).strict();
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const CalendarEventsQuerySchema = z.object({
  from: CalendarDateSchema,
  to: CalendarDateSchema,
  connection_id: EntityIdSchema.optional(),
}).refine(({ from, to }) => from <= to, { message: "Calendar range must be ordered", path: ["to"] })
  .refine(({ from, to }) => Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`) <= 62 * 24 * 60 * 60 * 1000, {
    message: "Calendar range cannot exceed 62 days", path: ["to"],
  });
export type CalendarEventsQuery = z.infer<typeof CalendarEventsQuerySchema>;

export const CalendarEventsResponseSchema = z.object({
  items: z.array(CalendarEventSchema).max(500),
}).strict();

export const CalendarSyncResponseSchema = z.object({
  connection: CalendarConnectionSummarySchema,
  imported_count: z.number().int().nonnegative().max(500),
}).strict();
