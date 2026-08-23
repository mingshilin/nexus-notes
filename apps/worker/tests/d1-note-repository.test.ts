import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

const noteRow = {
  id: "note-1",
  workspace_id: "ws-1",
  folder_id: null,
  database_id: null,
  created_by: "user-1",
  updated_by: "user-1",
  title: "Updated title",
  content: "Body",
  status: "active",
  is_favorite: 0,
  is_pinned: 1,
  daily_date: null,
  revision: 2,
  created_at: "2026-08-21T00:00:00.000Z",
  updated_at: "2026-08-21T00:01:00.000Z",
};

function createDb(
  batchResults: unknown[] = [],
  firstResult: unknown = null,
  allResult: unknown = { results: [] },
) {
  const statements: Array<{
    sql: string;
    bindings: unknown[];
    bind: ReturnType<typeof vi.fn>;
    first: ReturnType<typeof vi.fn>;
    all: ReturnType<typeof vi.fn>;
  }> = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      const statement = {
        sql,
        bindings: [] as unknown[],
        bind: vi.fn(),
        first: vi.fn(async () => firstResult),
        all: vi.fn(async () => allResult),
      };
      statement.bind.mockImplementation((...bindings: unknown[]) => {
        statement.bindings = bindings;
        return statement;
      });
      statements.push(statement);
      return statement;
    }),
    batch: vi.fn(async () => batchResults),
  };
  return { db, statements };
}

