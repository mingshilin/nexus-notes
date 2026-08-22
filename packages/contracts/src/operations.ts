import { z } from "zod";

const EntityIdSchema = z.string().trim().min(1).max(128);
const TimestampSchema = z.string().datetime({ offset: true });

export const OperationsJobKindSchema = z.enum(["index", "import", "export", "email"]);
export type OperationsJobKind = z.infer<typeof OperationsJobKindSchema>;

export const OperationsJobStatusSchema = z.enum(["queued", "running", "complete", "failed", "cancelled"]);
export type OperationsJobStatus = z.infer<typeof OperationsJobStatusSchema>;

const BoundedPayloadSchema = z.record(z.string().trim().min(1).max(128), z.unknown()).superRefine((payload, context) => {
  try {
    if (JSON.stringify(payload).length > 100_000) {
      context.addIssue({ code: "custom", message: "Job payload exceeds the 100 KB limit" });
    }
  } catch {
    context.addIssue({ code: "custom", message: "Job payload must be serializable" });
  }
});

export const CreateJobInputSchema = z.object({
  kind: OperationsJobKindSchema,
  idempotency_key: z.string().trim().min(1).max(255),
  payload: BoundedPayloadSchema,
}).strict();
export type CreateJobInput = z.infer<typeof CreateJobInputSchema>;

export const JobSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  kind: OperationsJobKindSchema,
  status: OperationsJobStatusSchema,
  revision: z.number().int().positive(),
  error_code: z.string().trim().min(1).max(128).nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();
export type Job = z.infer<typeof JobSchema>;

export const UsageSchema = z.object({
  notes: z.number().int().nonnegative(),
  databases: z.number().int().nonnegative(),
  attachment_bytes: z.number().int().nonnegative(),
  queued_jobs: z.number().int().nonnegative(),
}).strict();
export type Usage = z.infer<typeof UsageSchema>;

export const OperationsStatusSchema = z.object({
  queue: z.enum(["ready", "degraded", "unconfigured"]),
  storage: z.enum(["ready", "degraded", "unconfigured"]),
  ocr: z.enum(["ready", "degraded", "unconfigured"]),
  version: z.string().trim().min(1).max(128),
}).strict();
export type OperationsStatus = z.infer<typeof OperationsStatusSchema>;

export const FeedbackCategorySchema = z.enum(["bug", "idea", "usability", "other"]);
export const FeedbackInputSchema = z.object({
  category: FeedbackCategorySchema,
  body: z.string().trim().min(1).max(10_000),
}).strict();
export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;

export const FeedbackSchema = z.object({
  id: EntityIdSchema,
  workspace_id: EntityIdSchema,
  user_id: EntityIdSchema,
  category: FeedbackCategorySchema,
  body: z.string().trim().min(1).max(10_000),
  status: z.enum(["open", "reviewing", "resolved", "closed"]),
  request_id: EntityIdSchema.nullable(),
  revision: z.number().int().positive(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
}).strict();
export type Feedback = z.infer<typeof FeedbackSchema>;
