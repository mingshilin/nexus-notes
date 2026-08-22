import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src")) as WorkerExports;
}

function createDb(allResolver: (sql: string) => unknown[] = () => []) {
  const statements: Array<{ sql: string; bindings: unknown[]; bind: any; all: any; first: any; run: any }> = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      const statement = {
        sql,
        bindings: [] as unknown[],
        bind: vi.fn(),
        all: vi.fn(async () => ({ results: allResolver(sql) })),
        first: vi.fn(async () => allResolver(sql)[0] ?? null),
        run: vi.fn(async () => ({ success: true })),
      };
      statement.bind.mockImplementation((...bindings: unknown[]) => {
        statement.bindings = bindings;
        return statement;
      });
      statements.push(statement);
      return statement;
    }),
    batch: vi.fn(async () => []),
  };
  return { db, statements };
}

describe("D1TaxonomyRepository", () => {
  it("creates and lists tenant-scoped folders and tags", async () => {
    const worker = await loadWorker();
    expect(worker.D1TaxonomyRepository).toBeTypeOf("function");
    const folder = {
      id: "folder-1", workspace_id: "ws-1", parent_id: null, name: "Projects", position: 0,
      revision: 1, created_at: "2026-08-21T00:00:00.000Z", updated_at: "2026-08-21T00:00:00.000Z",
    };
    const tag = {
      id: "tag-1", workspace_id: "ws-1", name: "research", color: "#14B8A6", revision: 1,
      created_at: "2026-08-21T00:00:00.000Z", updated_at: "2026-08-21T00:00:00.000Z",
    };
    const { db, statements } = createDb((sql) => sql.includes("FROM folders") ? [folder] : sql.includes("FROM tags") ? [tag] : []);
    const ids = ["folder-1", "tag-1"];
    const Repository = worker.D1TaxonomyRepository as new (db: unknown, createId: () => string) => any;
    const repository = new Repository(db, () => ids.shift()!);

    await repository.createFolder("ws-1", { name: "Projects" }, "2026-08-21T00:00:00.000Z");
    await repository.createTag("ws-1", { name: "research", color: "#14B8A6" }, "2026-08-21T00:00:00.000Z");
    await expect(repository.listFolders("ws-1")).resolves.toEqual([folder]);
    await expect(repository.listTags("ws-1")).resolves.toEqual([tag]);

    expect(statements.every((statement) => statement.bindings.includes("ws-1"))).toBe(true);
  });

  it("replaces note tags and links atomically without accepting cross-workspace targets", async () => {
    const worker = await loadWorker();
    const { db, statements } = createDb();
    const Repository = worker.D1TaxonomyRepository as new (db: unknown, createId: () => string) => any;
    const repository = new Repository(db, () => "link-1");

    await repository.setNoteTags("ws-1", "note-1", ["tag-1", "tag-2"], "2026-08-21T00:00:00.000Z");
    await repository.setNoteLinks("ws-1", "note-1", ["note-2"], "2026-08-21T00:00:00.000Z");

    expect(db.batch).toHaveBeenCalledTimes(2);
    expect(statements[0]?.sql).toMatch(/DELETE FROM note_tags[\s\S]*workspace_id = \?[\s\S]*notes/i);
    expect(statements[1]?.sql).toMatch(/INSERT INTO note_tags[\s\S]*SELECT[\s\S]*FROM tags[\s\S]*workspace_id = \?/i);
    expect(statements[3]?.sql).toMatch(/DELETE FROM note_links[\s\S]*workspace_id = \?[\s\S]*notes/i);
    expect(statements[4]?.sql).toMatch(/INSERT INTO note_links[\s\S]*SELECT[\s\S]*target[\s\S]*workspace_id = \?/i);
    expect(statements.every((statement) => statement.bindings.includes("ws-1"))).toBe(true);
  });

  it("does not report a folder created when its parent is outside the workspace", async () => {
    const worker = await loadWorker();
    const { db } = createDb(() => []);
    const Repository = worker.D1TaxonomyRepository as new (db: unknown, createId: () => string) => any;
    const repository = new Repository(db, () => "folder-1");

    await expect(repository.createFolder(
      "ws-1",
      { name: "Child", parent_id: "foreign-parent" },
      "2026-08-21T00:00:00.000Z",
    )).resolves.toBeNull();
  });

  it("lists outgoing links and backlinks inside one workspace", async () => {
    const worker = await loadWorker();
    const link = {
      id: "link-1", workspace_id: "ws-1", source_note_id: "note-1", target_note_id: "note-2",
      created_at: "2026-08-21T00:00:00.000Z",
    };
    const { db, statements } = createDb((sql) => sql.includes("FROM note_links") ? [link] : []);
    const Repository = worker.D1TaxonomyRepository as new (db: unknown) => any;
    const repository = new Repository(db);

    await expect(repository.listNoteLinks("ws-1", "note-1")).resolves.toEqual([link]);
    await expect(repository.listBacklinks("ws-1", "note-2")).resolves.toEqual([link]);

    expect(statements[0]?.sql).toMatch(/workspace_id = \?[\s\S]*source_note_id = \?/i);
    expect(statements[1]?.sql).toMatch(/workspace_id = \?[\s\S]*target_note_id = \?/i);
  });
});
