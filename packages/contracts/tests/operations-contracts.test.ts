import { describe, expect, it } from "vitest";

import {
  CreateJobInputSchema,
  FeedbackInputSchema,
  JobSchema,
  OperationsStatusSchema,
  UsageSchema,
} from "../src";

describe("operations contracts", () => {
  it("accepts bounded queue job creation for every Task 9 job kind", () => {
    for (const kind of ["index", "import", "export", "email"] as const) {
      expect(CreateJobInputSchema.parse({
        kind,
        idempotency_key: `job-${kind}`,
        payload: { source_key: "ws-1/source/file" },
      })).toMatchObject({ kind, idempotency_key: `job-${kind}` });
    }
  });

  it("rejects unbounded payloads and exposes only safe job status fields", () => {
    expect(CreateJobInputSchema.safeParse({
      kind: "export",
      idempotency_key: "x",
      payload: { value: "x".repeat(100_001) },
    }).success).toBe(false);

    expect(JobSchema.parse({
      id: "job-1", workspace_id: "ws-1", kind: "export", status: "queued",
      revision: 1, error_code: null, created_at: "2026-08-22T00:00:00.000Z", updated_at: "2026-08-22T00:00:00.000Z",
    })).not.toHaveProperty("payload");
  });

  it("validates usage, service status, and feedback input", () => {
    expect(UsageSchema.parse({ notes: 3, databases: 1, attachment_bytes: 42, queued_jobs: 2 })).toEqual({
      notes: 3, databases: 1, attachment_bytes: 42, queued_jobs: 2,
    });
    expect(OperationsStatusSchema.parse({ queue: "ready", storage: "degraded", ocr: "unconfigured", version: "dev" })).toBeTruthy();
    expect(FeedbackInputSchema.safeParse({ category: "bug", body: "  The import button failed.  " }).success).toBe(true);
    expect(FeedbackInputSchema.safeParse({ category: "bug", body: "" }).success).toBe(false);
  });
});
