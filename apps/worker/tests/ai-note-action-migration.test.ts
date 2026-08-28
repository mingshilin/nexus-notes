import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigration, createTestD1, seedTenants, splitMigration } from "./helpers/d1";

const disposals: Array<() => Promise<void>> = [];
const now = "2026-08-28T00:00:00.000Z";

function statementsFrom(db: D1Database, statements: string[]) {
  return statements.map((statement) => db.prepare(statement));
}

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe("AI note action migration", () => {
  it("preserves legacy proposals, outbox leases, foreign keys, and accepts note tools", async () => {
    const test = await createTestD1({ through: 21 });
    disposals.push(test.dispose);
    await seedTenants(test.db);
    await test.db.batch([
      test.db.prepare(
        `INSERT INTO ai_action_proposals
         (id, user_id, workspace_id, tool, input_json, status, idempotency_key, revision, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, 'send_email', ?, 'executed', ?, 1, ?, ?, ?)`,
      ).bind("legacy-action", "user-1", "ws-1", JSON.stringify({ to_email: "user@example.test", subject: "Hi", body_text: "Body" }), "ai-action:user-1:legacy-action", now, now, now),
      test.db.prepare(
        `INSERT INTO ai_email_outbox
         (id, action_id, user_id, workspace_id, to_email, subject, body_text, status, attempt_count, available_at, sent_at, last_error_code, created_at, updated_at, dispatch_lease_until, dispatch_claim_token, delivery_lease_until, delivery_claim_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', 1, ?, NULL, 'OLD_ERROR', ?, ?, ?, ?, ?, ?)`,
      ).bind("ai-email:legacy-action", "legacy-action", "user-1", "ws-1", "user@example.test", "Hi", "Body", now, now, now, now, "dispatch-token", now, "delivery-token"),
    ]);

    await applyMigration(test.db, "../../migrations/0022_ai_note_actions.sql");

    await expect(test.db.prepare(
      "SELECT tool, status, requires_confirmation, result_json, error_code, error_message, error_status FROM ai_action_proposals WHERE id = ?",
    ).bind("legacy-action").first()).resolves.toEqual({
      tool: "send_email",
      status: "executed",
      requires_confirmation: 1,
      result_json: null,
      error_code: null,
      error_message: null,
      error_status: null,
    });
    await expect(test.db.prepare(
      "SELECT status, attempt_count, dispatch_lease_until, dispatch_claim_token, delivery_lease_until, delivery_claim_token FROM ai_email_outbox WHERE id = ?",
    ).bind("ai-email:legacy-action").first()).resolves.toEqual({
      status: "sending",
      attempt_count: 1,
      dispatch_lease_until: now,
      dispatch_claim_token: "dispatch-token",
      delivery_lease_until: now,
      delivery_claim_token: "delivery-token",
    });

    await expect(test.db.prepare(
      `INSERT INTO ai_action_proposals
       (id, user_id, workspace_id, tool, input_json, status, idempotency_key, revision, expires_at, created_at, updated_at, requires_confirmation)
       VALUES (?, ?, ?, 'update_note', ?, 'conflict', ?, 2, ?, ?, ?, 1)`,
    ).bind(
      "note-action", "user-1", "ws-1",
      JSON.stringify({ target_note_id: "note-1", base_revision: 1, patch: { title: "New" } }),
      "ai-action:user-1:note-action", now, now, now,
    ).run()).resolves.toBeDefined();

    const outboxSql = await test.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ai_email_outbox'",
    ).first<{ sql: string }>();
    expect(outboxSql?.sql).toContain("REFERENCES ai_action_proposals(id)");
  });

  it("rolls back a failed atomic rebuild and applies cleanly on retry", async () => {
    const test = await createTestD1({ through: 21 });
    disposals.push(test.dispose);
    await seedTenants(test.db);
    await test.db.batch([
      test.db.prepare(
        `INSERT INTO ai_action_proposals
         (id, user_id, workspace_id, tool, input_json, status, idempotency_key, revision, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, 'send_email', ?, 'executed', ?, 1, ?, ?, ?)`,
      ).bind("legacy-action", "user-1", "ws-1", JSON.stringify({ to_email: "user@example.test", subject: "Hi", body_text: "Body" }), "ai-action:user-1:legacy-action", now, now, now),
      test.db.prepare(
        `INSERT INTO ai_email_outbox
         (id, action_id, user_id, workspace_id, to_email, subject, body_text, status, attempt_count, available_at, sent_at, last_error_code, created_at, updated_at, dispatch_lease_until, dispatch_claim_token, delivery_lease_until, delivery_claim_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', 1, ?, NULL, 'OLD_ERROR', ?, ?, ?, ?, ?, ?)`,
      ).bind("ai-email:legacy-action", "legacy-action", "user-1", "ws-1", "user@example.test", "Hi", "Body", now, now, now, now, "dispatch-token", now, "delivery-token"),
    ]);

    const migrationPath = resolve(import.meta.dirname, "../migrations/0022_ai_note_actions.sql");
    const statements = splitMigration(readFileSync(migrationPath, "utf8"));
    const renameProposalIndex = statements.findIndex((statement) => statement.startsWith("ALTER TABLE ai_action_proposals RENAME TO ai_action_proposals_legacy"));
    expect(renameProposalIndex).toBeGreaterThan(0);
    const faultyStatements = statementsFrom(test.db, statements);
    faultyStatements.splice(renameProposalIndex + 1, 0, test.db.prepare(
      "INSERT INTO task6_forced_missing_table (value) VALUES (1)",
    ));
    await expect(test.db.batch(faultyStatements)).rejects.toThrow();

    await expect(test.db.prepare("SELECT id, status FROM ai_action_proposals WHERE id = ?").bind("legacy-action").first()).resolves.toEqual({
      id: "legacy-action",
      status: "executed",
    });
    await expect(test.db.prepare("SELECT id, status FROM ai_email_outbox WHERE id = ?").bind("ai-email:legacy-action").first()).resolves.toEqual({
      id: "ai-email:legacy-action",
      status: "sending",
    });
    await expect(test.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('ai_action_proposals_legacy','ai_email_outbox_legacy')",
    ).all()).resolves.toMatchObject({ results: [] });
    const noteColumnsBeforeRetry = await test.db.prepare("PRAGMA table_info(notes)").all<{ name: string }>();
    expect(noteColumnsBeforeRetry.results.map((column) => column.name)).not.toContain("ai_last_mutation_token");

    await applyMigration(test.db, "../../migrations/0022_ai_note_actions.sql");

    await expect(test.db.prepare(
      "SELECT status, requires_confirmation, result_json, error_code, error_message, error_status FROM ai_action_proposals WHERE id = ?",
    ).bind("legacy-action").first()).resolves.toEqual({
      status: "executed",
      requires_confirmation: 1,
      result_json: null,
      error_code: null,
      error_message: null,
      error_status: null,
    });
    await expect(test.db.prepare(
      "SELECT status, attempt_count, dispatch_lease_until, dispatch_claim_token, delivery_lease_until, delivery_claim_token FROM ai_email_outbox WHERE id = ?",
    ).bind("ai-email:legacy-action").first()).resolves.toEqual({
      status: "sending",
      attempt_count: 1,
      dispatch_lease_until: now,
      dispatch_claim_token: "dispatch-token",
      delivery_lease_until: now,
      delivery_claim_token: "delivery-token",
    });
  });

  it("fails safely when reapplied without rewriting executed action state", async () => {
    const test = await createTestD1({ through: 21 });
    disposals.push(test.dispose);
    await seedTenants(test.db);
    await test.db.prepare(
      `INSERT INTO ai_action_proposals
       (id, user_id, workspace_id, tool, input_json, status, idempotency_key, revision, expires_at, created_at, updated_at)
       VALUES ('reapply-action', 'user-1', 'ws-1', 'send_email', '{}', 'proposed', 'ai-action:user-1:reapply-action', 1, ?, ?, ?)`,
    ).bind(now, now, now).run();

    await applyMigration(test.db, "../../migrations/0022_ai_note_actions.sql");
    await test.db.prepare(
      `UPDATE ai_action_proposals
       SET status = 'executed', requires_confirmation = 0, revision = 2,
           result_json = ?, error_code = NULL, error_message = NULL, error_status = NULL
       WHERE id = 'reapply-action'`,
    ).bind(JSON.stringify({ action_id: "reapply-action", status: "executed", entity_id: "email-1" })).run();
    const before = await test.db.prepare(
      "SELECT status, requires_confirmation, revision, result_json FROM ai_action_proposals WHERE id = 'reapply-action'",
    ).first();

    await expect(applyMigration(test.db, "../../migrations/0022_ai_note_actions.sql")).rejects.toThrow();
    await expect(test.db.prepare(
      "SELECT status, requires_confirmation, revision, result_json FROM ai_action_proposals WHERE id = 'reapply-action'",
    ).first()).resolves.toEqual(before);
  });
});
