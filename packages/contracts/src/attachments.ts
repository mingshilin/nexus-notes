import { z } from "zod";

const EntityIdSchema = z.string().trim().min(1).max(128);
const TimestampSchema = z.string().datetime({ offset: true });
const CursorSchema = z.string().trim().min(1).max(1_000);
const RevisionSchema = z.number().int().positive();

export const MAX_WORKSPACE_ATTACHMENT_BYTES = 1024 * 1024 * 1024;
export const SUPPORTED_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
] as const;

export const AttachmentStatusSchema = z.enum(["uploading", "ready", "deleted"]);
export const OcrJobStatusSchema = z.enum(["pending", "processing", "completed", "failed", "dead_letter"]);
export const SafeOcrDiagnosticErrorSchema = z.enum(["ocr_failed", "ocr_attempts_exhausted"]);
export const AttachmentSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  note_id: EntityIdSchema.nullable(),
  filename: z.string().trim().min(1).max(255),
  mime_type: z.enum(SUPPORTED_ATTACHMENT_MIME_TYPES),
  size_bytes: z.number().int().positive().max(MAX_WORKSPACE_ATTACHMENT_BYTES),
  status: AttachmentStatusSchema,
  ocr_status: OcrJobStatusSchema.nullable(),
  ocr_attempt_count: z.number().int().min(0).nullable(),
  ocr_updated_at: TimestampSchema.nullable(),
  revision: RevisionSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();
export type Attachment = z.infer<typeof AttachmentSchema>;

export const CreateAttachmentUploadInputSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mime_type: z.enum(SUPPORTED_ATTACHMENT_MIME_TYPES),
  size_bytes: z.number().int().positive().max(25 * 1024 * 1024),
  note_id: EntityIdSchema.nullable().optional(),
  idempotency_key: z.string().trim().min(1).max(255),
});
export type CreateAttachmentUploadInput = z.infer<typeof CreateAttachmentUploadInputSchema>;

export const UploadCompleteInputSchema = z.object({
  upload_id: EntityIdSchema,
});
export type UploadCompleteInput = z.infer<typeof UploadCompleteInputSchema>;

export const AttachmentListRequestSchema = z.object({
  mime_type: z.enum(SUPPORTED_ATTACHMENT_MIME_TYPES).optional(),
  note_id: EntityIdSchema.optional(),
  status: AttachmentStatusSchema.optional(),
  ocr_status: OcrJobStatusSchema.optional(),
  cursor: CursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type AttachmentListRequest = z.infer<typeof AttachmentListRequestSchema>;

export const OcrJobSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  attachment_id: EntityIdSchema,
  status: OcrJobStatusSchema,
  idempotency_key: z.string().trim().min(1).max(255),
  attempt_count: z.number().int().min(0),
  deadline: TimestampSchema,
  last_error_code: z.string().trim().min(1).max(128).nullable(),
  revision: RevisionSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
export type OcrJob = z.infer<typeof OcrJobSchema>;

export const OcrRetryInputSchema = z.object({
  attachment_ids: z.array(EntityIdSchema).min(1).max(100).transform((ids) => [...new Set(ids)]),
});
export type OcrRetryInput = z.infer<typeof OcrRetryInputSchema>;

export const KnowledgeDiagnosticKindSchema = z.enum([
  "unfiled_note",
  "orphan_note",
  "duplicate_title",
  "broken_link",
  "failed_ocr",
]);
export const KnowledgeDiagnosticSchema = z.object({
  kind: KnowledgeDiagnosticKindSchema,
  entity_id: EntityIdSchema,
  title: z.string().max(255),
  count: z.number().int().positive(),
  failure_count: z.number().int().positive().optional(),
  ocr_status: OcrJobStatusSchema.nullable().optional(),
  latest_error: SafeOcrDiagnosticErrorSchema.nullable().optional(),
}).strict();
export type KnowledgeDiagnostic = z.infer<typeof KnowledgeDiagnosticSchema>;

export const KnowledgeDiagnosticsRequestSchema = z.object({
  cursor: CursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type KnowledgeDiagnosticsRequest = z.infer<typeof KnowledgeDiagnosticsRequestSchema>;
