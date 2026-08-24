import { describe, expect, it } from "vitest";

type ContractExports = Record<string, any>;

async function contracts() {
  return (await import("../src")) as ContractExports;
}

describe("product depth contracts", () => {
  it("defaults preferences to private opt-in notification settings", async () => {
    const api = await contracts();
    expect(api.UserPreferencesSchema).toBeDefined();
    expect(api.UserPreferencesSchema.parse({ user_id: "user-1", revision: 1, updated_at: "2026-08-25T00:00:00.000Z" })).toEqual({
      user_id: "user-1",
      default_domain: "notes",
      density: "comfortable",
      reduced_motion: false,
      week_starts_on: 1,
      date_format: "yyyy-MM-dd",
      default_snooze_minutes: 10,
      email_reminders: false,
      push_reminders: false,
      in_app_reminders: true,
      quiet_hours: null,
      show_push_title: false,
      revision: 1,
      updated_at: "2026-08-25T00:00:00.000Z",
    });
    expect(api.UpdateUserPreferencesInputSchema.safeParse({ base_revision: 1 }).success).toBe(false);
    expect(api.UpdateUserPreferencesInputSchema.safeParse({ base_revision: 1, push_reminders: true }).success).toBe(true);
  });

  it("supports bounded advanced reminder schedules without breaking old clients", async () => {
    const api = await contracts();
    const oldReminder = {
      id: "reminder-1", workspace_id: "ws-1", note_id: "note-1", user_id: "user-1",
      remind_at: "2026-08-25T01:00:00.000Z", status: "pending", revision: 1,
      created_at: "2026-08-25T00:00:00.000Z", updated_at: "2026-08-25T00:00:00.000Z",
    };
    expect(api.ReminderSchema.safeParse(oldReminder).success).toBe(true);
    expect(api.CreateReminderInputSchema.safeParse({
      title: "周报", remind_at: "2026-08-25T01:00:00.000Z", timezone: "Asia/Shanghai",
      channels: ["in_app", "push"],
      recurrence: {
        frequency: "weekly", interval: 2, weekdays: ["MO", "WE"],
        ends: { type: "count", count: 12 },
      },
    }).success).toBe(true);
    expect(api.CreateReminderInputSchema.safeParse({
      title: "bad", remind_at: "2026-08-25T01:00:00.000Z", timezone: "Asia/Shanghai",
      recurrence: { frequency: "weekly", interval: 1, weekdays: [], ends: { type: "never" } },
    }).success).toBe(false);
    expect(api.SnoozeReminderInputSchema.parse({ base_revision: 2, minutes: 60 })).toEqual({ base_revision: 2, minutes: 60 });
    expect(api.ReminderListQuerySchema.parse({ status: "overdue", limit: 25 })).toMatchObject({ status: "overdue", limit: 25 });
  });

  it("exposes masked personal AI configuration and never accepts a key in summaries", async () => {
    const api = await contracts();
    const summary = {
      configured: true,
      source: "personal",
      base_url: "https://api.deepseek.com/v1/chat/completions",
      model: "deepseek-chat",
      key_hint: "sk-••••9f3a",
      verified_at: null,
      revision: 1,
    };
    expect(api.AiUserConfigSummarySchema.parse(summary)).toEqual(summary);
    expect(api.AiUserConfigSummarySchema.safeParse({ ...summary, api_key: "secret" }).success).toBe(false);
    expect(api.UpsertAiUserConfigInputSchema.safeParse({
      base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", api_key: "sk-valid-personal-key", base_revision: 1,
    }).success).toBe(true);
    expect(api.UpsertAiUserConfigInputSchema.safeParse({
      base_url: "http://127.0.0.1:8080/v1", model: "local", api_key: "sk-valid-personal-key", base_revision: 1,
    }).success).toBe(false);
    expect(api.DeleteAiUserConfigInputSchema.parse({ base_revision: 2 })).toEqual({ base_revision: 2 });
  });

  it("validates browser push subscriptions without exposing private server credentials", async () => {
    const api = await contracts();
    expect(api.PushSubscriptionInputSchema.safeParse({
      endpoint: "https://push.example.test/send/abc",
      expiration_time: null,
      keys: { p256dh: "A".repeat(43), auth: "B".repeat(22) },
      device_name: "Chrome on Windows",
    }).success).toBe(true);
    expect(api.PushSubscriptionInputSchema.safeParse({
      endpoint: "http://push.example.test/send/abc",
      expiration_time: null,
      keys: { p256dh: "A".repeat(43), auth: "B".repeat(22) },
      device_name: "Chrome",
    }).success).toBe(false);
  });
});
