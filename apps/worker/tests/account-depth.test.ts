import { describe, expect, it } from "vitest";
import { D1AccountRepository } from "../src/account/d1-account-repository";
import { createTestD1 } from "./helpers/d1";

const now = "2026-08-25T00:00:00.000Z";

describe("account depth repository", () => {
  it("creates privacy-safe defaults and updates preferences optimistically", async () => {
    const test = await createTestD1();
    try {
      await test.db.prepare(
        "INSERT INTO users (id,email,password_hash,display_name,status,created_at,updated_at) VALUES ('user-1','one@example.test','hash','One','active',?,?)",
      ).bind(now, now).run();
      const repository = new D1AccountRepository(test.db, { clock: () => new Date(now) });
      const defaults = await repository.getPreferences("user-1");
      expect(defaults).toMatchObject({ in_app_reminders: true, email_reminders: false, push_reminders: false, show_push_title: false, revision: 1 });

      const updated = await repository.updatePreferences("user-1", { base_revision: 1, push_reminders: true, density: "compact" }, "req-1");
      expect(updated).toMatchObject({ push_reminders: true, density: "compact", revision: 2 });
      await expect(repository.updatePreferences("user-1", { base_revision: 1, email_reminders: true }, "req-2"))
        .rejects.toMatchObject({ code: "PREFERENCES_CONFLICT", status: 409 });
    } finally {
      await test.dispose();
    }
  });

  it("returns only the caller activity and revokes every other session", async () => {
    const test = await createTestD1();
    try {
      await test.db.prepare(
        "INSERT INTO users (id,email,password_hash,display_name,status,created_at,updated_at) VALUES ('user-1','one@example.test','hash','One','active',?,?)",
      ).bind(now, now).run();
      await test.db.batch([
        test.db.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,last_seen_at,created_at,user_agent) VALUES ('current','user-1','h1',?,?,?,'Chrome')").bind("2026-09-25T00:00:00.000Z", now, now),
        test.db.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,last_seen_at,created_at,user_agent) VALUES ('other','user-1','h2',?,?,?,'Edge')").bind("2026-09-25T00:00:00.000Z", now, now),
        test.db.prepare("INSERT INTO account_audit_logs (id,user_id,event,request_id,created_at) VALUES ('a1','user-1','profile.updated','req-old',?)").bind(now),
      ]);
      const repository = new D1AccountRepository(test.db, { clock: () => new Date(now) });
      expect((await repository.listActivity("user-1", { limit: 10 })).items).toHaveLength(1);
      expect(await repository.revokeOtherSessions("user-1", "current", "req-revoke")).toEqual({ revoked: 1 });
      expect(await test.db.prepare("SELECT id FROM sessions WHERE user_id='user-1'").all()).toMatchObject({ results: [{ id: "current" }] });
    } finally {
      await test.dispose();
    }
  });
});
