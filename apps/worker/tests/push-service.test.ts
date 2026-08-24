import { describe, expect, it, vi } from "vitest";
import { PushService } from "../src/push/push-service";

describe("PushService", () => {
  it("queues a privacy-safe test notification without subscription secrets", async () => {
    const repository = {
      list: vi.fn(async () => []), upsert: vi.fn(), disable: vi.fn(),
    };
    const queue = { send: vi.fn(async () => undefined) };
    const service = new PushService(repository as never, queue, "vapid-public", {
      clock: () => new Date("2026-08-25T04:00:00.000Z"), createId: () => "push-test-1",
    });
    await expect(service.sendTest("user-1", "req-1")).resolves.toEqual({ queued: 1 });
    expect(queue.send).toHaveBeenCalledWith(expect.objectContaining({
      kind: "notification",
      idempotency_key: "push-test:user-1:push-test-1",
      payload: { test: true, user_id: "user-1", request_id: "req-1" },
    }));
    expect(JSON.stringify(queue.send.mock.calls[0])).not.toContain("endpoint");
  });
});
