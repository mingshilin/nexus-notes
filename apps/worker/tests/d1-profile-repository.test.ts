import { describe, expect, it } from "vitest";

import { D1ProfileRepository } from "../src/profile/d1-profile-repository";
import { createTestD1 } from "./helpers/d1";

const now = "2026-08-22T00:00:00.000Z";
const later = "2026-09-22T00:00:00.000Z";
const audit = (event: any, requestId = "request-1") => ({ event, requestId, now });

async function seed(db: D1Database, userId = "user-1") {
  await db.prepare(
    "INSERT INTO users (id,email,password_hash,display_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
  ).bind(userId, `${userId}@example.test`, "hash", "One", "active", now, now).run();
}

describe("D1ProfileRepository", () => {
  it("updates the requested profile fields", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      const repository = new D1ProfileRepository(test.db, () => "id-1");

      await repository.updateProfile("user-1", {
        display_name: "New",
        biography: "Bio",
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
      }, audit("profile.updated"));

      await expect(repository.getProfile("user-1")).resolves.toMatchObject({
        display_name: "New",
        biography: "Bio",
        avatar_url: null,
      });
      await expect(test.db.prepare("SELECT event FROM account_audit_logs WHERE user_id = 'user-1'").first())
        .resolves.toEqual({ event: "profile.updated" });
    } finally {
      await test.dispose();
    }
  });

  it("rolls back a profile mutation when its account audit event is rejected", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      const repository = new D1ProfileRepository(test.db, () => "audit-1");

      await test.db.prepare(
        "CREATE TRIGGER reject_profile_audit BEFORE INSERT ON account_audit_logs WHEN NEW.event = 'profile.updated' BEGIN SELECT RAISE(ABORT, 'AUDIT_WRITE_FAILED'); END;",
      ).run();
      await expect(repository.updateProfile("user-1", { display_name: "Changed" }, audit("profile.updated")))
        .rejects.toThrow("AUDIT_WRITE_FAILED");
      await expect(repository.getProfile("user-1")).resolves.toMatchObject({ display_name: "One" });
      await expect(test.db.prepare("SELECT COUNT(*) AS count FROM account_audit_logs WHERE user_id = 'user-1'").first())
        .resolves.toEqual({ count: 0 });
    } finally { await test.dispose(); }
  });

  it("rejects forbidden audit events before starting a D1 mutation", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      const repository = new D1ProfileRepository(test.db, () => "audit-1");
      await expect(repository.updateProfile("user-1", { display_name: "Changed" }, audit("profile.forbidden")))
        .rejects.toMatchObject({ code: "ACCOUNT_AUDIT_EVENT_INVALID", status: 400 });
      await expect(repository.getProfile("user-1")).resolves.toMatchObject({ display_name: "One" });
    } finally { await test.dispose(); }
  });

  it("revokes only an owned non-current session", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      for (const id of ["current", "other"]) {
        await test.db.prepare(
          "INSERT INTO sessions (id,user_id,token_hash,expires_at,last_seen_at,created_at,user_agent) VALUES (?,?,?,?,?,?,?)",
        ).bind(id, "user-1", `hash-${id}`, later, now, now, "Chrome").run();
      }
      const repository = new D1ProfileRepository(test.db, () => "id-1");

      expect(await repository.revokeOwnedSession("user-1", "current", "current", audit("session.revoked"))).toBe(false);
      expect(await repository.revokeOwnedSession("user-1", "other", "current", audit("session.revoked"))).toBe(true);
      expect(await repository.revokeOwnedSession("user-2", "other", "current", audit("session.revoked"))).toBe(false);
      await expect(test.db.prepare("SELECT COUNT(*) AS count FROM account_audit_logs WHERE user_id = 'user-1'").first())
        .resolves.toEqual({ count: 1 });
    } finally {
      await test.dispose();
    }
  });

  it("atomically consumes an email code and updates the email once", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      let nextId = 0;
      const repository = new D1ProfileRepository(test.db, () => `request-${++nextId}`);
      await repository.createEmailChange("user-1", "new@example.test", "code-hash", "2026-08-22T00:15:00.000Z", audit("email.change_requested"));

      expect(await repository.consumeEmailChange("user-1", "new@example.test", "code-hash", audit("email.changed", "request-2"))).toBe(true);
      expect(await repository.consumeEmailChange("user-1", "new@example.test", "code-hash", audit("email.changed", "request-3"))).toBe(false);
      await expect(repository.getProfile("user-1")).resolves.toMatchObject({ email: "new@example.test" });
      await expect(test.db.prepare("SELECT COUNT(*) AS count FROM account_audit_logs WHERE user_id = 'user-1'").first())
        .resolves.toEqual({ count: 2 });
    } finally {
      await test.dispose();
    }
  });

  it("retires older unconsumed email changes before issuing a replacement code", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      let nextId = 0;
      const repository = new D1ProfileRepository(test.db, () => `request-${++nextId}`);

      await repository.createEmailChange("user-1", "older@example.test", "older-code", later, audit("email.change_requested", "request-a"));
      await repository.createEmailChange("user-1", "newer@example.test", "newer-code", later, audit("email.change_requested", "request-b"));

      await expect(repository.consumeEmailChange("user-1", "older@example.test", "older-code", audit("email.changed", "request-c"))).resolves.toBe(false);
      await expect(repository.getProfile("user-1")).resolves.toMatchObject({ email: "user-1@example.test" });
      await expect(repository.consumeEmailChange("user-1", "newer@example.test", "newer-code", audit("email.changed", "request-d"))).resolves.toBe(true);
      await expect(repository.getProfile("user-1")).resolves.toMatchObject({ email: "newer@example.test" });
    } finally {
      await test.dispose();
    }
  });

  it("finds only active users and lists only active sessions for that user", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      await seed(test.db, "user-2");
      await test.db.batch([
        test.db.prepare("UPDATE users SET status = 'suspended' WHERE id = 'user-2'"),
        test.db.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,last_seen_at,created_at,user_agent) VALUES ('current','user-1','current-hash',?,?,?,'Chrome')").bind(later, now, now),
        test.db.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,last_seen_at,created_at,user_agent,revoked_at) VALUES ('revoked','user-1','revoked-hash',?,?,?,'Firefox',?)").bind(later, now, now, now),
        test.db.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,last_seen_at,created_at,user_agent) VALUES ('expired','user-1','expired-hash',?,?,?,'Safari')").bind(now, now, now),
        test.db.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,last_seen_at,created_at,user_agent) VALUES ('foreign','user-2','foreign-hash',?,?,?,'Edge')").bind(later, now, now),
      ]);
      const repository = new D1ProfileRepository(test.db, () => "id-1");

      await expect(repository.findActiveUserByEmail("USER-1@EXAMPLE.TEST")).resolves.toEqual({ id: "user-1" });
      await expect(repository.findActiveUserByEmail("user-2@example.test")).resolves.toBeNull();
      await expect(repository.listSessions("user-1", "current", now)).resolves.toEqual([
        { id: "current", current: true, user_agent: "Chrome", created_at: now, last_seen_at: now, expires_at: later },
      ]);
    } finally {
      await test.dispose();
    }
  });

  it("replaces an avatar, appends an audit row, and keeps the old key for cleanup", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      await test.db.prepare("UPDATE users SET avatar_key = 'avatars/old' WHERE id = 'user-1'").run();
      const repository = new D1ProfileRepository(test.db, () => "audit-1");

      await expect(repository.replaceAvatar("user-1", "avatars/new", audit("avatar.updated"))).resolves.toBe("avatars/old");

      await expect(repository.getProfile("user-1")).resolves.toMatchObject({ avatar_key: "avatars/new", avatar_url: "/api/v2/profile/avatar" });
      await expect(test.db.prepare("SELECT id, event, request_id FROM account_audit_logs WHERE user_id = ?").bind("user-1").first())
        .resolves.toEqual({ id: "audit-1", event: "avatar.updated", request_id: "request-1" });
    } finally {
      await test.dispose();
    }
  });

  it("changes a password and revokes every session except the current one", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      await test.db.batch(["current", "other"].map((id) => test.db.prepare(
        "INSERT INTO sessions (id,user_id,token_hash,expires_at,last_seen_at,created_at,user_agent) VALUES (?,?,?,?,?,?,?)",
      ).bind(id, "user-1", `hash-${id}`, later, now, now, "Chrome")));
      const repository = new D1ProfileRepository(test.db, () => "id-1");

      await repository.changePasswordAndRevokeOthers("user-1", "current", "new-hash", audit("password.changed"));

      await expect(test.db.prepare("SELECT password_hash FROM users WHERE id = 'user-1'").first()).resolves.toEqual({ password_hash: "new-hash" });
      await expect(test.db.prepare("SELECT id, revoked_at FROM sessions WHERE user_id = ? ORDER BY id").bind("user-1").all())
        .resolves.toMatchObject({ results: [{ id: "current", revoked_at: null }, { id: "other", revoked_at: now }] });
      await expect(test.db.prepare("SELECT event FROM account_audit_logs WHERE user_id = 'user-1'").first())
        .resolves.toEqual({ event: "password.changed" });
    } finally {
      await test.dispose();
    }
  });

  it("reports owned team workspaces before deleting the personal workspace and anonymizing the user", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      await seed(test.db, "user-2");
      await test.db.batch([
        test.db.prepare("UPDATE users SET avatar_key = 'avatars/old' WHERE id = 'user-1'"),
        test.db.prepare("INSERT INTO workspaces (id,owner_user_id,slug,name,workspace_type,created_at,updated_at) VALUES ('personal','user-1','personal','Personal','personal',?,?)").bind(now, now),
        test.db.prepare("INSERT INTO workspaces (id,owner_user_id,slug,name,workspace_type,created_at,updated_at) VALUES ('owned-team','user-1','owned-team','Owned team','team',?,?)").bind(now, now),
        test.db.prepare("INSERT INTO workspaces (id,owner_user_id,slug,name,workspace_type,created_at,updated_at) VALUES ('member-team','user-2','member-team','Member team','team',?,?)").bind(now, now),
        test.db.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at,updated_at) VALUES ('personal','user-1','owner',?,?)").bind(now, now),
        test.db.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at,updated_at) VALUES ('member-team','user-1','editor',?,?)").bind(now, now),
        test.db.prepare("INSERT INTO tags (id,workspace_id,name,created_at,updated_at) VALUES ('tag-1','personal','Personal tag',?,?)").bind(now, now),
        test.db.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,last_seen_at,created_at,user_agent) VALUES ('session-1','user-1','session-hash',?,?,?,'Chrome')").bind(later, now, now),
        test.db.prepare("INSERT INTO email_codes (id,user_id,purpose,code_hash,expires_at,created_at) VALUES ('email-code','user-1','change_email','email-code-hash',?,?)").bind(later, now),
        test.db.prepare("INSERT INTO password_resets (id,user_id,token_hash,expires_at,created_at) VALUES ('reset','user-1','reset-hash',?,?)").bind(later, now),
        test.db.prepare("INSERT INTO email_change_requests (id,user_id,new_email,code_hash,expires_at,created_at) VALUES ('change','user-1','changed@example.test','change-hash',?,?)").bind(later, now),
      ]);
      const repository = new D1ProfileRepository(test.db, () => "id-1");

      await expect(repository.listOwnedTeamWorkspaces("user-1")).resolves.toEqual([{ id: "owned-team", name: "Owned team" }]);
      await expect(repository.deleteAccount("user-1", "deleted-user-1@example.invalid", "deleted-hash", audit("account.deleted")))
        .rejects.toMatchObject({ code: "OWNERSHIP_TRANSFER_REQUIRED", status: 409 });
      await expect(test.db.prepare("SELECT status, password_hash, avatar_key FROM users WHERE id = 'user-1'").first())
        .resolves.toEqual({ status: "active", password_hash: "hash", avatar_key: "avatars/old" });
      await expect(test.db.prepare("SELECT COUNT(*) AS count FROM workspaces WHERE id = 'personal'").first()).resolves.toEqual({ count: 1 });
      await expect(test.db.prepare("SELECT COUNT(*) AS count FROM workspace_members WHERE user_id = 'user-1'").first()).resolves.toEqual({ count: 2 });
      await expect(test.db.prepare("SELECT revoked_at FROM sessions WHERE id = 'session-1'").first()).resolves.toEqual({ revoked_at: null });
      await test.db.prepare("DELETE FROM workspaces WHERE id = 'owned-team'").run();
      await expect(repository.deleteAccount("user-1", "deleted-user-1@example.invalid", "deleted-hash", audit("account.deleted", "request-2"))).resolves.toBe("avatars/old");

      await expect(repository.listOwnedTeamWorkspaces("user-1")).resolves.toEqual([]);
      await expect(test.db.prepare("SELECT status, email, password_hash, display_name, biography, avatar_key, deletion_requested_at FROM users WHERE id = 'user-1'").first())
        .resolves.toEqual({ status: "deleted", email: "deleted-user-1@example.invalid", password_hash: "deleted-hash", display_name: "已删除用户", biography: "", avatar_key: null, deletion_requested_at: now });
      await expect(test.db.prepare("SELECT COUNT(*) AS count FROM workspaces WHERE id = 'personal'").first()).resolves.toEqual({ count: 0 });
      await expect(test.db.prepare("SELECT COUNT(*) AS count FROM tags WHERE id = 'tag-1'").first()).resolves.toEqual({ count: 0 });
      await expect(test.db.prepare("SELECT COUNT(*) AS count FROM workspace_members WHERE user_id = 'user-1'").first()).resolves.toEqual({ count: 0 });
      await expect(test.db.prepare("SELECT COUNT(*) AS count FROM email_codes WHERE user_id = 'user-1'").first()).resolves.toEqual({ count: 0 });
      await expect(test.db.prepare("SELECT COUNT(*) AS count FROM password_resets WHERE user_id = 'user-1'").first()).resolves.toEqual({ count: 0 });
      await expect(test.db.prepare("SELECT COUNT(*) AS count FROM email_change_requests WHERE user_id = 'user-1'").first()).resolves.toEqual({ count: 0 });
      await expect(test.db.prepare("SELECT revoked_at FROM sessions WHERE id = 'session-1'").first()).resolves.toEqual({ revoked_at: now });
      await expect(test.db.prepare("SELECT event FROM account_audit_logs WHERE user_id = 'user-1'").first())
        .resolves.toEqual({ event: "account.deleted" });
    } finally {
      await test.dispose();
    }
  });
});
