import { afterEach, describe, expect, it } from "vitest";

import type { WorkspaceContext } from "@nexus/contracts";
import { D1OperationsRepository } from "../src/operations/d1-operations-repository";
import { createTestD1, seedTenants } from "./helpers/d1";

describe("D1OperationsRepository", () => {
  const resources: Array<{ dispose(): Promise<void> | void }> = [];
  const context: WorkspaceContext = {
    workspaceId: "ws-1", userId: "user-1", role: "owner", capabilities: new Set(),
  };

  afterEach(async () => {
    while (resources.length) await resources.pop()!.dispose();
  });

  it("creates one tenant-scoped queued job and one outbox message per idempotency key", async () => {
    const resource = await createTestD1();
    resources.push(resource);
    await seedTenants(resource.db);
    const repository = new D1OperationsRepository(resource.db, () => "job-1");
    const input = { kind: "export" as const, idempotency_key: "export-1", payload: { format: "csv" } };

    const first = await repository.createJob(context, input, "2026-08-22T00:00:00.000Z");
    const second = await repository.createJob(context, input, "2026-08-22T00:01:00.000Z");

    expect(first).toEqual(second);
    expect(first).toMatchObject({ id: "job-1", workspace_id: "ws-1", kind: "export", status: "queued", revision: 1 });
    await expect(resource.db.prepare("SELECT COUNT(*) AS count FROM beta_jobs").first<{ count: number }>()).resolves.toEqual({ count: 1 });
    await expect(resource.db.prepare("SELECT COUNT(*) AS count FROM queue_outbox WHERE job_kind = 'export'").first<{ count: number }>()).resolves.toEqual({ count: 1 });
  });

  it("keeps feedback and usage queries tenant-scoped", async () => {
    const resource = await createTestD1();
    resources.push(resource);
    await seedTenants(resource.db);
    const repository = new D1OperationsRepository(resource.db, () => "feedback-1");

    const feedback = await repository.createFeedback(context, { category: "bug", body: "Import failed" }, "request-1", "2026-08-22T00:00:00.000Z");
    expect(feedback).toMatchObject({ id: "feedback-1", workspace_id: "ws-1", user_id: "user-1", status: "open" });
    await expect(repository.getUsage("ws-1")).resolves.toEqual({ notes: 0, databases: 0, attachment_bytes: 0, queued_jobs: 0 });
    await expect(repository.getFeedback("ws-2", feedback.id)).resolves.toBeNull();
  });
});
