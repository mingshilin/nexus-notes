import { z } from "zod";

const EntityIdSchema = z.string().trim().min(1).max(128);
const TimestampSchema = z.string().datetime({ offset: true });
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const RevisionSchema = z.number().int().positive();

export const FolderSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  parent_id: EntityIdSchema.nullable(),
  name: z.string().trim().min(1).max(120),
  position: z.number().int().min(0),
  revision: RevisionSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Folder = z.infer<typeof FolderSchema>;

export const CreateFolderInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parent_id: EntityIdSchema.nullable().optional(),
  position: z.number().int().min(0).optional(),
});
export type CreateFolderInput = z.infer<typeof CreateFolderInputSchema>;

export const TagSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  name: z.string().trim().min(1).max(80),
  color: z.union([z.literal(""), z.string().regex(/^#[0-9a-f]{6}$/i)]),
  revision: RevisionSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Tag = z.infer<typeof TagSchema>;

export const CreateTagInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.union([z.literal(""), z.string().regex(/^#[0-9a-f]{6}$/i)]).default(""),
});
export type CreateTagInput = z.infer<typeof CreateTagInputSchema>;

const UniqueIdsSchema = z.array(EntityIdSchema).max(100).transform((ids) => [...new Set(ids)]);

export const SetNoteTagsInputSchema = z.object({
  tag_ids: UniqueIdsSchema,
});
export type SetNoteTagsInput = z.infer<typeof SetNoteTagsInputSchema>;

export const SetNoteLinksInputSchema = z.object({
  target_note_ids: UniqueIdsSchema,
});
export type SetNoteLinksInput = z.infer<typeof SetNoteLinksInputSchema>;

export const NoteLinkSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  source_note_id: EntityIdSchema,
  target_note_id: EntityIdSchema,
  created_at: TimestampSchema,
});
export type NoteLink = z.infer<typeof NoteLinkSchema>;

export const ReminderStatusSchema = z.enum(["pending", "sent", "dismissed"]);
export const ReminderChannelSchema = z.enum(["in_app", "email", "push"]);
export const ReminderDeliveryStatusSchema = z.enum(["queued", "sent", "failed", "cancelled"]);
export const ReminderWeekdaySchema = z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
export const RecurrenceEndSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("never") }).strict(),
  z.object({ type: z.literal("until"), date: z.string().date() }).strict(),
  z.object({ type: z.literal("count"), count: z.number().int().min(2).max(999) }).strict(),
]);
export const ReminderRecurrenceSchema = z.discriminatedUnion("frequency", [
  z.object({ frequency: z.literal("daily"), interval: z.number().int().min(1).max(30), ends: RecurrenceEndSchema }).strict(),
  z.object({
    frequency: z.literal("weekly"), interval: z.number().int().min(1).max(12),
    weekdays: z.array(ReminderWeekdaySchema).min(1).max(7).transform((days) => [...new Set(days)]),
    ends: RecurrenceEndSchema,
  }).strict(),
  z.object({
    frequency: z.literal("monthly"), interval: z.number().int().min(1).max(12),
    month_day: z.union([z.number().int().min(1).max(31), z.literal("last")]), ends: RecurrenceEndSchema,
  }).strict(),
]);
const ReminderChannelsSchema = z.array(ReminderChannelSchema).min(1).max(3).transform((channels) => [...new Set(channels)]);
export const ReminderSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  note_id: EntityIdSchema.nullable(),
  user_id: EntityIdSchema,
  remind_at: TimestampSchema,
  title: z.string().max(160).default(""),
  timezone: z.string().min(1).max(64).default("UTC"),
  channels: ReminderChannelsSchema.default(["in_app"]),
  recurrence: ReminderRecurrenceSchema.nullable().default(null),
  recurrence_anchor_local: z.string().datetime({ local: true }).nullable().default(null),
  occurrence_count: z.number().int().nonnegative().default(0),
  delivery_enabled_at: TimestampSchema.nullable().default(null),
  snoozed_until: TimestampSchema.nullable().default(null),
  last_delivered_at: TimestampSchema.nullable().default(null),
  status: ReminderStatusSchema,
  revision: RevisionSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type Reminder = z.infer<typeof ReminderSchema>;

export const ReminderDeliverySchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  reminder_id: EntityIdSchema,
  occurrence_at: TimestampSchema,
  channel: ReminderChannelSchema,
  status: ReminderDeliveryStatusSchema,
  attempt_count: z.number().int().nonnegative().max(1000),
  last_error_code: z.string().trim().min(1).max(128).nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();
export type ReminderDelivery = z.infer<typeof ReminderDeliverySchema>;

export const ReminderDeliveryListResponseSchema = z.object({
  items: z.array(ReminderDeliverySchema).max(100),
  next_cursor: z.string().trim().min(1).max(512).nullable(),
}).strict();
export type ReminderDeliveryListResponse = z.infer<typeof ReminderDeliveryListResponseSchema>;

export const RetryReminderDeliveryInputSchema = z.object({}).strict();
export type RetryReminderDeliveryInput = z.infer<typeof RetryReminderDeliveryInputSchema>;

