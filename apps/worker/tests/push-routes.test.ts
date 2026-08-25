import { describe, expect, it, vi } from "vitest";
import { createRouteRegistry } from "../src/http/route-registry";
import { registerPushRoutes } from "../src/routes/push";

function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");
  return new Request(`https://beta.test${path}`, { ...init, headers });
}

describe("push routes", () => {
  it("scopes subscription and test operations to the authenticated user", async () => {
    const service = {
      list: vi.fn(async () => []),
      subscribe: vi.fn(async () => ({ id: "push-1" })),
      disable: vi.fn(async () => true),
      sendTest: vi.fn(async () => ({ queued: 1 })),
      publicKey: vi.fn(() => "vapid-public"),
    };
    const registry = createRouteRegistry({
      requestId: () => "req-push",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
    });
    registerPushRoutes(registry, () => service);
    const input = {
      endpoint: "https://push.example.test/send/1",
      expiration_time: null,
      keys: { p256dh: "p".repeat(43), auth: "a".repeat(22) },
      device_name: "Edge",
    };
    const responses = await Promise.all([
      registry.fetch(request("/api/v2/push/subscriptions"), {}),
      registry.fetch(request("/api/v2/push/subscriptions", { method: "POST", body: JSON.stringify(input) }), {}),
      registry.fetch(request("/api/v2/push/subscriptions/push-1", { method: "DELETE" }), {}),
      registry.fetch(request("/api/v2/push/test", { method: "POST" }), {}),
      registry.fetch(request("/api/v2/push/public-key"), {}),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 201, 200, 202, 200]);
    expect(service.subscribe).toHaveBeenCalledWith("user-1", input, "req-push");
    expect(service.disable).toHaveBeenCalledWith("user-1", "push-1", "req-push");
    expect(service.sendTest).toHaveBeenCalledWith("user-1", "req-push");
  });
});
