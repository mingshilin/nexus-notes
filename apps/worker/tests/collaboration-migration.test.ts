import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { applyMigration, createTestD1, migrationPaths, seedTenants } from "./helpers/d1";

describe("Task 8 collaboration migration", () => {
  it("keeps the applied 0007 migration byte-for-byte immutable", () => {
    const migration = readFileSync(resolve(import.meta.dirname, "../migrations/0007_collaboration.sql"));
    expect(createHash("sha256").update(migration).digest("hex"))
      .toBe("01b8036f40a4c8af1e8fb4aa55b19e96733d99e391bd5bae295d6c20f4027991");
  });

  it("is additive and installs tenant, inbox, token, revision, and idempotency fields", async () => {
    expect(migrationPaths.at(-1)).toBe("../../migrations/0008_task8_backend_closure.sql");
    const testDb = await createTestD1();
    try {
      const expectedColumns: Record<string, string[]> = {
        workspace_invitations: ["workspace_id", "token_hash", "status", "revision", "expires_at", "consumed_at", "consumption_id", "consumed_by_user_id"],
        comments: ["workspace_id", "idempotency_key", "idempotency_fingerprint", "revision"],
        mentions: ["workspace_id", "mentioned_user_id", "source_revision"],
        notifications: ["workspace_id", "user_id", "dedupe_key", "deep_link", "revision"],
        activity_logs: ["workspace_id", "actor_user_id", "request_id", "target_type", "target_id"],
        audit_logs: ["workspace_id", "actor_user_id", "request_id", "target_type", "target_id"],
        public_shares: ["workspace_id", "token_hash", "status", "revision", "password_hash", "expires_at"],
        workspace_membership_epochs: ["workspace_id", "user_id", "membership_epoch", "is_active", "revoked_at", "updated_at"],
      };

      for (const [table, columns] of Object.entries(expectedColumns)) {
        const result = await testDb.db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
        expect(result.results.map((column) => column.name), table).toEqual(expect.arrayContaining(columns));
      }

      const invitationIndexes = await testDb.db.prepare("PRAGMA index_list(workspace_invitations)").all<{ name: string; unique: number }>();
      expect(invitationIndexes.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "workspace_invitations_consumption", unique: 1 }),
      ]));
      const commentIndexes = await testDb.db.prepare("PRAGMA index_list(comments)").all<{ name: string }>();
      expect(commentIndexes.results.map((index) => index.name)).toEqual(expect.arrayContaining([
        "comments_actor_idempotency", "comments_workspace_target_cursor",
      ]));
      const idempotencyColumns = await testDb.db.prepare("PRAGMA index_info(comments_actor_idempotency)").all<{ name: string }>();
      expect(idempotencyColumns.results.map((column) => column.name)).toEqual([
        "workspace_id", "author_user_id", "idempotency_key",
      ]);
      await expect(testDb.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'collaboration_operation_results'",
      ).first()).resolves.toEqual({ name: "collaboration_operation_results" });
      await expect(testDb.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'collaboration_operation_guard'",
      ).first()).resolves.toEqual({ name: "collaboration_operation_guard" });
    } finally {
      await testDb.dispose();
    }
  });

  it("makes audit records immutable at the database boundary", async () => {
    const testDb = await createTestD1();
    try {
      await seedTenants(testDb.db);
      await testDb.db.prepare(
        `INSERT INTO audit_logs
         (id, workspace_id, actor_user_id, request_id, action, target_type, target_id, outcome, metadata_json, created_at)
         VALUES ('audit-1', 'ws-1', 'user-1', 'req-1', 'member.role_changed', 'workspace_member', 'user-2', 'success', '{}', '2026-08-22T00:00:00.000Z')`,
      ).run();

      await expect(testDb.db.prepare("UPDATE audit_logs SET action = 'tampered' WHERE id = 'audit-1'").run())
        .rejects.toThrow(/AUDIT_IMMUTABLE/);
      await expect(testDb.db.prepare("DELETE FROM audit_logs WHERE id = 'audit-1'").run())
        .rejects.toThrow(/AUDIT_IMMUTABLE/);
    } finally {
      await testDb.dispose();
    }
  });

  it("backfills deterministic non-empty activity request and target fields before listing legacy rows", async () => {
    const testDb = await createTestD1({ through: 7 });
    try {
      await seedTenants(testDb.db);
      await testDb.db.prepare(
        `INSERT INTO activity_logs
         (id, workspace_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
         VALUES ('legacy-activity', 'ws-1', 'user-1', 'note.updated', 'note', NULL, '{}', '2026-08-21T00:00:00.000Z')`,
      ).run();
      await applyMigration(testDb.db, migrationPaths[7]!);

      const worker = await import("../src/index") as Record<string, any>;
      const Repository = worker.D1CollaborationRepository as new (db: D1Database, options: Record<string, unknown>) => any;
      const repository = new Repository(testDb.db, {
        tokens: { createSessionToken: () => "unused", hash: async (value: string) => value },
        password: { hash: async (value: string) => value, verify: async () => false },
      });
      const page = await repository.listActivity({
        workspaceId: "ws-1", userId: "user-1", role: "owner", capabilities: new Set(),
      }, { limit: 10 });
      expect(page.items).toEqual([
        expect.objectContaining({
          id: "legacy-activity",
          request_id: "legacy-activity:legacy-activity",
          target_type: "note",
          target_id: "legacy-target:legacy-activity",
        }),
      ]);
      expect(page.items[0].request_id).not.toBe("");
      expect(page.items[0].target_type).not.toBe("");
      expect(page.items[0].target_id).not.toBe("");
    } finally {
      await testDb.dispose();
    }
  });

  it("upgrades a populated 0007 database without losing data and preserves actor-scoped idempotency", async () => {
    const testDb = await createTestD1({ through: 7 });
    try {
      await seedTenants(testDb.db);
      await testDb.db.batch([
        testDb.db.prepare(
          `INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at)
           VALUES ('ws-1', 'user-1', 'owner', 1, '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z')`,
        ),
        testDb.db.prepare(
          `INSERT INTO activity_logs
           (id, workspace_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
           VALUES ('legacy-upgrade', 'ws-1', 'user-1', 'database.deleted', 'database', 'db-1', '{}', '2026-08-22T00:00:00.000Z')`,
        ),
      ]);

      await applyMigration(testDb.db, migrationPaths[7]!);

      await expect(testDb.db.prepare(
        "SELECT COUNT(*) AS count FROM activity_logs WHERE id = 'legacy-upgrade'",
      ).first()).resolves.toEqual({ count: 1 });
      await expect(testDb.db.prepare(
        "SELECT membership_epoch, is_active, revoked_at FROM workspace_membership_epochs WHERE workspace_id = 'ws-1' AND user_id = 'user-1'",
      ).first()).resolves.toEqual({ membership_epoch: 1, is_active: 1, revoked_at: null });

      await testDb.db.batch([
        testDb.db.prepare(
          `INSERT INTO comments
           (id, workspace_id, entity_type, entity_id, author_user_id, body, revision, created_at, updated_at, idempotency_key, idempotency_fingerprint)
           VALUES ('comment-one', 'ws-1', 'note', 'note-1', 'user-1', 'one', 1, '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z', 'same-key', 'fingerprint-one')`,
        ),
        testDb.db.prepare(
          `INSERT INTO comments
           (id, workspace_id, entity_type, entity_id, author_user_id, body, revision, created_at, updated_at, idempotency_key, idempotency_fingerprint)
           VALUES ('comment-two', 'ws-1', 'note', 'note-1', 'user-2', 'two', 1, '2026-08-22T00:00:00.000Z', '2026-08-22T00:00:00.000Z', 'same-key', 'fingerprint-two')`,
        ),
      ]);
      await expect(testDb.db.prepare(
        "SELECT COUNT(*) AS count FROM comments WHERE workspace_id = 'ws-1' AND idempotency_key = 'same-key'",
      ).first()).resolves.toEqual({ count: 2 });
    } finally {
      await testDb.dispose();
    }
  });
});
