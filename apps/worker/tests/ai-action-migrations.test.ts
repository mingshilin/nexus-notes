import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigration, createTestD1, seedTenants } from "./helpers/d1";

const proposalMigrationPath = resolve(import.meta.dirname, "../migrations/0017_ai_action_proposals.sql");
const outboxMigrationPath = resolve(import.meta.dirname, "../migrations/0018_ai_email_outbox.sql");
const dispatchLeaseMigrationPath = resolve(import.meta.dirname, "../migrations/0019_ai_email_dispatch_leases.sql");
const deliveryLeaseMigrationPath = resolve(import.meta.dirname, "../migrations/0020_ai_email_delivery_leases.sql");
const disposals: Array<() => Promise<void>> = [];
const now = "2026-08-25T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe("AI action migrations", () => {
  it("adds additive AI action proposal and email outbox tables", () => {
    expect(existsSync(proposalMigrationPath)).toBe(true);
    expect(existsSync(outboxMigrationPath)).toBe(true);

    const proposalSql = readFileSync(proposalMigrationPath, "utf8");
    const outboxSql = readFileSync(outboxMigrationPath, "utf8");

    expect(proposalSql).toMatch(/CREATE TABLE ai_action_proposals/i);
    expect(proposalSql).toMatch(/idempotency_key TEXT NOT NULL/i);
    expect(proposalSql).toMatch(/CHECK \(idempotency_key = 'ai-action:' \|\| user_id \|\| ':' \|\| id\)/i);
    expect(proposalSql).toMatch(/CREATE UNIQUE INDEX ai_action_proposals_workspace_idempotency_idx/i);
    expect(outboxSql).toMatch(/CREATE TABLE ai_email_outbox/i);
    expect(outboxSql).toMatch(/action_id TEXT NOT NULL/i);
    expect(outboxSql).toMatch(/attempt_count INTEGER NOT NULL DEFAULT 0/i);
    expect(outboxSql).toMatch(/CREATE INDEX ai_email_outbox_pending_idx/i);
    expect(existsSync(dispatchLeaseMigrationPath)).toBe(true);
    const dispatchLeaseSql = readFileSync(dispatchLeaseMigrationPath, "utf8");
    expect(dispatchLeaseSql).toMatch(/ADD COLUMN dispatch_lease_until TEXT/i);
    expect(dispatchLeaseSql).toMatch(/ADD COLUMN dispatch_claim_token TEXT/i);
    expect(dispatchLeaseSql).toMatch(/CREATE INDEX ai_email_outbox_dispatch_lease_idx/i);
    expect(existsSync(deliveryLeaseMigrationPath)).toBe(true);
    const deliveryLeaseSql = readFileSync(deliveryLeaseMigrationPath, "utf8");
    expect(deliveryLeaseSql).toMatch(/ADD COLUMN delivery_lease_until TEXT/i);
    expect(deliveryLeaseSql).toMatch(/ADD COLUMN delivery_claim_token TEXT/i);
  });

  it("applies both migrations on top of the existing worker schema", async () => {
    const testD1 = await createTestD1({ through: 16 });
    disposals.push(testD1.dispose);
    await seedTenants(testD1.db);

    await applyMigration(testD1.db, "../../migrations/0017_ai_action_proposals.sql");
    await applyMigration(testD1.db, "../../migrations/0018_ai_email_outbox.sql");

    const proposal = await testD1.db.prepare("PRAGMA table_info(ai_action_proposals)").all<{ name: string }>();
    const outbox = await testD1.db.prepare("PRAGMA table_info(ai_email_outbox)").all<{ name: string }>();

    expect(proposal.results.map((row) => row.name)).toEqual([
      "id",
      "user_id",
      "workspace_id",
      "tool",
      "input_json",
      "status",
      "idempotency_key",
      "revision",
      "expires_at",
      "created_at",
      "updated_at",
    ]);
    expect(outbox.results.map((row) => row.name)).toEqual([
      "id",
      "action_id",
      "user_id",
      "workspace_id",
      "to_email",
      "subject",
      "body_text",
      "status",
      "attempt_count",
      "available_at",
      "sent_at",
      "last_error_code",
      "created_at",
      "updated_at",
    ]);

    const indexes = await testD1.db.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'index'
         AND (name LIKE 'ai_action_%' OR name LIKE 'ai_email_%')
       ORDER BY name`,
    ).all<{ name: string }>();
    expect(indexes.results.map((row) => row.name).sort()).toEqual([
      "ai_action_proposals_user_status_expires_idx",
      "ai_action_proposals_workspace_idempotency_idx",
      "ai_email_outbox_pending_idx",
    ]);
  });

  it("rejects malformed and duplicate persisted proposal idempotency keys at the D1 boundary", async () => {
    const testD1 = await createTestD1({ through: 18 });
    disposals.push(testD1.dispose);
    await seedTenants(testD1.db);

    await expect(testD1.db.prepare(
      `INSERT INTO ai_action_proposals
       (id, user_id, workspace_id, tool, input_json, status, idempotency_key, revision, expires_at, created_at, updated_at)
       VALUES ('action-1', 'user-1', 'ws-1', 'send_email', '{"subject":"Hi"}', 'proposed', 'wrong-key', 1, ?, ?, ?)`,
    ).bind(now, now, now).run()).rejects.toThrow();

    await expect(testD1.db.prepare(
      `INSERT INTO ai_action_proposals
       (id, user_id, workspace_id, tool, input_json, status, idempotency_key, revision, expires_at, created_at, updated_at)
       VALUES ('action-2', 'user-1', 'ws-1', 'send_email', '{"subject":"Hi"}', 'proposed', 'ai-action:user-1:action-2', 1, ?, ?, ?)`,
    ).bind(now, now, now).run()).resolves.toBeDefined();

    await expect(testD1.db.prepare(
      `INSERT INTO ai_action_proposals
       (id, user_id, workspace_id, tool, input_json, status, idempotency_key, revision, expires_at, created_at, updated_at)
       VALUES ('action-2', 'user-1', 'ws-1', 'send_email', '{"subject":"Hi"}', 'proposed', 'ai-action:user-1:action-2', 1, ?, ?, ?)`,
    ).bind(now, now, now).run()).rejects.toThrow();
  });

  it("keeps legacy sending rows recoverable when dispatch leases are added", async () => {
    const testD1 = await createTestD1({ through: 16 });
    disposals.push(testD1.dispose);
    await seedTenants(testD1.db);
    await applyMigration(testD1.db, "../../migrations/0017_ai_action_proposals.sql");
    await applyMigration(testD1.db, "../../migrations/0018_ai_email_outbox.sql");
    await testD1.db.batch([
      testD1.db.prepare(
        `INSERT INTO ai_action_proposals
         (id, user_id, workspace_id, tool, input_json, status, idempotency_key, revision, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, 'send_email', ?, 'executed', ?, 1, ?, ?, ?)`,
      ).bind("action-legacy", "user-1", "ws-1", JSON.stringify({ to_email: "user@example.test", subject: "Status", body_text: "Done" }), "ai-action:user-1:action-legacy", now, now, now),
      testD1.db.prepare(
        `INSERT INTO ai_email_outbox
         (id, action_id, user_id, workspace_id, to_email, subject, body_text, status, attempt_count, available_at, sent_at, last_error_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', 0, ?, NULL, NULL, ?, ?)`,
      ).bind("ai-email:action-legacy", "action-legacy", "user-1", "ws-1", "user@example.test", "Status", "Done", now, now, now),
    ]);
    await applyMigration(testD1.db, "../../migrations/0019_ai_email_dispatch_leases.sql");
    const row = await testD1.db.prepare(
      "SELECT dispatch_lease_until, dispatch_claim_token FROM ai_email_outbox WHERE id = ?",
    ).bind("ai-email:action-legacy").first<{ dispatch_lease_until: string; dispatch_claim_token: string }>();
    expect(row).toEqual({ dispatch_lease_until: now, dispatch_claim_token: "legacy:ai-email:action-legacy" });
  });

  it("adds a separate delivery lease without changing the dispatch lease state", async () => {
    const testD1 = await createTestD1({ through: 19 });
    disposals.push(testD1.dispose);
    await applyMigration(testD1.db, "../../migrations/0020_ai_email_delivery_leases.sql");
    const outbox = await testD1.db.prepare("PRAGMA table_info(ai_email_outbox)").all<{ name: string }>();
    expect(outbox.results.map((row) => row.name).slice(-2)).toEqual(["delivery_lease_until", "delivery_claim_token"]);
    const indexes = await testD1.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ai_email_outbox_delivery_lease_idx'",
    ).all<{ name: string }>();
    expect(indexes.results).toHaveLength(1);
  });
});
