import { describe, expect, it } from "vitest";

import { applyMigration, createTestD1, migrationPaths, seedTenants } from "./helpers/d1";

describe("Task 8 collaboration migration", () => {
  it("is additive and installs tenant, inbox, token, revision, and idempotency fields", async () => {
    expect(migrationPaths.at(-1)).toBe("../../migrations/0007_collaboration.sql");
    const testDb = await createTestD1();
    try {
      const expectedColumns: Record<string, string[]> = {
        workspace_invitations: ["workspace_id", "token_hash", "status", "revision", "expires_at", "consumed_at", "consumption_id", "consumed_by_user_id"],
        comments: ["workspace_id", "idempotency_key", "revision"],
        mentions: ["workspace_id", "mentioned_user_id", "source_revision"],
        notifications: ["workspace_id", "user_id", "dedupe_key", "deep_link", "revision"],
        activity_logs: ["workspace_id", "actor_user_id", "request_id", "target_type", "target_id"],
        audit_logs: ["workspace_id", "actor_user_id", "request_id", "target_type", "target_id"],
        public_shares: ["workspace_id", "token_hash", "status", "revision", "password_hash", "expires_at"],
        workspace_membership_epochs: ["workspace_id", "user_id", "membership_epoch", "updated_at"],
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
      expect(commentIndexes.results.map((index) => index.name)).toContain("comments_workspace_target_cursor");
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
    const testDb = await createTestD1({ through: 6 });
    try {
      await seedTenants(testDb.db);
      await testDb.db.prepare(
        `INSERT INTO activity_logs
         (id, workspace_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
         VALUES ('legacy-activity', 'ws-1', 'user-1', 'note.updated', 'note', NULL, '{}', '2026-08-21T00:00:00.000Z')`,
      ).run();
      await applyMigration(testDb.db, migrationPaths[6]!);

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
});
