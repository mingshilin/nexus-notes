import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(import.meta.dirname, "../migrations/0001_beta_schema.sql");
const searchMigrationPath = resolve(import.meta.dirname, "../migrations/0002_search_document_sync.sql");
const attachmentMigrationPath = resolve(import.meta.dirname, "../migrations/0003_private_attachments_ocr.sql");
const consistencyMigrationPath = resolve(import.meta.dirname, "../migrations/0004_attachment_consistency.sql");

describe("Beta D1 schema", () => {
  it("creates all public Beta domain tables", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");
    const tables = [
      "users", "sessions", "workspaces", "workspace_members", "notes", "note_revisions",
      "folders", "tags", "reminders", "search_documents", "saved_searches", "databases",
      "database_properties", "database_records", "record_values", "database_views",
      "database_templates", "comments", "notifications", "public_shares", "audit_logs",
      "attachments", "import_jobs", "export_jobs", "ocr_jobs", "processed_operations",
      "sync_changes", "rate_limits", "feedback_items", "queue_outbox",
    ];

    for (const table of tables) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE ${table}\\b`, "i"));
    }
  });

  it("partitions tenant data and revisions mutable entities", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const definitions = ["notes", "database_records", "comments", "attachments"];

    for (const table of definitions) {
      const definition = sql.match(new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`, "i"))?.[1];
      expect(definition, `${table} definition`).toBeDefined();
      expect(definition).toMatch(/workspace_id TEXT NOT NULL/i);
      expect(definition).toMatch(/revision INTEGER NOT NULL DEFAULT 1/i);
    }

    expect(sql).toMatch(/operation_id TEXT NOT NULL UNIQUE/i);
    expect(sql).toMatch(/cursor INTEGER PRIMARY KEY AUTOINCREMENT/i);
  });

  it("keeps the external-content FTS index synchronized", () => {
    expect(existsSync(searchMigrationPath)).toBe(true);
    const sql = readFileSync(searchMigrationPath, "utf8");

    expect(sql).toMatch(/AFTER INSERT ON search_documents/i);
    expect(sql).toMatch(/AFTER UPDATE ON search_documents/i);
    expect(sql).toMatch(/AFTER DELETE ON search_documents/i);
    expect(sql).toMatch(/INSERT INTO search_documents_fts[\s\S]*SELECT rowid/i);
  });

  it("preserves published 0003 and moves source-revision uniqueness into additive 0004", () => {
    const oldSql = readFileSync(attachmentMigrationPath, "utf8");
    const oldDefinition = oldSql.match(/CREATE TABLE beta_ocr_jobs \(([\s\S]*?)\n\);/i)?.[1];
    const upgradeSql = readFileSync(consistencyMigrationPath, "utf8");

    expect(oldDefinition).not.toMatch(/source_revision/i);
    expect(oldDefinition).toMatch(/UNIQUE \(workspace_id, user_id, idempotency_key\)/i);
    expect(upgradeSql).toMatch(/source_revision INTEGER NOT NULL/i);
    expect(upgradeSql).toMatch(/UNIQUE \(workspace_id, attachment_id, source_revision\)/i);
    expect(upgradeSql).toMatch(/CREATE TABLE IF NOT EXISTS queue_outbox/i);
  });
});
