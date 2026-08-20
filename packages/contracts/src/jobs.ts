import { z } from "zod";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const UploadIntentSchema = z.object({
  workspace_id: z.string().trim().min(1),
  filename: z.string().trim().min(1).max(255),
  mime_type: z.string().trim().min(1).max(127),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

export const QueueJobSchema = z.object({
  job_id: z.string().trim().min(1),
  kind: z.enum(["ocr", "index", "import", "export", "email", "notification", "cleanup"]),
  idempotency_key: z.string().trim().min(1),
  attempt: z.number().int().positive(),
  deadline: z.string().datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()),
});

export type UploadIntent = z.infer<typeof UploadIntentSchema>;
export type QueueJob = z.infer<typeof QueueJobSchema>;
