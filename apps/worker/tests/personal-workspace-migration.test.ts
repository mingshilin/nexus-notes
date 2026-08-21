import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { applyMigration, createTestD1 } from "./helpers/d1";

const migrationPath = resolve(import.meta.dirname, "../migrations/0005_personal_workspace.sql");
const openDatabases: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((dispose) => dispose()));
});

async function upgradedDatabase() {
  const database = await createTestD1({ through: 4 });
  openDatabases.push(database.dispose);
  await applyMigration(database.db, "../../migrations/0005_personal_workspace.sql");
  return database.db;
}

async function seedUser(db: D1Database, userId: string) {
  const now = "2026-08-21T00:00:00.000Z";
  await db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, 'hash', 'User', 'active', ?, ?)",
  ).bind(userId, `${userId}@example.test`, now, now).run();
}

async function insertWorkspace(
  db: D1Database,
  input: { id: string; ownerId: string; type: "personal" | "team" },
) {
  const now = "2026-08-21T00:00:00.000Z";
  return db.prepare(
    `INSERT INTO workspaces (id, owner_user_id, slug, name, workspace_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(input.id, input.ownerId, input.id, input.id, input.type, now, now).run();
}

describe("0005 personal workspace migration", () => {
  it("is additive and scopes personal uniqueness without collapsing team workspaces", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/ALTER TABLE workspaces\s+ADD COLUMN workspace_type/i);
    expect(sql).toMatch(/workspace_type[^;]+DEFAULT 'team'[^;]+CHECK[^;]+'personal'[^;]+'team'/is);
    expect(sql).toMatch(/CREATE UNIQUE INDEX[^;]+owner_user_id[^;]+WHERE workspace_type = 'personal'/is);
    expect(sql).toMatch(/CREATE TRIGGER[^;]+workspace[^;]+quota/is);
  });

  it("allows required personal reconciliation beyond quota but rejects a third explicit team workspace", async () => {
    const db = await upgradedDatabase();
    await seedUser(db, "user-1");

    await insertWorkspace(db, { id: "team-1", ownerId: "user-1", type: "team" });
    await insertWorkspace(db, { id: "team-2", ownerId: "user-1", type: "team" });
    await expect(insertWorkspace(db, { id: "personal-1", ownerId: "user-1", type: "personal" })).resolves.toBeDefined();
    await expect(insertWorkspace(db, { id: "personal-2", ownerId: "user-1", type: "personal" })).rejects.toThrow();
    await expect(insertWorkspace(db, { id: "team-3", ownerId: "user-1", type: "team" })).rejects.toThrow(/quota/i);

    const count = await db.prepare(
      "SELECT COUNT(*) AS count FROM workspaces WHERE owner_user_id = ?",
    ).bind("user-1").first<{ count: number }>();
    expect(count?.count).toBe(3);
  });
});
