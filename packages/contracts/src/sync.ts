import { z } from "zod";

export const SyncEntityTypeSchema = z.enum([
  "note",
  "database_record",
  "comment",
  "attachment",
]);

export const SyncOperationSchema = z.object({
  operation_id: z.string().trim().min(1),
  workspace_id: z.string().trim().min(1),
  entity_type: SyncEntityTypeSchema,
  entity_id: z.string().trim().min(1),
  base_revision: z.number().int().nonnegative(),
  kind: z.enum(["create", "update", "delete"]),
  patch: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime({ offset: true }),
});

export type SyncOperation = z.infer<typeof SyncOperationSchema>;

export const SyncPushRequestSchema = z.object({
  operations: z.array(SyncOperationSchema).max(100),
});

export const SyncOperationResultSchema = z.object({
  operation_id: z.string().min(1),
  status: z.enum(["applied", "duplicate", "conflict", "rejected"]),
  revision: z.number().int().positive().optional(),
  error: z.string().optional(),
});

export const SyncPushResponseSchema = z.object({
  operations: z.array(SyncOperationResultSchema),
  next_cursor: z.string().min(1).nullable(),
});
