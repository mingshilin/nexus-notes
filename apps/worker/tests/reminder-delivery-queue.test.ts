import { describe, expect, it, vi } from "vitest";
import { ReminderDeliveryConsumer } from "../src/push/reminder-delivery-consumer";
import { ReminderOutboxDispatcher } from "../src/push/reminder-outbox-dispatcher";

const job = {
  job_id: "delivery-1",
  kind: "notification" as const,
  idempotency_key: "reminder-delivery:delivery-1",
  attempt: 1,
  deadline: "2026-08-25T05:00:00.000Z",
  payload: { delivery_id: "delivery-1" },
};

describe("reminder delivery queue", () => {
  it("dispatches pending outbox rows and marks only successful sends", async () => {
    const repository = {
      listPendingOutbox: vi.fn(async () => [{ id: "outbox-1", message: job, attempt: 0 }]),
      markOutboxDispatched: vi.fn(async () => undefined),
      recordOutboxFailure: vi.fn(async () => undefined),
    };
    const queue = { send: vi.fn(async () => undefined) };
    const dispatcher = new ReminderOutboxDispatcher(repository, queue, {
      clock: () => new Date("2026-08-25T04:00:00.000Z"),
    });
    await expect(dispatcher.dispatch()).resolves.toEqual({ dispatched: 1, failed: 0 });
    expect(queue.send).toHaveBeenCalledWith(job);
    expect(repository.markOutboxDispatched).toHaveBeenCalledWith("outbox-1", "2026-08-25T04:00:00.000Z");
  });

  it("disables expired subscriptions while completing delivery through healthy devices", async () => {
    const deliveries = {
      getDelivery: vi.fn(async () => ({
        id: "delivery-1", channel: "push", user_id: "user-1", workspace_id: "ws-1",
        reminder_id: "reminder-1", title: "Private title", show_push_title: false,
      })),
      markDeliverySent: vi.fn(async () => undefined),
      markDeliveryFailed: vi.fn(async () => undefined),
      createInAppNotification: vi.fn(async () => undefined),
    };
    const subscriptions = {
      listActive: vi.fn(async () => [
        { id: "expired", subscription: { endpoint: "https://push.test/expired" } },
        { id: "healthy", subscription: { endpoint: "https://push.test/healthy" } },
      ]),
      markSuccess: vi.fn(async () => undefined),
      markFailure: vi.fn(async () => undefined),
    };
    const sender = {
      send: vi.fn(async (subscription: { endpoint: string }) => subscription.endpoint.endsWith("expired")
        ? { ok: false, permanent: true, retryable: false }
        : { ok: true, permanent: false, retryable: false }),
    };
    const consumer = new ReminderDeliveryConsumer(deliveries, subscriptions, sender, undefined, {
      clock: () => new Date("2026-08-25T04:00:00.000Z"),
    });
    await expect(consumer.consume({ body: job, attempts: 1 })).resolves.toEqual({ outcome: "ack" });
    expect(subscriptions.markFailure).toHaveBeenCalledWith("expired", "2026-08-25T04:00:00.000Z", true);
    expect(subscriptions.markSuccess).toHaveBeenCalledWith("healthy", "2026-08-25T04:00:00.000Z");
    expect(deliveries.markDeliverySent).toHaveBeenCalledWith("delivery-1", "2026-08-25T04:00:00.000Z");
    expect(sender.send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ title: "你有一条提醒" }));
  });
});
