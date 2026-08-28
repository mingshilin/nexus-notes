import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Miniflare } from "miniflare";

export const migrationPaths = [
  "../../migrations/0001_beta_schema.sql",
  "../../migrations/0002_search_document_sync.sql",
  "../../migrations/0003_private_attachments_ocr.sql",
  "../../migrations/0004_attachment_consistency.sql",
  "../../migrations/0005_personal_workspace.sql",
  "../../migrations/0006_structured_databases.sql",
  "../../migrations/0007_collaboration.sql",
  "../../migrations/0008_task8_backend_closure.sql",
  "../../migrations/0009_task9_operations.sql",
  "../../migrations/0010_profile_account_center.sql",
  "../../migrations/0011_profile_audit_enforcement.sql",
  "../../migrations/0012_daily_notes.sql",
  "../../migrations/0013_operations_results.sql",
  "../../migrations/0014_user_preferences_and_push.sql",
  "../../migrations/0015_reminder_delivery.sql",
  "../../migrations/0016_user_ai_configs.sql",
  "../../migrations/0017_ai_action_proposals.sql",
  "../../migrations/0018_ai_email_outbox.sql",
  "../../migrations/0019_ai_email_dispatch_leases.sql",
  "../../migrations/0020_ai_email_delivery_leases.sql",
  "../../migrations/0021_ai_trusted_mode.sql",
  "../../migrations/0022_ai_note_actions.sql",
  "../../migrations/0023_ai_organization_actions.sql",
];

export function splitMigration(sql: string) {
  const statements: string[] = [];
  let statement = "";
  let trigger = false;
  for (const sourceLine of sql.split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("--") || /^PRAGMA foreign_keys = ON;$/iu.test(line)) continue;
    if (/^CREATE TRIGGER\b/iu.test(line)) trigger = true;
    statement += `${statement ? " " : ""}${line}`;
    const complete = trigger ? /^END;$/iu.test(line) : line.endsWith(";");
    if (complete) {
      statements.push(statement);
      statement = "";
      trigger = false;
    }
  }
  if (statement) throw new Error(`Incomplete migration statement: ${statement}`);
  return statements;
}

export async function applyMigration(db: D1Database, migrationPath: string) {
  const sql = readFileSync(resolve(import.meta.dirname, migrationPath), "utf8");
  const statements = splitMigration(sql).map((statement) => db.prepare(statement));
  if (statements.length > 0) await db.batch(statements);
}

export async function createTestD1(options: { through?: number } = {}) {
  const miniflare = new Miniflare({
    compatibilityDate: "2026-05-07",
    d1Databases: { DB: "nexus-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
  });
  const db = await miniflare.getD1Database("DB");
  const through = options.through ?? migrationPaths.length;
  for (const migrationPath of migrationPaths.slice(0, through)) await applyMigration(db, migrationPath);
  return { db, dispose: () => miniflare.dispose() };
}

export async function seedTenants(db: D1Database) {
  const now = "2026-08-21T00:00:00.000Z";
  await db.batch([
    db.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, 'hash', ?, 'active', ?, ?)",
    ).bind("user-1", "one@example.test", "One", now, now),
    db.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, 'hash', ?, 'active', ?, ?)",
    ).bind("user-2", "two@example.test", "Two", now, now),
    db.prepare(
      "INSERT INTO workspaces (id, owner_user_id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind("ws-1", "user-1", "one", "One", now, now),
    db.prepare(
      "INSERT INTO workspaces (id, owner_user_id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind("ws-2", "user-2", "two", "Two", now, now),
  ]);
}
