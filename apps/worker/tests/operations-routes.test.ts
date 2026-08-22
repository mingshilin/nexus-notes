import { describe, expect, it } from "vitest";

import type { Job, OperationsStatus, Usage, Feedback } from "@nexus/contracts";
import { createBetaWorker } from "../src/bootstrap";
import type { BetaWorkerEnv } from "../src/routes/health";
import { registerOperationsRoutes } from "../src/routes/operations";

type Definition = { method: string; path: string; auth: string; minimumRole?: string; handler: (context: any) => unknown };

describe("Task 9 operations routes", () => {
  it("registers workspace job, feedback, usage, public status, and owner admin routes", () => {
    const definitions: Definition[] = [];
    const registry = { register(definition: Definition) { definitions.push(definition); } };
    const job: Job = { id: "job-1", workspace_id: "ws-1", kind: "export", status: "queued", revision: 1, error_code: null, created_at: "2026-08-22T00:00:00.000Z", updated_at: "2026-08-22T00:00:00.000Z" };
    const feedback: Feedback = { id: "feedback-1", workspace_id: "ws-1", user_id: "user-1", category: "bug", body: "Import failed", status: "open", request_id: "request-1", revision: 1, created_at: "2026-08-22T00:00:00.000Z", updated_at: "2026-08-22T00:00:00.000Z" };
    const usage: Usage = { notes: 1, databases: 0, attachment_bytes: 0, queued_jobs: 1 };
    const status: OperationsStatus = { queue: "ready", storage: "degraded", ocr: "unconfigured", version: "dev" };
    registerOperationsRoutes(registry, () => ({
      createJob: async () => job,
      getJob: async () => job,
      listJobs: async () => [job],
      createFeedback: async () => feedback,
      getUsage: async () => usage,
      listFeedback: async () => [feedback],
      getStatus: () => status,
    }));

    expect(definitions.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /api/v2/operations/jobs",
      "GET /api/v2/operations/jobs/:jobId",
      "GET /api/v2/operations/jobs",
      "POST /api/v2/operations/feedback",
      "GET /api/v2/operations/usage",
      "GET /api/v2/operations/status",
      "GET /api/v2/admin/jobs",
      "GET /api/v2/admin/feedback",
    ]);
    expect(definitions.find((definition) => definition.path === "/api/v2/operations/status")).toMatchObject({ auth: "public" });
    expect(definitions.find((definition) => definition.path === "/api/v2/admin/jobs")).toMatchObject({ auth: "workspace", minimumRole: "owner" });
  });

  it("serves a safe public operations status without requiring a session", async () => {
    const env: BetaWorkerEnv = {
      DB: {} as D1Database,
      APP_BASE_URL: "https://beta.test",
      RATE_LIMIT_SECRET: "rate-limit-secret-at-least-32-characters",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
      RESEND_API_KEY: "resend-secret",
      EMAIL_FROM: "Nexus Notes <notes@beta.test>",
    };
    const response = await createBetaWorker().fetch(new Request("https://beta.test/api/v2/operations/status"), env);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ queue: "unconfigured", storage: "unconfigured", ocr: "unconfigured", version: "development" });
  });
});