export const CreateReminderInputSchema = z.object({
  note_id: EntityIdSchema.nullable().optional(),
  remind_at: TimestampSchema,
  title: z.string().trim().max(160).default(""),
  timezone: z.string().trim().min(1).max(64).default("UTC"),
  channels: ReminderChannelsSchema.default(["in_app"]),
  recurrence: ReminderRecurrenceSchema.nullable().default(null),
  delivery_enabled: z.boolean().default(true),
}).strict();
export type CreateReminderInput = z.infer<typeof CreateReminderInputSchema>;

export const UpdateReminderInputSchema = z.object({
  base_revision: RevisionSchema,
  remind_at: TimestampSchema.optional(),
  title: z.string().trim().max(160).optional(),
  note_id: EntityIdSchema.nullable().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  channels: ReminderChannelsSchema.optional(),
  recurrence: ReminderRecurrenceSchema.nullable().optional(),
  delivery_enabled: z.boolean().optional(),
  status: ReminderStatusSchema.optional(),
}).refine(
  (input) => Object.keys(input).some((key) => key !== "base_revision"),
  { message: "At least one reminder field must change" },
);
export type UpdateReminderInput = z.infer<typeof UpdateReminderInputSchema>;

export const SnoozeReminderInputSchema = z.object({
  base_revision: RevisionSchema,
  minutes: z.union([z.literal(10), z.literal(60), z.literal(1440)]),
}).strict();

export const DeleteReminderInputSchema = z.object({
  base_revision: RevisionSchema,
}).strict();

export const ReminderListQuerySchema = z.object({
  status: z.enum(["all", "pending", "overdue", "today", "upcoming", "completed"]).default("pending"),
  query: z.string().trim().max(160).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export type ReminderChannel = z.infer<typeof ReminderChannelSchema>;
export type ReminderRecurrence = z.infer<typeof ReminderRecurrenceSchema>;
export type RecurrenceEnd = z.infer<typeof RecurrenceEndSchema>;
export type SnoozeReminderInput = z.infer<typeof SnoozeReminderInputSchema>;
export type DeleteReminderInput = z.infer<typeof DeleteReminderInputSchema>;
export type ReminderListQuery = z.infer<typeof ReminderListQuerySchema>;

export const SearchEntityTypeSchema = z.enum(["note", "database_record", "comment", "attachment"]);
export const SearchHitSourceSchema = z.enum(["title", "content", "tags", "properties", "attachment_name", "ocr"]);
export const OcrStatusSchema = z.enum(["queued", "running", "complete", "failed", "cancelled"]);

const FilterIdsSchema = z.array(EntityIdSchema).max(100).default([]);
export const SavedSearchFiltersSchema = z.object({
  tag_ids: FilterIdsSchema,
  folder_ids: FilterIdsSchema,
  database_ids: FilterIdsSchema,
  member_ids: FilterIdsSchema,
  attachment_types: z.array(z.string().trim().min(1).max(128)).max(50).default([]),
  ocr_statuses: z.array(OcrStatusSchema).max(5).default([]),
  source_types: z.array(SearchEntityTypeSchema).max(4).default([]),
  favorite: z.boolean().optional(),
  pinned: z.boolean().optional(),
  date_from: DateSchema.optional(),
  date_to: DateSchema.optional(),
});
export type SavedSearchFilters = z.infer<typeof SavedSearchFiltersSchema>;

const EMPTY_SAVED_SEARCH_FILTERS: SavedSearchFilters = {
  tag_ids: [],
  folder_ids: [],
  database_ids: [],
  member_ids: [],
  attachment_types: [],
  ocr_statuses: [],
  source_types: [],
};

export const SearchRequestSchema = z.object({
  query: z.string().trim().max(500).default(""),
  filters: SavedSearchFiltersSchema.default(EMPTY_SAVED_SEARCH_FILTERS),
  cursor: z.string().max(1_000).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const SearchHitSchema = z.object({
  entity_type: SearchEntityTypeSchema,
  entity_id: EntityIdSchema,
  title: z.string().max(160),
  excerpt: z.string().max(1_000),
  hit_sources: z.array(SearchHitSourceSchema),
  revision: RevisionSchema,
  updated_at: TimestampSchema,
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SavedSearchInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  query: z.string().trim().max(500).default(""),
  filters: SavedSearchFiltersSchema.default(EMPTY_SAVED_SEARCH_FILTERS),
});
export type SavedSearchInput = z.infer<typeof SavedSearchInputSchema>;

export const SavedSearchSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  user_id: EntityIdSchema,
  name: z.string().trim().min(1).max(120),
  query: z.string().max(500),
  filters: SavedSearchFiltersSchema,
  revision: RevisionSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type SavedSearch = z.infer<typeof SavedSearchSchema>;

export const GraphNodeSchema = z.object({
  id: EntityIdSchema,
  title: z.string().max(160),
  is_current: z.boolean(),
});
export const GraphEdgeSchema = z.object({
  source: EntityIdSchema,
  target: EntityIdSchema,
});
export const GraphResponseSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});
export type GraphResponse = z.infer<typeof GraphResponseSchema>;
