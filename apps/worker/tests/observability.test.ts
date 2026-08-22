import { describe, expect, it, vi } from "vitest";

import {
  classifyHttpStatus,
  createObservability,
  normalizeRoute,
} from "../src/observability";

describe("structured observability", () => {
  it("emits redacted HTTP events and analytics points without tenant or token data", async () => {
    const logs: string[] = [];
    const points: Array<{ blobs?: string[]; doubles?: number[]; indexes?: string[] }> = [];
    const observability = createObservability({
      logger: { log: (message: string) => logs.push(message) },
      analytics: { writeDataPoint: (point) => points.push(point) },
      deploymentVersion: "beta-2026-08-22",
      workspaceHashSecret: "workspace-secret-that-is-not-logged",
    });

    await observability.recordHttp({
      requestId: "req-1",
      method: "GET",
      pathname: "/api/v2/shares/raw-public-token?password=do-not-log",
      status: 503,
      latencyMs: 42,
      workspaceId: "workspace-private",
    });

    expect(normalizeRoute("/api/v2/shares/raw-public-token?password=do-not-log")).toBe("/api/v2/shares/:id");
    const event = JSON.parse(logs[0]!);
    expect(event).toMatchObject({
      type: "http.request",
      request_id: "req-1",
      route: "/api/v2/shares/:id",
      method: "GET",
      status: 503,
      outcome: "failure",
      error_class: "dependency",
      latency_ms: 42,
      deployment_version: "beta-2026-08-22",
    });
    expect(event.workspace_hash).toMatch(/^[a-f0-9]{16}$/);
    expect(logs[0]).not.toContain("workspace-private");
    expect(logs[0]).not.toContain("raw-public-token");
    expect(logs[0]).not.toContain("do-not-log");
    expect(logs[0]).not.toContain("workspace-secret-that-is-not-logged");
    expect(points).toEqual([{
      blobs: ["http.request", "/api/v2/shares/:id", "failure", "dependency", "beta-2026-08-22"],
      doubles: [503, 42],
      indexes: ["req-1"],
    }]);
  });

  it("classifies common HTTP outcomes and isolates sink failures", async () => {
    expect(classifyHttpStatus(200)).toBe("success");
    expect(classifyHttpStatus(401)).toBe("auth");
    expect(classifyHttpStatus(409)).toBe("conflict");
    expect(classifyHttpStatus(429)).toBe("rate_limit");
    expect(classifyHttpStatus(504)).toBe("timeout");
    expect(classifyHttpStatus(500)).toBe("internal");

    const observability = createObservability({
      logger: { log: vi.fn(() => { throw new Error("logger down"); }) },
      analytics: { writeDataPoint: vi.fn(() => { throw new Error("analytics down"); }) },
      workspaceHashSecret: "secret",
    });

    await expect(observability.recordHttp({
      requestId: "req-2",
      method: "POST",
      pathname: "/api/v2/notes",
      status: 500,
      latencyMs: 5,
    })).resolves.toBeUndefined();
  });

  it("records queue outcomes without including message payloads", async () => {
    const logs: string[] = [];
    const observability = createObservability({
      logger: { log: (message: string) => logs.push(message) },
      deploymentVersion: "v1",
    });

    await observability.recordQueue({
      queue: "ocr",
      kind: "ocr",
      outcome: "retry",
      attempt: 2,
      ageMs: 1_200,
      requestId: "req-queue",
      payload: { workspace_id: "private", password: "private" },
    });

    expect(JSON.parse(logs[0]!)).toMatchObject({
      type: "queue.job",
      queue: "ocr",
      job_kind: "ocr",
      outcome: "retry",
      attempt: 2,
      queue_age_ms: 1_200,
      request_id: "req-queue",
      deployment_version: "v1",
    });
    expect(logs[0]).not.toContain("private");
  });
});
