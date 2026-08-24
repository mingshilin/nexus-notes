import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src")) as WorkerExports;
}

function createDb(options: { all?: unknown; first?: unknown } = {}) {
  const statements: Array<{
    sql: string;
    bindings: unknown[];
    bind: ReturnType<typeof vi.fn>;
    all: ReturnType<typeof vi.fn>;
    first: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
  }> = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      const statement = {
        sql,
        bindings: [] as unknown[],
        bind: vi.fn(),
        all: vi.fn(async () => options.all ?? { results: [] }),
        first: vi.fn(async () => options.first ?? null),
        run: vi.fn(async () => ({ success: true })),
      };
      statement.bind.mockImplementation((...bindings: unknown[]) => {
        statement.bindings = bindings;
        return statement;
      });
      statements.push(statement);
      return statement;
    }),
  };
  return { db, statements };
}

const completeFilters = {
  tag_ids: ["tag-1"],
  folder_ids: ["folder-1"],
  database_ids: ["db-1"],
  member_ids: ["user-1"],
  attachment_types: ["application/pdf"],
  ocr_statuses: ["complete"],
  source_types: ["note", "attachment"],
  favorite: true,
  pinned: false,
  date_from: "2026-08-01",
  date_to: "2026-08-31",
};

describe("D1KnowledgeRepository", () => {
  it("searches FTS inside one workspace and applies every saved-search filter before pagination", async () => {
    const worker = await loadWorker();
    expect(worker.D1KnowledgeRepository).toBeTypeOf("function");
    const row = {
      entity_type: "note",
      entity_id: "note-1",
      title: "Alpha project",
      content: "Main body",
      tags: "research",
      properties: "",
      attachment_names: "",
      ocr_text: "Alpha scan",
      revision: 2,
      updated_at: "2026-08-21T00:00:00.000Z",
    };
    const { db, statements } = createDb({ all: { results: [row] } });
    const Repository = worker.D1KnowledgeRepository as new (db: unknown) => any;
    const repository = new Repository(db);

    const result = await repository.search("ws-1", {
      query: "Alpha",
      filters: completeFilters,
      limit: 25,
    });

    expect(result.items).toEqual([expect.objectContaining({
      entity_id: "note-1",
      hit_sources: ["title", "ocr"],
    })]);
    expect(statements[0]?.sql).toMatch(/search_documents_fts MATCH \?/i);
    expect(statements[0]?.sql).toMatch(/sd\.workspace_id = \?/i);
    expect(statements[0]?.sql).toMatch(/note_tags/i);
    expect(statements[0]?.sql).toMatch(/attachments/i);
    expect(statements[0]?.sql).toMatch(/ocr_jobs/i);
    expect(statements[0]?.sql).toMatch(/LEFT JOIN notes n[\s\S]*a\.note_id/i);
    expect(statements[0]?.sql).toMatch(/af\.id = sd\.entity_id OR af\.note_id = sd\.entity_id/i);
    expect(statements[0]?.sql).toMatch(/ORDER BY sd\.updated_at DESC, sd\.entity_id DESC[\s\S]*LIMIT \?/i);
    expect(statements[0]?.bindings).toContain("ws-1");
    expect(statements[0]?.bindings.at(-1)).toBe(26);
  });

  it("stores and reads complete saved-search filters without dropping fields", async () => {
    const worker = await loadWorker();
    const { db, statements } = createDb({ all: { results: [] } });
    const Repository = worker.D1KnowledgeRepository as new (db: unknown, createId: () => string) => any;
    const repository = new Repository(db, () => "saved-1");
    const now = "2026-08-21T00:00:00.000Z";

    const saved = await repository.createSavedSearch({
      workspaceId: "ws-1",
      userId: "user-1",
      input: { name: "Research", query: "Alpha", filters: completeFilters },
      now,
    });

    expect(saved).toMatchObject({ id: "saved-1", workspace_id: "ws-1", filters: completeFilters });
    expect(statements[0]?.sql).toMatch(/INSERT INTO saved_searches/i);
    expect(statements[0]?.bindings).toContain(JSON.stringify(completeFilters));
    expect(statements[0]?.bindings).not.toContain("[object Object]");
  });

  it("does not invent a text hit source for filters-only searches", async () => {
    const worker = await loadWorker();
    const row = {
      entity_type: "note", entity_id: "note-1", title: "Project", content: "Body",
      tags: "", properties: "", attachment_names: "", ocr_text: "", revision: 1,
      updated_at: "2026-08-21T00:00:00.000Z",
    };
    const { db } = createDb({ all: { results: [row] } });
    const Repository = worker.D1KnowledgeRepository as new (db: unknown) => any;
    const repository = new Repository(db);

    const result = await repository.search("ws-1", {
      query: "",
      filters: {
        tag_ids: [], folder_ids: [], database_ids: [], member_ids: [], attachment_types: [],
        ocr_statuses: [], source_types: ["note"],
      },
      limit: 25,
    });

    expect(result.items[0]?.hit_sources).toEqual([]);
  });

  it("lists and deletes saved searches by both workspace and owner", async () => {
    const worker = await loadWorker();
    const row = {
      id: "saved-1",
      workspace_id: "ws-1",
      user_id: "user-1",
      name: "Research",
      query: "Alpha",
      filters_json: JSON.stringify(completeFilters),
      revision: 1,
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T00:00:00.000Z",
    };
    const { db, statements } = createDb({ all: { results: [row] } });
    const Repository = worker.D1KnowledgeRepository as new (db: unknown) => any;
    const repository = new Repository(db);

    await expect(repository.listSavedSearches("ws-1", "user-1")).resolves.toEqual([
      expect.objectContaining({ id: "saved-1", filters: completeFilters }),
    ]);
    await repository.deleteSavedSearch("ws-1", "user-1", "saved-1");

    expect(statements[0]?.sql).toMatch(/FROM saved_searches[\s\S]*workspace_id = \?[\s\S]*user_id = \?/i);
    expect(statements[1]?.sql).toMatch(/DELETE FROM saved_searches[\s\S]*workspace_id = \?[\s\S]*user_id = \?[\s\S]*id = \?/i);
    expect(statements[1]?.bindings).toEqual(["ws-1", "user-1", "saved-1"]);
  });

  it("merges daily notes, reminders, and date-property records without leaving the workspace", async () => {
    const worker = await loadWorker();
    const rows = [
      { id: "daily-1", kind: "daily_note", date: "2026-08-21", title: "Daily", entity_id: "note-1", note_id: "note-1", database_id: null, status: "active" },
      { id: "reminder-1", kind: "reminder", date: "2026-08-22", title: "Reminder", entity_id: "reminder-1", note_id: "note-1", database_id: null, status: "pending" },
      { id: "record-1", kind: "database_record", date: "2026-08-23", title: "Record", entity_id: "record-1", note_id: null, database_id: "db-1", status: null },
    ];
    const { db, statements } = createDb({ all: { results: rows } });
    const Repository = worker.D1KnowledgeRepository as new (db: unknown) => any;
    const repository = new Repository(db);

    await expect(repository.getCalendarFeed({ workspaceId: "ws-1", userId: "user-1", role: "viewer", capabilities: new Set<string>() }, { from: "2026-08-01", to: "2026-08-31" })).resolves.toEqual({ items: rows });
    expect(statements[0]?.sql).toMatch(/daily_date/i);
    expect(statements[0]?.sql).toMatch(/reminders/i);
    expect(statements[0]?.sql).toMatch(/record_values/i);
    expect(statements[0]?.sql).toMatch(/database_properties/i);
    expect(statements[0]?.sql).toMatch(/is_hidden = 0/i);
    expect(statements[0]?.sql).toMatch(/field_permissions/i);
    expect(statements[0]?.sql).toMatch(/workspace_id = \?/i);
    expect(statements[0]?.bindings).toEqual(["ws-1", "2026-08-01", "2026-08-31", "ws-1", "user-1", "2026-08-01", "2026-08-31", "ws-1", "viewer", "user-1", "viewer", "user-1", "2026-08-01", "2026-08-31"]);
  });
});
