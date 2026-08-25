import { describe, expect, it } from "vitest";
import { applyMigration, createTestD1 } from "./helpers/d1";

describe("profile account migration", () => {
  it("preserves users and adds profile/security persistence", async () => {
    const test = await createTestD1({ through: 9 });
    try {
      await test.db.prepare(
        "INSERT INTO users (id,email,password_hash,display_name,status,created_at,updated_at) VALUES ('u1','u@example.test','hash','User','active',?,?)",
      ).bind("2026-08-22T00:00:00.000Z", "2026-08-22T00:00:00.000Z").run();
      await applyMigration(test.db, "../../migrations/0010_profile_account_center.sql");
      const user = await test.db.prepare("SELECT display_name, biography, locale, timezone FROM users WHERE id='u1'").first();
      expect(user).toEqual({ display_name: "User", biography: "", locale: "zh-CN", timezone: "Asia/Shanghai" });
      const tables = await test.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('email_change_requests','account_audit_logs') ORDER BY name",
      ).all();
      expect(tables.results.map((row) => row.name)).toEqual(["account_audit_logs", "email_change_requests"]);
    } finally { await test.dispose(); }
  });

  it("rejects audit events outside the account-event allowlist", async () => {
    const test = await createTestD1({ through: 10 });
    try {
      await test.db.prepare(
        "INSERT INTO users (id,email,password_hash,display_name,status,created_at,updated_at) VALUES ('u1','u@example.test','hash','User','active',?,?)",
      ).bind("2026-08-22T00:00:00.000Z", "2026-08-22T00:00:00.000Z").run();
      await applyMigration(test.db, "../../migrations/0011_profile_audit_enforcement.sql");
      await expect(test.db.prepare(
        "INSERT INTO account_audit_logs (id,user_id,event,request_id,created_at) VALUES ('bad','u1','profile.forbidden','req','2026-08-22T00:00:00.000Z')",
      ).run()).rejects.toThrow("ACCOUNT_AUDIT_EVENT_INVALID");
    } finally { await test.dispose(); }
  });
});
