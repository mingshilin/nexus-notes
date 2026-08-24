import { z } from "zod";

const EntityIdSchema = z.string().trim().min(1).max(128);
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
