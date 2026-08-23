import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { applyMigration, createTestD1, seedTenants } from "./helpers/d1";

const migrationPath = "../../migrations/0012_daily_notes.sql";
const migrationFilePath = "../migrations/0012_daily_notes.sql";
const now = "2026-08-23T00:00:00.000Z";
const disposers: Array<() => Promise<void>> = [];

afterEach(async () => { await Promise.all(disposers.splice(0).map((dispose) => dispose())); });

describe("daily note migration", () => {
  it("preserves legacy duplicate daily notes while preventing another active duplicate", async () => {
    const database = await createTestD1({ through: 11 });
    disposers.push(database.dispose);
    await seedTenants(database.db);
    await database.db.batch(["legacy-a", "legacy-b"].map((id) => database.db.prepare(
      "INSERT INTO notes (id, workspace_id, created_by, updated_by, title, content, status, daily_date, revision, created_at, updated_at) VALUES (?, 'ws-1', 'user-1', 'user-1', ?, '', 'active', '2026-08-23', 1, ?, ?)",
    ).bind(id, id, now, now)));

    const sql = readFileSync(resolve(import.meta.dirname, migrationFilePath), "utf8");
    expect(sql).toMatch(/daily_date/i);
    await applyMigration(database.db, migrationPath);

    expect(await database.db.prepare("SELECT COUNT(*) AS count FROM notes WHERE workspace_id = 'ws-1' AND daily_date = '2026-08-23'").first<{ count: number }>()).toEqual({ count: 2 });
    await expect(database.db.prepare(
      "INSERT INTO notes (id, workspace_id, created_by, updated_by, title, content, status, daily_date, revision, created_at, updated_at) VALUES ('new-duplicate', 'ws-1', 'user-1', 'user-1', 'new', '', 'active', '2026-08-23', 1, ?, ?)",
    ).bind(now, now).run()).rejects.toThrow(/DAILY_NOTE_EXISTS/i);
  });

  it("returns the newest preserved duplicate and rejects updates into its historical date", async () => {
    const database = await createTestD1({ through: 11 });
    disposers.push(database.dispose);
    await seedTenants(database.db);
    await database.db.batch([
      database.db.prepare(
        "INSERT INTO notes (id, workspace_id, created_by, updated_by, title, content, status, daily_date, revision, created_at, updated_at) VALUES (?, 'ws-1', 'user-1', 'user-1', ?, '', 'active', '2026-08-23', 1, ?, ?)",
      ).bind("legacy-old", "legacy-old", "2026-08-23T00:00:00.000Z", "2026-08-23T01:00:00.000Z"),
      database.db.prepare(
        "INSERT INTO notes (id, workspace_id, created_by, updated_by, title, content, status, daily_date, revision, created_at, updated_at) VALUES (?, 'ws-1', 'user-1', 'user-1', ?, '', 'active', '2026-08-23', 1, ?, ?)",
      ).bind("legacy-new", "legacy-new", "2026-08-23T00:00:00.000Z", "2026-08-23T02:00:00.000Z"),
    ]);

    await applyMigration(database.db, migrationPath);
    const worker = await import("../src");
    const repository = new worker.D1NoteRepository(database.db, () => "unused-id");
    const opened = await repository.openOrCreateDaily({
      id: "would-be-created",
      workspaceId: "ws-1",
      userId: "user-1",
      title: "Daily Note 2026-08-23",
      content: "",
      folderId: null,
      databaseId: null,
      dailyDate: "2026-08-23",
      isFavorite: false,
      isPinned: false,
      source: "manual",
      now,
      requestId: "req-open-duplicate",
    });

    expect(opened.id).toBe("legacy-new");
    await database.db.prepare(
      "INSERT INTO notes (id, workspace_id, created_by, updated_by, title, content, status, revision, created_at, updated_at) VALUES ('update-candidate', 'ws-1', 'user-1', 'user-1', 'candidate', '', 'active', 1, ?, ?)",
    ).bind(now, now).run();
    await expect(database.db.prepare("UPDATE notes SET daily_date = '2026-08-23' WHERE id = 'update-candidate'").run()).rejects.toThrow(/DAILY_NOTE_EXISTS/i);

    const historical = await database.db.prepare(
      "SELECT id, updated_at FROM notes WHERE id IN ('legacy-old', 'legacy-new') ORDER BY id",
    ).all<{ id: string; updated_at: string }>();
    expect(historical.results).toEqual([
      { id: "legacy-new", updated_at: "2026-08-23T02:00:00.000Z" },
      { id: "legacy-old", updated_at: "2026-08-23T01:00:00.000Z" },
    ]);
  });
});
