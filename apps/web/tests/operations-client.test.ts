import { describe, expect, it, vi } from "vitest";

import { OperationsClient } from "../src/data/operations-client";

describe("OperationsClient", () => {
  it("uses workspace-scoped idempotent commands and cancellable queries", async () => {
    const request = vi.fn(async (options: any) => {
      if (options.path === "/api/v2/operations/jobs") return { job: { id: "job-1" } };
      if (options.path === "/api/v2/operations/feedback") return { feedback: { id: "feedback-1" } };
      if (options.path === "/api/v2/operations/usage") return { notes: 1 };
      return { job: { id: "job-1" } };
    });
    const client = new OperationsClient({ request }, "ws-1", { createId: () => "request-1" });
    const signal = new AbortController().signal;

    await expect(client.createJob({ kind: "export", idempotency_key: "export-1", payload: { format: "csv" } })).resolves.toEqual({ id: "job-1" });
    await expect(client.getJob("job-1", signal)).resolves.toEqual({ id: "job-1" });
    await expect(client.getUsage(signal)).resolves.toEqual({ notes: 1 });
    await expect(client.submitFeedback({ category: "bug", body: "Import failed" })).resolves.toEqual({ id: "feedback-1" });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/operations/jobs",
      headers: { "x-workspace-id": "ws-1" },
      body: { kind: "export", idempotency_key: "export-1", payload: { format: "csv" } },
      requestClass: "command",
    }));
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/operations/usage",
      requestClass: "query",
      policy: expect.objectContaining({ signal }),
    }));
  });
});
