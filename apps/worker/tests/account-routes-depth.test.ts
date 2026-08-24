import { describe, expect, it, vi } from "vitest";
import { createRouteRegistry } from "../src/http/route-registry";
import { registerAccountRoutes } from "../src/routes/account";

const preferences = {
  user_id: "user-1", default_domain: "notes", density: "comfortable", reduced_motion: false,
  week_starts_on: 1 as const, date_format: "yyyy-MM-dd" as const, default_snooze_minutes: 10,
  email_reminders: false, push_reminders: false, in_app_reminders: true, quiet_hours: null,
  show_push_title: false, revision: 1, updated_at: "2026-08-25T00:00:00.000Z",
};

function setup(authenticated = true) {
  const service = {
    getOverview: vi.fn(async () => ({ counts: { workspaces: 1, sessions: 1, notes: 2, databases: 1, upcoming_reminders: 0 }, recent_activity: [] })),
    getPreferences: vi.fn(async () => preferences),
    updatePreferences: vi.fn(async () => ({ ...preferences, density: "compact", revision: 2 })),
    listActivity: vi.fn(async () => ({ items: [], next_cursor: null })),
    revokeOtherSessions: vi.fn(async () => ({ revoked: 2 })),
  };
  const registry = createRouteRegistry({
    requestId: () => "req-account",
    authenticate: vi.fn(async () => authenticated ? { userId: "user-1", sessionId: "session-1" } : null),
  });
  registerAccountRoutes(registry, () => service);
  return { registry, service };
}

describe("account depth routes", () => {
  it("uses only the authenticated principal for overview, preferences, activity, and session revocation", async () => {
    const { registry, service } = setup();
    const responses = await Promise.all([
      registry.fetch(new Request("https://beta.test/api/v2/profile/overview"), {}),
      registry.fetch(new Request("https://beta.test/api/v2/profile/preferences"), {}),
      registry.fetch(new Request("https://beta.test/api/v2/profile/preferences", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ base_revision: 1, density: "compact" }),
      }), {}),
      registry.fetch(new Request("https://beta.test/api/v2/profile/activity?limit=25"), {}),
      registry.fetch(new Request("https://beta.test/api/v2/profile/sessions/revoke-others", { method: "POST" }), {}),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    expect(service.getOverview).toHaveBeenCalledWith("user-1");
    expect(service.getPreferences).toHaveBeenCalledWith("user-1");
    expect(service.updatePreferences).toHaveBeenCalledWith("user-1", { base_revision: 1, density: "compact" }, "req-account");
    expect(service.listActivity).toHaveBeenCalledWith("user-1", { cursor: undefined, limit: 25 });
    expect(service.revokeOtherSessions).toHaveBeenCalledWith("user-1", "session-1", "req-account");
  });

  it("rejects every account-depth route before service calls when unauthenticated", async () => {
    const { registry, service } = setup(false);
    const response = await registry.fetch(new Request("https://beta.test/api/v2/profile/preferences"), {});
    expect(response.status).toBe(401);
    expect(service.getPreferences).not.toHaveBeenCalled();
  });
});