describe("D1NoteRepository", () => {
  it("creates the note, first revision, and sync change in one batch", async () => {
    const worker = await loadWorker();
    expect(worker.D1NoteRepository).toBeTypeOf("function");
    const { db, statements } = createDb([{}, {}, {}, {}]);
    const Repository = worker.D1NoteRepository as new (db: unknown, createId: () => string) => any;
    const repository = new Repository(db, () => "revision-1");

    const note = await repository.createNote({
      id: "note-1",
      workspaceId: "ws-1",
      userId: "user-1",
      title: "Draft",
      content: "Body",
      folderId: null,
      databaseId: null,
      dailyDate: null,
      isFavorite: false,
      isPinned: true,
      source: "manual",
      now: "2026-08-21T00:00:00.000Z",
    });

    expect(db.batch).toHaveBeenCalledOnce();
    expect(statements).toHaveLength(4);
    expect(statements[0]?.sql).toMatch(/INSERT INTO notes/i);
    expect(statements[1]?.sql).toMatch(/INSERT INTO note_revisions/i);
    expect(statements[2]?.sql).toMatch(/INSERT INTO sync_changes/i);
    expect(statements[3]?.sql).toMatch(/INSERT INTO search_documents/i);
    expect(statements.every((statement) => statement.bindings.includes("ws-1"))).toBe(true);
    expect(note).toMatchObject({ id: "note-1", revision: 1, is_pinned: true });
  });

  it("updates by base revision and writes revision history and sync only on success", async () => {
    const worker = await loadWorker();
    const { db, statements } = createDb([{ results: [noteRow] }, {}, {}, {}]);
    const Repository = worker.D1NoteRepository as new (db: unknown, createId: () => string) => any;
    const repository = new Repository(db, () => "revision-2");

    const result = await repository.updateNote({
      workspaceId: "ws-1",
      userId: "user-1",
      noteId: "note-1",
      baseRevision: 1,
      patch: { title: "Updated title", is_pinned: true, source: "autosave" },
      now: "2026-08-21T00:01:00.000Z",
    });

    expect(result).toMatchObject({ note: { id: "note-1", revision: 2, is_pinned: true }, current: null });
    expect(db.batch).toHaveBeenCalledOnce();
    expect(statements[0]?.sql).toMatch(/UPDATE notes[\s\S]*revision = revision \+ 1[\s\S]*workspace_id = \?[\s\S]*id = \?[\s\S]*revision = \?/i);
    expect(statements[1]?.sql).toMatch(/INSERT INTO note_revisions[\s\S]*SELECT[\s\S]*FROM notes[\s\S]*updated_by = \?[\s\S]*updated_at = \?/i);
    expect(statements[2]?.sql).toMatch(/INSERT INTO sync_changes[\s\S]*SELECT[\s\S]*updated_by = \?[\s\S]*updated_at = \?/i);
    expect(statements[3]?.sql).toMatch(/INSERT INTO search_documents[\s\S]*SELECT[\s\S]*ON CONFLICT/i);
  });

  it("returns the tenant-scoped current note when an optimistic update conflicts", async () => {
    const worker = await loadWorker();
    const { db, statements } = createDb([{ results: [] }, {}, {}, {}], noteRow);
    const Repository = worker.D1NoteRepository as new (db: unknown, createId: () => string) => any;
    const repository = new Repository(db, () => "revision-2");

    const result = await repository.updateNote({
      workspaceId: "ws-1",
      userId: "user-1",
      noteId: "note-1",
      baseRevision: 1,
      patch: { title: "Local title", source: "autosave" },
      now: "2026-08-21T00:01:00.000Z",
    });

    expect(result).toMatchObject({ note: null, current: { id: "note-1", revision: 2 } });
    expect(statements.at(-1)?.sql).toMatch(/SELECT[\s\S]*FROM notes[\s\S]*workspace_id = \?[\s\S]*id = \?/i);
    expect(statements.at(-1)?.bindings).toEqual(["ws-1", "note-1"]);
  });

  it("restores a historical snapshot with the same optimistic lock", async () => {
    const worker = await loadWorker();
    const { db, statements } = createDb([{ results: [noteRow] }, {}, {}, {}]);
    const Repository = worker.D1NoteRepository as new (db: unknown, createId: () => string) => any;
    const repository = new Repository(db, () => "revision-2");

    const result = await repository.restoreRevision({
      workspaceId: "ws-1",
      userId: "user-1",
      noteId: "note-1",
      revision: 1,
      baseRevision: 1,
      now: "2026-08-21T00:01:00.000Z",
    });

    expect(result).toMatchObject({ note: { id: "note-1", revision: 2 }, current: null, revisionFound: true });
    expect(statements[0]?.sql).toMatch(/UPDATE notes[\s\S]*note_revisions[\s\S]*revision = revision \+ 1[\s\S]*notes\.revision = \?/i);
    expect(statements[1]?.sql).toMatch(/updated_by = \?[\s\S]*updated_at = \?/i);
    expect(statements[2]?.sql).toMatch(/updated_by = \?[\s\S]*updated_at = \?/i);
    expect(statements[3]?.sql).toMatch(/INSERT INTO search_documents[\s\S]*ON CONFLICT/i);
    expect(statements[1]?.bindings).toContain("restore");
  });

  it("lists notes with stable tenant-scoped keyset pagination", async () => {
    const worker = await loadWorker();
    const rows = [
      { ...noteRow, id: "note-3", updated_at: "2026-08-21T00:03:00.000Z" },
      { ...noteRow, id: "note-2", updated_at: "2026-08-21T00:02:00.000Z" },
      { ...noteRow, id: "note-1", updated_at: "2026-08-21T00:01:00.000Z" },
    ];
    const firstPageDb = createDb([], null, { results: rows });
    const Repository = worker.D1NoteRepository as new (db: unknown) => any;
    const repository = new Repository(firstPageDb.db);

    const firstPage = await repository.listNotes({ workspaceId: "ws-1", limit: 2 });

    expect(firstPage.items.map((note: { id: string }) => note.id)).toEqual(["note-3", "note-2"]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPageDb.statements[0]?.sql).toMatch(/workspace_id = \?[\s\S]*ORDER BY updated_at DESC, id DESC[\s\S]*LIMIT \?/i);
    expect(firstPageDb.statements[0]?.bindings).toEqual(["ws-1", 3]);

    const nextPageDb = createDb([], null, { results: [] });
    const nextRepository = new Repository(nextPageDb.db);
    await nextRepository.listNotes({ workspaceId: "ws-1", cursor: firstPage.nextCursor, limit: 2 });

    expect(nextPageDb.statements[0]?.sql).toMatch(/updated_at < \?[\s\S]*updated_at = \? AND id < \?/i);
    expect(nextPageDb.statements[0]?.bindings).toEqual([
      "ws-1",
      "2026-08-21T00:02:00.000Z",
      "2026-08-21T00:02:00.000Z",
      "note-2",
      3,
    ]);
  });

  it("applies status, folder, and daily filters before the bounded page limit", async () => {
    const worker = await loadWorker();
    const filteredDb = createDb([], null, { results: [{ ...noteRow, daily_date: "2026-08-23" }] });
    const Repository = worker.D1NoteRepository as new (db: unknown) => any;
    const repository = new Repository(filteredDb.db);

    await repository.listNotes({ workspaceId: "ws-1", status: "active", folderId: null, dailyDate: "2026-08-23", limit: 20 });

    expect(filteredDb.statements[0]?.sql).toMatch(/status = \?[\s\S]*folder_id IS NULL[\s\S]*daily_date = \?[\s\S]*LIMIT \?/i);
    expect(filteredDb.statements[0]?.bindings).toEqual(["ws-1", "active", "2026-08-23", 21]);
  });

  it("lists revisions only from the requested workspace and note", async () => {
    const worker = await loadWorker();
    const revision = {
      id: "revision-1",
      workspace_id: "ws-1",
      note_id: "note-1",
      revision: 1,
      title: "Draft",
      content: "Body",
      source: "manual",
      created_by: "user-1",
      created_at: "2026-08-21T00:00:00.000Z",
    };
    const { db, statements } = createDb([], null, { results: [revision] });
    const Repository = worker.D1NoteRepository as new (db: unknown) => any;
    const repository = new Repository(db);

    await expect(repository.listRevisions("ws-1", "note-1")).resolves.toEqual([revision]);
    expect(statements[0]?.sql).toMatch(/FROM note_revisions[\s\S]*workspace_id = \?[\s\S]*note_id = \?/i);
    expect(statements[0]?.bindings).toEqual(["ws-1", "note-1"]);
  });
});
