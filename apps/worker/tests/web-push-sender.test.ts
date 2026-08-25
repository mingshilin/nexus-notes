import { describe, expect, it, vi } from "vitest";
import { WebPushSender } from "../src/push/web-push-sender";

const subscription = {
  endpoint: "https://push.example.test/send/1",
  expiration_time: null,
  keys: { p256dh: "p".repeat(43), auth: "a".repeat(22) },
  device_name: "Edge",
};

describe("WebPushSender", () => {
  it.each([
    [201, { ok: true, permanent: false, retryable: false }],
    [410, { ok: false, permanent: true, retryable: false }],
    [429, { ok: false, permanent: false, retryable: true }],
    [503, { ok: false, permanent: false, retryable: true }],
    [400, { ok: false, permanent: false, retryable: false }],
  ])("classifies push response %s", async (status, expected) => {
    const fetcher = vi.fn(async () => new Response(null, { status }));
    const buildPayload = vi.fn(async () => ({ method: "POST", headers: {}, body: "encrypted" }));
    const sender = new WebPushSender({ subject: "mailto:ops@example.test", publicKey: "public", privateKey: "private" }, {
      fetcher, buildPayload,
    });
    await expect(sender.send(subscription, { title: "Reminder", body: "Open", url: "/reminders" })).resolves.toEqual(expected);
    expect(fetcher).toHaveBeenCalledWith(subscription.endpoint, expect.objectContaining({ redirect: "error" }));
  });
});
