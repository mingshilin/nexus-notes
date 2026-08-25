import { describe, expect, it, vi } from "vitest";
import { enableBrowserPush } from "../src/account/push-subscription-controller";

describe("enableBrowserPush", () => {
  it("requests permission only from a user action and registers the browser subscription", async () => {
    const subscribe = vi.fn(async () => ({
      endpoint: "https://push.example.test/send/1",
      expirationTime: null,
      toJSON: () => ({ endpoint: "https://push.example.test/send/1", expirationTime: null, keys: { p256dh: "p".repeat(43), auth: "a".repeat(22) } }),
    }));
    const client = {
      getPushPublicKey: vi.fn(async () => "B".repeat(87)),
      subscribePush: vi.fn(async (input) => ({ id: "push-1", device_name: input.device_name, status: "active", last_success_at: null, created_at: "2026-08-25T00:00:00.000Z" })),
    };
    await expect(enableBrowserPush(client as never, {
      requestPermission: vi.fn(async () => "granted"),
      ready: Promise.resolve({ pushManager: { getSubscription: vi.fn(async () => null), subscribe } } as never),
      deviceName: "Edge on Windows",
    })).resolves.toMatchObject({ id: "push-1", status: "active" });
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }));
    expect(client.subscribePush).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "https://push.example.test/send/1", device_name: "Edge on Windows" }));
  });
});
