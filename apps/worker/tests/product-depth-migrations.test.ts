import { describe, expect, it } from "vitest";
import { applyMigration, createTestD1 } from "./helpers/d1";

describe("product depth additive migrations", () => {
  it("adds preferences, push, reminder delivery, and encrypted AI storage without arming old reminders", async () => {
    const test = await createTestD1({ through: 13 });
    const now = "2026-08-25T00:00:00.000Z";
    try {
      await test.db.batch([
        test.db.prepare("INSERT INTO users (id,email,password_hash,display_name,status,created_at,updated_at) VALUES ('u1','u@example.test','hash','User','active',?,?)").bind(now, now),
        test.db.prepare("INSERT INTO workspaces (id,owner_user_id,slug,name,created_at,updated_at) VALUES ('ws1','u1','ws1','Workspace',?,?)").bind(now, now),
        test.db.prepare("INSERT INTO reminders (id,workspace_id,note_id,user_id,remind_at,status,revision,created_at,updated_at) VALUES ('r1','ws1',NULL,'u1',?,'pending',1,?,?)").bind(now, now, now),
      ]);

      await applyMigration(test.db, "../../migrations/0014_user_preferences_and_push.sql");
      await applyMigration(test.db, "../../migrations/0015_reminder_delivery.sql");
      await applyMigration(test.db, "../../migrations/0016_user_ai_configs.sql");

      const tables = await test.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('user_preferences','push_subscriptions','reminder_deliveries','reminder_delivery_outbox','user_ai_configs') ORDER BY name",
      ).all<{ name: string }>();
      expect(tables.results.map((row) => row.name)).toEqual([
        "push_subscriptions", "reminder_deliveries", "reminder_delivery_outbox", "user_ai_configs", "user_preferences",
      ]);
      const reminder = await test.db.prepare("SELECT title, timezone, delivery_enabled_at, recurrence_json FROM reminders WHERE id='r1'").first();
      expect(reminder).toEqual({ title: "", timezone: "UTC", delivery_enabled_at: null, recurrence_json: null });
      const aiSql = await test.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_ai_configs'").first<{ sql: string }>();
      expect(aiSql?.sql).toContain("api_key_ciphertext");
      expect(aiSql?.sql).not.toMatch(/api_key\s+TEXT/i);
    } finally {
      await test.dispose();
    }
  });

  it("adds isolated calendar OAuth, connection, and event tables", async () => {
    const test = await createTestD1({ through: 27 });
    try {
      const tables = await test.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('calendar_oauth_states','calendar_connections','calendar_events') ORDER BY name",
      ).all<{ name: string }>();
      expect(tables.results?.map((row) => row.name)).toEqual([
        "calendar_connections", "calendar_events", "calendar_oauth_states",
      ]);
      const indexes = await test.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'calendar_%' ORDER BY name",
      ).all<{ name: string }>();
      expect(indexes.results?.map((row) => row.name)).toEqual([
        "calendar_connections_sync_window_idx", "calendar_connections_user_idx", "calendar_events_user_time_idx", "calendar_oauth_states_expiry_idx",
      ]);
      const columns = await test.db.prepare("PRAGMA table_info(calendar_connections)").all<{ name: string }>();
      expect(columns.results?.map((column) => column.name)).toContain("sync_from");
      expect(columns.results?.map((column) => column.name)).toContain("sync_to");
    } finally {
      await test.dispose();
    }
  });
});
