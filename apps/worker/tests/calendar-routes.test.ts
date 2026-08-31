import { describe, expect, it, vi } from "vitest";
import { registerCalendarRoutes } from "../src/calendar/calendar-routes";
import { createRouteRegistry } from "../src/http/route-registry";

const principal = { userId: "user-1", sessionId: "session-1" };
const env = { APP_BASE_URL: "https://notes.example" };

function request(path: string, init?: RequestInit) {
  return new Request(`https://notes.example${path}`, { ...init, headers: { "content-type": "application/json" } });
}

describe("calendar routes", () => {
  it("exposes user-scoped connections, events, start, sync, and disconnect", async () => {
    const service = {
      listConnections: vi.fn(async () => [{ id: "connection-1", provider: "google", status: "active", last_synced_at: null, last_error_code: null }]),
      startConnection: vi.fn(async () => ({ provider: "google", status: "unconfigured" })),
      completeOAuth: vi.fn(async () => ({ userId: "user-1", provider: "google" })),
      listEvents: vi.fn(async () => ({ items: [] })),
      syncConnection: vi.fn(async () => ({ connection: { id: "connection-1" }, importedCount: 0 })),
      disconnect: vi.fn(async () => ({ deleted: true })),
    };
    const registry = createRouteRegistry({
      requestId: () => "req-calendar",
      authenticate: vi.fn(async () => principal),
    });
    registerCalendarRoutes(registry, () => service as never);

    const responses = await Promise.all([
      registry.fetch(request("/api/v2/calendar/connections"), env),
      registry.fetch(request("/api/v2/calendar/connections/google/start", { method: "POST" }), env),
      registry.fetch(request("/api/v2/calendar/events?from=2026-08-01&to=2026-08-31"), env),
      registry.fetch(request("/api/v2/calendar/connections/connection-1/sync", {
        method: "POST", body: JSON.stringify({ from: "2026-08-01", to: "2026-08-31" }),
      }), env),
      registry.fetch(request("/api/v2/calendar/connections/connection-1", { method: "DELETE" }), env),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    expect(service.listConnections).toHaveBeenCalledWith("user-1");
    expect(service.startConnection).toHaveBeenCalledWith("user-1", "google");
    expect(service.listEvents).toHaveBeenCalledWith("user-1", { from: "2026-08-01", to: "2026-08-31" });
    expect(service.syncConnection).toHaveBeenCalledWith("user-1", "connection-1", { from: "2026-08-01", to: "2026-08-31" }, expect.any(AbortSignal));
    expect(service.disconnect).toHaveBeenCalledWith("user-1", "connection-1");
  });

  it("redirects OAuth callbacks without exposing error details", async () => {
    const service = { completeOAuth: vi.fn(async () => ({ userId: "user-1", provider: "google" })) };
    const registry = createRouteRegistry({ requestId: () => "req-oauth" });
    registerCalendarRoutes(registry, () => service as never);
    const response = await registry.fetch(request("/api/v2/calendar/oauth/google/callback?state=state&code=code"), env);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://notes.example/?calendar=connected&provider=google");
  });

  it("rejects oversized OAuth callback parameters without invoking the provider", async () => {
    const completeOAuth = vi.fn();
    const registry = createRouteRegistry({ requestId: () => "req-oauth" });
    registerCalendarRoutes(registry, () => ({ completeOAuth } as never));
    const response = await registry.fetch(request(`/api/v2/calendar/oauth/google/callback?state=${"s".repeat(513)}&code=code`), env);
    expect(response.status).toBe(302);
    expect(completeOAuth).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://notes.example/?calendar=error&provider=google");
  });
});
