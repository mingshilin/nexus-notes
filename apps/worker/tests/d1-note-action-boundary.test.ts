import { afterEach, describe, expect, it } from "vitest";

import { D1NoteRepository } from "../src";
import { createTestD1, seedTenants } from "./helpers/d1";

const disposals: Array<() => Promise<void>> = [];
const now = "2026-08-28T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe("D1 note action reference boundaries", () => {
  it("rejects folder and database references owned by another workspace at the write boundary", async () => {
    const test = await createTestD1({ through: 22 });
    disposals.push(test.dispose);
    await seedTenants(test.db);
    await test.db.batch([
      test.db.prepare(
        "INSERT INTO folders (id, workspace_id, name, created_at, updated_at) VALUES ('folder-w2', 'ws-2', 'Private', ?, ?)",
      ).bind(now, now),
      test.db.prepare(
        "INSERT INTO databases (id, workspace_id, name, created_by, created_at, updated_at) VALUES ('database-w2', 'ws-2', 'Private', 'user-2', ?, ?)",
      ).bind(now, now),
    ]);
    const repository = new D1NoteRepository(test.db, () => "revision-id");

    await expect(repository.createNote({
      id: "cross-create",
      workspaceId: "ws-1",
      userId: "user-1",
      title: "Cross workspace",
      content: "Body",
      folderId: "folder-w2",
      databaseId: null,
      dailyDate: null,
      isFavorite: false,
      isPinned: false,
      source: "manual",
      now,
    })).rejects.toBeDefined();
    await expect(repository.createNote({
      id: "cross-create-db",
      workspaceId: "ws-1",
      userId: "user-1",
      title: "Cross workspace",
      content: "Body",
      folderId: null,
      databaseId: "database-w2",
      dailyDate: null,
      isFavorite: false,
      isPinned: false,
      source: "manual",
      now,
    })).rejects.toBeDefined();
    const valid = await repository.createNote({
      id: "valid-note",
      workspaceId: "ws-1",
      userId: "user-1",
      title: "Valid",
      content: "Body",
      folderId: null,
      databaseId: null,
      dailyDate: null,
      isFavorite: false,
      isPinned: false,
      source: "manual",
      now,
    });

    const before = await test.db.prepare(
      "SELECT folder_id, database_id, revision FROM notes WHERE id = ?",
    ).bind(valid.id).first();
    await expect(repository.updateNote({
      workspaceId: "ws-1",
      userId: "user-1",
      noteId: valid.id,
      baseRevision: 1,
      patch: { folder_id: "folder-w2", source: "manual" },
      now,
    })).resolves.toMatchObject({ note: null, current: expect.objectContaining({ revision: 1 }) });
    await expect(repository.updateNote({
      workspaceId: "ws-1",
      userId: "user-1",
      noteId: valid.id,
      baseRevision: 1,
      patch: { database_id: "database-w2", source: "manual" },
      now,
    })).resolves.toMatchObject({ note: null, current: expect.objectContaining({ revision: 1 }) });
    await expect(test.db.prepare(
      "SELECT folder_id, database_id, revision FROM notes WHERE id = ?",
    ).bind(valid.id).first()).resolves.toEqual(before);
  });

  it("replays a committed idempotent update when concurrent callers pass the precheck together", async () => {
    const test = await createTestD1({ through: 22 });
    disposals.push(test.dispose);
    await seedTenants(test.db);
    const base = new D1NoteRepository(test.db, () => crypto.randomUUID());
    const note = await base.createNote({
      id: "concurrent-note",
      workspaceId: "ws-1",
      userId: "user-1",
      title: "Original",
      content: "Body",
      folderId: null,
      databaseId: null,
      dailyDate: null,
      isFavorite: false,
      isPinned: false,
      source: "manual",
      now,
    });

    let prechecks = 0;
    let releasePrechecks!: () => void;
    const precheckBarrier = new Promise<void>((resolve) => { releasePrechecks = resolve; });
    let batches = 0;
    let releaseBatches!: () => void;
    const batchBarrier = new Promise<void>((resolve) => { releaseBatches = resolve; });
    const guardedDb = new Proxy(test.db, {
      get(target, property, receiver) {
        if (property === "prepare") {
          return (sql: string) => {
            const statement = Reflect.get(target, property, receiver).call(target, sql) as D1PreparedStatement;
            if (sql.includes("FROM ai_note_action_idempotency") && prechecks < 2) {
              const first = statement.first.bind(statement);
              statement.first = async <T>() => {
                prechecks += 1;
                if (prechecks === 2) releasePrechecks();
                await precheckBarrier;
                return first<T>();
              };
            }
            return statement;
          };
        }
        if (property === "batch") {
          return async <T>(statements: D1PreparedStatement[]) => {
            batches += 1;
            if (batches === 2) releaseBatches();
            await batchBarrier;
            return Reflect.get(target, property, receiver).call(target, statements) as Promise<D1Result<T>[]>;
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as unknown as D1Database;
    const repository = new D1NoteRepository(guardedDb, () => crypto.randomUUID());
    const updates = await Promise.all([
      repository.updateNote({
        workspaceId: "ws-1", userId: "user-1", noteId: note.id, baseRevision: 1,
        patch: { title: "AI title", source: "manual" }, now,
        idempotencyKey: "ai-note-action:concurrent",
      }),
      repository.updateNote({
        workspaceId: "ws-1", userId: "user-1", noteId: note.id, baseRevision: 1,
        patch: { title: "AI title", source: "manual" }, now,
        idempotencyKey: "ai-note-action:concurrent",
      }),
    ]);

    expect(updates).toHaveLength(2);
    expect(updates.every((result) => result.note?.revision === 2)).toBe(true);
    expect(updates.every((result) => result.current === null)).toBe(true);
    expect(await test.db.prepare("SELECT COUNT(*) AS count FROM note_revisions WHERE note_id = ? AND revision = 2").bind(note.id).first()).toEqual({ count: 1 });
    expect(await test.db.prepare("SELECT COUNT(*) AS count FROM sync_changes WHERE entity_type = 'note' AND entity_id = ? AND revision = 2").bind(note.id).first()).toEqual({ count: 1 });
    expect(await test.db.prepare("SELECT COUNT(*) AS count FROM ai_note_action_idempotency WHERE idempotency_key = 'ai-note-action:concurrent'").first()).toEqual({ count: 1 });
  });
});
