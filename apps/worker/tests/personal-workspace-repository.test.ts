import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { D1AuthRepository } from "../src/auth/d1-auth-repository";
import { createTestD1 } from "./helpers/d1";

describe("D1AuthRepository personal workspaces", () => {
  let db: D1Database;
  let dispose: () => Promise<void>;
  let nextId: number;

  beforeEach(async () => {
    const database = await createTestD1();
    db = database.db;
    dispose = database.dispose;
    nextId = 0;
  });

  afterEach(async () => dispose());

  async function seedUser(userId: string, verified = false) {
    const now = "2026-08-21T00:00:00.000Z";
    await db.prepare(
      `INSERT INTO users (
         id, email, password_hash, display_name, status, email_verified_at, created_at, updated_at
       ) VALUES (?, ?, 'hash', 'User', 'active', ?, ?, ?)`,
    ).bind(userId, `${userId}@example.test`, verified ? now : null, now, now).run();
  }

  function repository() {
    return new D1AuthRepository(db, () => `generated-${++nextId}`);
  }

  it("concurrently verifies and reconciles exactly one personal workspace with one owner membership", async () => {
    await seedUser("user-1");
    const auth = repository();
    const now = "2026-08-21T00:00:00.000Z";

    await Promise.all([
      auth.markEmailVerifiedAndEnsurePersonalWorkspace("user-1", now),
      auth.ensurePersonalWorkspace("user-1", now),
      auth.ensurePersonalWorkspace("user-1", now),
      auth.ensurePersonalWorkspace("user-1", now),
    ]);

    const user = await db.prepare(
      "SELECT email_verified_at FROM users WHERE id = ?",
    ).bind("user-1").first<{ email_verified_at: string | null }>();
    const workspaces = await db.prepare(
      "SELECT id, workspace_type FROM workspaces WHERE owner_user_id = ?",
    ).bind("user-1").all<{ id: string; workspace_type: string }>();
    const memberships = await db.prepare(
      `SELECT wm.workspace_id, wm.role
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE w.owner_user_id = ? AND wm.user_id = ?`,
    ).bind("user-1", "user-1").all<{ workspace_id: string; role: string }>();

    expect(user?.email_verified_at).toBe(now);
    expect(workspaces.results).toEqual([
      expect.objectContaining({ workspace_type: "personal" }),
    ]);
    expect(memberships.results).toEqual([
      expect.objectContaining({ workspace_id: workspaces.results[0]?.id, role: "owner" }),
    ]);
  });

  it("lists only authorized memberships in deterministic personal-first order", async () => {
    await seedUser("user-1", true);
    await seedUser("user-2", true);
    const now = "2026-08-21T00:00:00.000Z";
    const auth = repository();
    await auth.ensurePersonalWorkspace("user-1", now);
    const personal = await db.prepare(
      "SELECT id FROM workspaces WHERE owner_user_id = ? AND workspace_type = 'personal'",
    ).bind("user-1").first<{ id: string }>();

    await db.batch([
      db.prepare(
        `INSERT INTO workspaces (id, owner_user_id, slug, name, workspace_type, created_at, updated_at)
         VALUES ('team-z', 'user-2', 'z-team', 'Zulu', 'team', ?, ?)`,
      ).bind(now, now),
      db.prepare(
        `INSERT INTO workspaces (id, owner_user_id, slug, name, workspace_type, created_at, updated_at)
         VALUES ('team-a', 'user-2', 'a-team', 'Alpha', 'team', ?, ?)`,
      ).bind(now, now),
    ]);
    await db.batch([
      db.prepare(
        `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at, updated_at)
         VALUES ('team-z', 'user-1', 'viewer', ?, ?)`,
      ).bind(now, now),
      db.prepare(
        `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at, updated_at)
         VALUES ('team-a', 'user-1', 'editor', ?, ?)`,
      ).bind(now, now),
      db.prepare(
        `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at, updated_at)
         VALUES ('team-z', 'user-2', 'owner', ?, ?)`,
      ).bind(now, now),
    ]);

    await expect(auth.listWorkspaceMemberships("user-1")).resolves.toEqual([
      expect.objectContaining({ id: personal?.id, role: "owner", workspaceType: "personal" }),
      expect.objectContaining({ id: "team-a", name: "Alpha", role: "editor", workspaceType: "team" }),
      expect.objectContaining({ id: "team-z", name: "Zulu", role: "viewer", workspaceType: "team" }),
    ]);
  });

  it("reconciles when a legacy team workspace already uses the user-derived slug", async () => {
    await seedUser("user-1", true);
    const now = "2026-08-21T00:00:00.000Z";
    await db.prepare(
      `INSERT INTO workspaces (id, owner_user_id, slug, name, workspace_type, created_at, updated_at)
       VALUES ('legacy-team', 'user-1', 'personal-user-1', 'Legacy team', 'team', ?, ?)`,
    ).bind(now, now).run();

    await expect(repository().ensurePersonalWorkspace("user-1", now)).resolves.toBeUndefined();

    const personal = await db.prepare(
      `SELECT id, slug
       FROM workspaces
       WHERE owner_user_id = 'user-1' AND workspace_type = 'personal'`,
    ).first<{ id: string; slug: string }>();
    expect(personal).toEqual({ id: "generated-1", slug: "personal-generated-1" });
  });
});
