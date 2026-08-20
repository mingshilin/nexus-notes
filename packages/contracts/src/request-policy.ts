export type RequestClass = "query" | "idempotent-command" | "command" | "upload";

export interface RequestPolicy {
  timeoutMs: number;
  retry: 0 | 1 | 2;
  dedupeKey?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}
