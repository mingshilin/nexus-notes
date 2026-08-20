import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(import.meta.dirname, "../migrations/0001_beta_schema.sql");

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
});
