import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { applyMigration, createTestD1, seedTenants } from "./helpers/d1";

const migrationPath = resolve(import.meta.dirname, "../migrations/0006_structured_databases.sql");
const disposals: Array<() => Promise<void>> = [];
const now = "2026-08-21T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe("structured database migration", () => {
  it("is additive, tenant scoped, revisioned, and indexed for stable record interaction", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/workspace_id TEXT NOT NULL/i);
    expect(sql).toMatch(/revision INTEGER NOT NULL DEFAULT 1/i);
    expect(sql).toMatch(/'relation'/i);
    expect(sql).toMatch(/access_level TEXT NOT NULL/i);
    expect(sql).toMatch(/is_hidden INTEGER NOT NULL/i);
    expect(sql).toMatch(/is_read_only INTEGER NOT NULL/i);
    expect(sql).toMatch(/CREATE INDEX database_records_stable_page_idx[\s\S]*updated_at DESC, id DESC/i);
    expect(sql).toMatch(/CREATE INDEX record_values_board_idx[\s\S]*property_id, record_id/i);
  });

  it("upgrades existing property rows and accepts relation properties without losing child values", async () => {
    const testD1 = await createTestD1({ through: 5 });
    disposals.push(testD1.dispose);
    await seedTenants(testD1.db);
    await testD1.db.batch([
      testD1.db.prepare(
        "INSERT INTO databases (id, workspace_id, name, created_by, created_at, updated_at) VALUES ('db-1', 'ws-1', 'Projects', 'user-1', ?, ?)",
      ).bind(now, now),
      testD1.db.prepare(
        "INSERT INTO database_properties (id, workspace_id, database_id, name, type, created_at, updated_at) VALUES ('prop-old', 'ws-1', 'db-1', 'Name', 'text', ?, ?)",
      ).bind(now, now),
      testD1.db.prepare(
        "INSERT INTO database_records (id, workspace_id, database_id, created_by, updated_by, created_at, updated_at) VALUES ('record-1', 'ws-1', 'db-1', 'user-1', 'user-1', ?, ?)",
      ).bind(now, now),
      testD1.db.prepare(
        "INSERT INTO record_values (id, workspace_id, database_id, record_id, property_id, value_json, updated_at) VALUES ('value-1', 'ws-1', 'db-1', 'record-1', 'prop-old', '\"kept\"', ?)",
      ).bind(now),
    ]);

    await applyMigration(testD1.db, "../../migrations/0006_structured_databases.sql");

    expect(await testD1.db.prepare("SELECT value_json FROM record_values WHERE id = 'value-1'").first()).toEqual({ value_json: '"kept"' });
    await expect(testD1.db.prepare(
      `INSERT INTO database_properties
       (id, workspace_id, database_id, name, type, config_json, position, is_hidden, is_read_only, revision, created_at, updated_at)
       VALUES ('prop-relation', 'ws-1', 'db-1', 'Related', 'relation', '{}', 1, 0, 0, 1, ?, ?)`,
    ).bind(now, now).run()).resolves.toBeDefined();
    expect(await testD1.db.prepare("PRAGMA foreign_keys").first()).toEqual({ foreign_keys: 1 });
  });
});
