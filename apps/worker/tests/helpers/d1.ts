import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Miniflare } from "miniflare";

const migrationPaths = [
  "../../migrations/0001_beta_schema.sql",
  "../../migrations/0002_search_document_sync.sql",
  "../../migrations/0003_private_attachments_ocr.sql",
];

function splitMigration(sql: string) {
  const statements: string[] = [];
  let statement = "";
  let trigger = false;
  for (const sourceLine of sql.split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (!line || /^PRAGMA foreign_keys = ON;$/iu.test(line)) continue;
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

export async function createTestD1() {
  const miniflare = new Miniflare({
    compatibilityDate: "2026-05-07",
    d1Databases: { DB: "nexus-test" },
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
  });
  const db = await miniflare.getD1Database("DB");
  for (const migrationPath of migrationPaths) {
    const sql = readFileSync(resolve(import.meta.dirname, migrationPath), "utf8");
    for (const statement of splitMigration(sql)) await db.prepare(statement).run();
  }
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
