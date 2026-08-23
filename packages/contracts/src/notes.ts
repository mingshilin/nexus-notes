import { z } from "zod";

const EntityIdSchema = z.string().trim().min(1).max(128);
const NoteTitleSchema = z.string().max(160);
const NoteContentSchema = z.string().max(200_000);
const DailyDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const NoteStatusSchema = z.enum(["active", "archived", "trashed"]);
export const NoteRevisionSourceSchema = z.enum(["autosave", "manual", "restore", "conflict", "import"]);

export const NoteSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  folder_id: EntityIdSchema.nullable(),
  database_id: EntityIdSchema.nullable(),
  created_by: EntityIdSchema,
  updated_by: EntityIdSchema,
  title: NoteTitleSchema,
  content: NoteContentSchema,
  status: NoteStatusSchema,
  is_favorite: z.boolean(),
  is_pinned: z.boolean(),
  daily_date: DailyDateSchema.nullable(),
  revision: z.number().int().positive(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export type Note = z.infer<typeof NoteSchema>;

export const NoteRevisionSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  note_id: EntityIdSchema,
  revision: z.number().int().positive(),
  title: NoteTitleSchema,
  content: NoteContentSchema,
  source: NoteRevisionSourceSchema,
  created_by: EntityIdSchema,
  created_at: z.string().datetime({ offset: true }),
});

export type NoteRevision = z.infer<typeof NoteRevisionSchema>;

export const CreateNoteInputSchema = z.object({
  title: NoteTitleSchema.default(""),
  content: NoteContentSchema.default(""),
  folder_id: EntityIdSchema.nullable().optional(),
  database_id: EntityIdSchema.nullable().optional(),
  daily_date: DailyDateSchema.nullable().optional(),
  is_favorite: z.boolean().optional(),
  is_pinned: z.boolean().optional(),
});

export type CreateNoteInput = z.infer<typeof CreateNoteInputSchema>;

export const DailyNoteInputSchema = z.object({
  daily_date: DailyDateSchema,
}).strict();

export type DailyNoteInput = z.infer<typeof DailyNoteInputSchema>;

export const UpdateNoteInputSchema = z.object({
  base_revision: z.number().int().positive(),
  title: NoteTitleSchema.optional(),
  content: NoteContentSchema.optional(),
  folder_id: EntityIdSchema.nullable().optional(),
  database_id: EntityIdSchema.nullable().optional(),
  daily_date: DailyDateSchema.nullable().optional(),
  is_favorite: z.boolean().optional(),
  is_pinned: z.boolean().optional(),
  status: NoteStatusSchema.optional(),
  source: NoteRevisionSourceSchema.default("autosave"),
}).refine(
  (input) => [
    input.title,
    input.content,
    input.folder_id,
    input.database_id,
    input.daily_date,
    input.is_favorite,
    input.is_pinned,
    input.status,
  ].some((value) => value !== undefined),
  { message: "At least one note field must change" },
);

export type UpdateNoteInput = z.infer<typeof UpdateNoteInputSchema>;

export const RestoreNoteInputSchema = z.object({
  base_revision: z.number().int().positive(),
});

export type RestoreNoteInput = z.infer<typeof RestoreNoteInputSchema>;

export const DeleteNoteInputSchema = z.object({
  base_revision: z.number().int().positive(),
});

export type DeleteNoteInput = z.infer<typeof DeleteNoteInputSchema>;

export const QuickCaptureInputSchema = z.object({
  title: NoteTitleSchema.optional(),
  content: NoteContentSchema.min(1),
  folder_id: EntityIdSchema.nullable().optional(),
  daily_date: DailyDateSchema.nullable().optional(),
});

export type QuickCaptureInput = z.infer<typeof QuickCaptureInputSchema>;
