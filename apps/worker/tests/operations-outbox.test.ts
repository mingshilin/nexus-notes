import { describe, expect, it, vi } from "vitest";

import type { QueueJob } from "@nexus/contracts";
import { nextOutboxRetryAt, OperationsOutboxDispatcher } from "../src/operations/operations-outbox-dispatcher";

const message: QueueJob = {
  job_id: "job-1",
  kind: "export",
  idempotency_key: "operations:ws-1:export-1",
  attempt: 1,
  deadline: "2026-08-22T00:15:00.000Z",
  payload: { workspace_id: "ws-1", format: "csv" },
};

describe("OperationsOutboxDispatcher", () => {
  it("uses bounded exponential recovery delays for repeated provider failures", () => {
    const now = "2026-08-22T00:00:00.000Z";
    expect(nextOutboxRetryAt(now, 0)).toBe("2026-08-22T00:00:05.000Z");
    expect(nextOutboxRetryAt(now, 1)).toBe("2026-08-22T00:00:30.000Z");
    expect(nextOutboxRetryAt(now, 99)).toBe("2026-08-22T00:15:00.000Z");
  });

  it("keeps failed sends pending and publishes them exactly once after recovery", async () => {
    const repository = {
      listPendingOutbox: vi.fn(async () => [{ id: "outbox-1", message, attempt: 0 }]),
      markOutboxDispatched: vi.fn(async () => undefined),
      recordOutboxFailure: vi.fn(async () => undefined),
    };
    const firstQueue = { send: vi.fn(async () => { throw new Error("queue unavailable"); }) };
    const first = new OperationsOutboxDispatcher(repository, firstQueue, { clock: () => new Date("2026-08-22T00:00:00.000Z") });
    await expect(first.dispatch()).resolves.toEqual({ dispatched: 0, failed: 1 });
    expect(repository.recordOutboxFailure).toHaveBeenCalledWith(
      "outbox-1",
      "2026-08-22T00:00:00.000Z",
      "2026-08-22T00:00:05.000Z",
    );

    const secondQueue = { send: vi.fn(async () => undefined) };
    const second = new OperationsOutboxDispatcher(repository, secondQueue, { clock: () => new Date("2026-08-22T00:00:00.000Z") });
    await expect(second.dispatch()).resolves.toEqual({ dispatched: 1, failed: 0 });
    expect(secondQueue.send).toHaveBeenCalledWith(message);
    expect(repository.markOutboxDispatched).toHaveBeenCalledWith("outbox-1", "2026-08-22T00:00:00.000Z");
  });
});
