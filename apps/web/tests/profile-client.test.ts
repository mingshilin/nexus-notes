import { describe, expect, it, vi } from "vitest";
import { ProfileClient } from "../src/data/profile-client";

const profile = {
  id: "u1",
  email: "user@example.test",
  display_name: "User",
  biography: "",
  locale: "en-US",
  timezone: "UTC",
  avatar_url: "/api/v2/profile/avatar",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const session = {
  id: "s1",
  current: true,
  user_agent: "Test",
  created_at: "2026-01-01T00:00:00.000Z",
  last_seen_at: "2026-01-01T00:00:00.000Z",
  expires_at: "2026-01-02T00:00:00.000Z",
};

describe("ProfileClient", () => {
  it("maps every user-scoped operation to its path, method, and policy without workspace headers", async () => {
    const request = vi.fn(async (options: { path: string }) => {
      if (options.path === "/api/v2/profile/sessions") return { items: [session] };
      if (options.path.includes("email/change")) return { accepted: true };
      if (options.path.includes("password/change")) return { changed: true };
      if (options.path.includes("sessions/")) return { revoked: true };
      if (options.path === "/api/v2/profile" && options.method === "DELETE") return { deleted: true };
      return profile;
    });
    const createId = vi.fn()
      .mockReturnValueOnce("id-update")
      .mockReturnValueOnce("id-avatar")
      .mockReturnValueOnce("id-delete-avatar")
      .mockReturnValueOnce("id-email-request")
      .mockReturnValueOnce("id-email-confirm")
      .mockReturnValueOnce("id-password")
      .mockReturnValueOnce("id-session")
      .mockReturnValueOnce("id-account");
    const client = new ProfileClient({ request } as never, { createId });
    const signal = new AbortController().signal;

    await client.getProfile(signal);
    await client.updateProfile({ display_name: "New" }, signal);
    const file = new Blob(["avatar"], { type: "image/png" }) as File;
    await client.uploadAvatar(file, signal);
    await client.deleteAvatar(signal);
    await client.requestEmailChange({ new_email: "new@example.test", current_password: "current-password" }, signal);
    await client.confirmEmailChange({ new_email: "new@example.test", code: "123456" }, signal);
    await client.changePassword({ current_password: "current-password", new_password: "replacement-password" }, signal);
    await client.listSessions(signal);
    await client.revokeSession("s2", signal);
    await client.deleteAccount({ current_password: "current-password", confirmation: "永久删除我的账户" }, signal);

    expect(request.mock.calls.map(([options]) => options)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/api/v2/profile", method: "GET", requestClass: "query", policy: expect.objectContaining({ timeoutMs: 8_000, retry: 2, dedupeKey: "profile" }) }),
      expect.objectContaining({ path: "/api/v2/profile", method: "PATCH", requestClass: "command", policy: expect.objectContaining({ timeoutMs: 8_000, retry: 0, idempotencyKey: "id-update" }) }),
      expect.objectContaining({ path: "/api/v2/profile/avatar", method: "POST", body: file, bodyMode: "raw", headers: { "content-type": "image/png" }, requestClass: "command", policy: expect.objectContaining({ timeoutMs: 15_000, retry: 0, idempotencyKey: "id-avatar" }) }),
      expect.objectContaining({ path: "/api/v2/profile/avatar", method: "DELETE", requestClass: "command", policy: expect.objectContaining({ timeoutMs: 8_000, retry: 0, idempotencyKey: "id-delete-avatar" }) }),
      expect.objectContaining({ path: "/api/v2/profile/email/change", method: "POST", requestClass: "command", policy: expect.objectContaining({ retry: 0, idempotencyKey: "id-email-request" }) }),
      expect.objectContaining({ path: "/api/v2/profile/email/confirm", method: "POST", requestClass: "command", policy: expect.objectContaining({ retry: 0, idempotencyKey: "id-email-confirm" }) }),
      expect.objectContaining({ path: "/api/v2/profile/password/change", method: "POST", requestClass: "command", policy: expect.objectContaining({ retry: 0, idempotencyKey: "id-password" }) }),
      expect.objectContaining({ path: "/api/v2/profile/sessions", method: "GET", requestClass: "query", policy: expect.objectContaining({ timeoutMs: 8_000, retry: 2, dedupeKey: "profile:sessions" }) }),
      expect.objectContaining({ path: "/api/v2/profile/sessions/s2", method: "DELETE", requestClass: "command", policy: expect.objectContaining({ retry: 0, idempotencyKey: "id-session" }) }),
      expect.objectContaining({ path: "/api/v2/profile", method: "DELETE", requestClass: "command", policy: expect.objectContaining({ retry: 0, idempotencyKey: "id-account" }) }),
    ]));
    expect(request.mock.calls.map(([options]) => options.headers)).not.toContainEqual(expect.objectContaining({ "x-workspace-id": expect.anything() }));
    expect(request.mock.calls.map(([options]) => options.policy.signal)).toEqual(Array(10).fill(signal));
  });

  it("rejects invalid shared-schema responses", async () => {
    const request = vi.fn(async () => ({ ...profile, unexpected: true }));
    const client = new ProfileClient({ request } as never);

    await expect(client.getProfile()).rejects.toThrow();
  });

  it("creates a fresh idempotency key for each command", async () => {
    const request = vi.fn(async () => profile);
    const createId = vi.fn().mockReturnValueOnce("one").mockReturnValueOnce("two");
    const client = new ProfileClient({ request } as never, { createId });

    await client.updateProfile({ display_name: "One" });
    await client.updateProfile({ display_name: "Two" });

    expect(request.mock.calls.map(([options]) => options.policy.idempotencyKey)).toEqual(["one", "two"]);
  });

  it("keeps account overview and preferences for five minutes and invalidates preferences after mutation", async () => {
    let now = 0;
    const preferences = {
      user_id: "u1", default_domain: "notes", density: "comfortable", reduced_motion: false,
      week_starts_on: 1, date_format: "yyyy-MM-dd", default_snooze_minutes: 10,
      email_reminders: false, push_reminders: false, in_app_reminders: true,
      quiet_hours: null, show_push_title: false, revision: 1,
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const overview = {
      counts: { workspaces: 1, sessions: 1, notes: 10, databases: 2, upcoming_reminders: 3 },
      profile_complete: true, ai_configured: false, recent_activity: [],
    };
    const request = vi.fn(async (options: { path: string; method?: string }) => {
      if (options.path.endsWith("overview")) return overview;
      if (options.method === "PATCH") return { ...preferences, density: "compact", revision: 2 };
      return preferences;
    });
    const client = new ProfileClient({ request } as never, { now: () => now, createId: () => "pref-command" });
    await client.getOverview();
    await client.getOverview();
    await client.getPreferences();
    await client.getPreferences();
    expect(request).toHaveBeenCalledTimes(2);
    now = 5 * 60_000 + 1;
    await client.getOverview();
    expect(request).toHaveBeenCalledTimes(3);
    await client.updatePreferences({ base_revision: 1, density: "compact" });
    await client.getPreferences();
    expect(request.mock.calls.filter(([input]) => input.path === "/api/v2/profile/preferences")).toHaveLength(3);
  });
});
