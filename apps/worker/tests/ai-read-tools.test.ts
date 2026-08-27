import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "@nexus/contracts";

import { AiReadToolError, AiReadTools, type AiReadExecutionContext } from "../src/ai/ai-read-tools";
import { D1DatabaseRepository } from "../src/databases/d1-database-repository";
import { createTestD1, seedTenants } from "./helpers/d1";

const disposals: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

const now = "2026-08-28T00:00:00.000Z";
const context = (overrides: Partial<AiReadExecutionContext> = {}): AiReadExecutionContext => ({
  workspaceId: "ws-1",
  userId: "user-1",
  selectedNoteIds: ["note-1"],
  selectedDatabaseIds: ["db-1"],
  allowWorkspaceSearch: false,
  role: "viewer",
  capabilities: new Set<string>(),
  ...overrides,
});

const note = (overrides: Record<string, unknown> = {}) => ({
  id: "note-1",
  workspace_id: "ws-1",
  folder_id: null,
  database_id: null,
  created_by: "user-1",
  updated_by: "user-1",
  title: "Project plan",
  content: "Visible note body",
  status: "active" as const,
  is_favorite: false,
  is_pinned: false,
  daily_date: null,
  revision: 2,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const reminder = (overrides: Record<string, unknown> = {}) => ({
  id: "reminder-1",
  workspace_id: "ws-1",
  note_id: "note-1",
  user_id: "user-1",
  remind_at: "2026-08-29T09:00:00.000Z",
  title: "Follow up",
  timezone: "Asia/Shanghai",
  channels: ["in_app"] as const,
  recurrence: null,
  recurrence_anchor_local: null,
  occurrence_count: 0,
  delivery_enabled_at: now,
  snoozed_until: null,
  last_delivered_at: null,
  status: "pending" as const,
  revision: 1,
  created_at: now,
  updated_at: now,
  ...overrides,
});

function createTools(overrides: Record<string, unknown> = {}) {
  return new AiReadTools({
    notes: {
      get: vi.fn(async (_context: unknown, id: string) => id === "note-1" ? note() : note({ id, workspace_id: "ws-2", content: "other workspace" })),
      list: vi.fn(async () => ({ items: [note()], next_cursor: null })),
    },
    knowledge: {
      listReminderPage: vi.fn(async () => ({ items: [reminder()], next_cursor: null })),
    },
    databases: {
      listDatabases: vi.fn(async () => [{ id: "db-1", workspace_id: "ws-1", name: "Projects", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now }]),
      getDatabase: vi.fn(async () => ({
        database: { id: "db-1", workspace_id: "ws-1", name: "Projects", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now },
        role: "viewer" as const,
        properties: [{ id: "title", workspace_id: "ws-1", database_id: "db-1", name: "Title", type: "text" as const, config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now }],
        views: [],
        templates: [],
      })),
      searchRecords: vi.fn(async () => ({ items: [{ id: "record-1", workspace_id: "ws-1", database_id: "db-1", note_id: null, values: { title: "Launch" }, created_by: "user-1", updated_by: "user-1", revision: 1, created_at: now, updated_at: now }], next_cursor: null })),
      getRecord: vi.fn(async () => ({ id: "record-1", workspace_id: "ws-1", database_id: "db-1", note_id: null, values: { title: "Launch" }, created_by: "user-1", updated_by: "user-1", revision: 1, created_at: now, updated_at: now })),
    },
    ...overrides,
  } as never);
}

describe("AI read tools", () => {
  it("requires an explicit selected or workspace search scope", async () => {
    const tools = createTools();
    await expect(tools.execute("search_notes", { query: "plan" }, context({ selectedNoteIds: [] }), new AbortController().signal))
      .rejects.toMatchObject<Partial<AiReadToolError>>({ code: "AI_READ_SCOPE_REQUIRED", status: 400 });
  });

  it("reads selected notes only and returns source metadata without internal fields", async () => {
    const tools = createTools();
    const result = await tools.execute("search_notes", { query: "plan", limit: 100 }, context(), new AbortController().signal);

    expect(result.items).toEqual([expect.objectContaining({
      source_type: "note",
      source_id: "note-1",
      workspace_id: "ws-1",
      title: "Project plan",
      excerpt: "Visible note body",
    })]);
    expect(result.items[0]).not.toHaveProperty("created_by");
    expect(result.items[0]).not.toHaveProperty("updated_by");
    expect(result.items[0]).not.toHaveProperty("secret");
    expect(result.scope).toEqual(expect.objectContaining({ workspace_id: "ws-1", selected_only: true }));
  });

  it("uses workspace search only when explicitly enabled and bounds the result count", async () => {
    const notes = {
      get: vi.fn(),
      list: vi.fn(async (actor: { workspaceId: string }, options: { limit: number }) => {
        expect(actor.workspaceId).toBe("ws-1");
        expect(options.limit).toBeLessThanOrEqual(50);
        return { items: [note()], next_cursor: "next" };
      }),
    };
    const tools = createTools({ notes });
    const result = await tools.execute("search_notes", { query: "plan", limit: 500 }, context({ selectedNoteIds: [], allowWorkspaceSearch: true }), new AbortController().signal);
    expect(notes.list).toHaveBeenCalledOnce();
    expect(result.next_cursor).toBe("next");
    expect(result.scope).toEqual(expect.objectContaining({ selected_only: false }));
  });

  it("paginates selected-note search with a scope-bound cursor", async () => {
    const get = vi.fn(async (_actor: unknown, id: string) => note({ id, title: `Plan ${id}`, content: "roadmap" }));
    const tools = createTools({ notes: { get, list: vi.fn() } });
    const scopedContext = context({ selectedNoteIds: ["note-1", "note-2", "note-3"] });

    const firstPage = await tools.execute("search_notes", { query: "plan", limit: 1 }, scopedContext, new AbortController().signal);
    expect(firstPage.items.map((item) => item.source_id)).toEqual(["note-1"]);
    expect(firstPage.next_cursor).toEqual(expect.any(String));

    const secondPage = await tools.execute(
      "search_notes",
      { query: "plan", limit: 1, cursor: firstPage.next_cursor },
      scopedContext,
      new AbortController().signal,
    );
    expect(secondPage.items.map((item) => item.source_id)).toEqual(["note-2"]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("rejects a direct note read outside the selected scope and rejects cross-workspace context", async () => {
    const tools = createTools();
    await expect(tools.execute("get_note", { note_id: "note-2" }, context(), new AbortController().signal))
      .rejects.toMatchObject({ code: "AI_READ_TARGET_NOT_SELECTED", status: 403 });
    await expect(tools.execute("get_note", { note_id: "note-1" }, context({ workspaceId: "ws-2" }), new AbortController().signal))
      .rejects.toMatchObject({ code: "AI_READ_CROSS_WORKSPACE", status: 403 });
  });

  it("marks direct selected reads as selected-only when workspace search is also enabled", async () => {
    const tools = createTools();
    const readContext = context({ allowWorkspaceSearch: true });

    const noteResult = await tools.execute("get_note", { note_id: "note-1" }, readContext, new AbortController().signal);
    const recordResult = await tools.execute(
      "get_database_record",
      { database_id: "db-1", record_id: "record-1" },
      readContext,
      new AbortController().signal,
    );

    expect(noteResult.scope.selected_only).toBe(true);
    expect(recordResult.scope.selected_only).toBe(true);
  });

  it("routes database reads through the workspace-bound repository and preserves only readable values", async () => {
    const tools = createTools();
    const result = await tools.execute("get_database_record", { database_id: "db-1", record_id: "record-1" }, context(), new AbortController().signal);
    expect(result.items[0]).toEqual(expect.objectContaining({
      source_type: "database_record",
      source_id: "record-1",
      workspace_id: "ws-1",
      values: { title: "Launch" },
    }));
    expect(result.items[0]).not.toHaveProperty("created_by");
  });

  it("passes the server-derived role and capabilities to database reads", async () => {
    const getDatabase = vi.fn(async (actor: WorkspaceContext) => {
      expect(actor.role).toBe("editor");
      expect(actor.capabilities).toEqual(new Set(["database.read"]));
      return {
        database: { id: "db-1", workspace_id: "ws-1", name: "Projects", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now },
        role: "editor" as const,
        properties: [],
        views: [],
        templates: [],
      };
    });
    const tools = new AiReadTools({
      notes: { get: vi.fn(), list: vi.fn() },
      knowledge: { listReminderPage: vi.fn() },
      databases: {
        listDatabases: vi.fn(async () => []),
        getDatabase,
        searchRecords: vi.fn(async () => ({ items: [], next_cursor: null })),
        getRecord: vi.fn(),
      },
    });
    await expect(tools.execute("search_databases", { query: "" }, context({ selectedDatabaseIds: ["db-1"], role: "editor", capabilities: new Set(["database.read"]) }), new AbortController().signal)).resolves.toMatchObject({ tool: "search_databases" });
    expect(getDatabase).toHaveBeenCalledOnce();
  });

  it("keeps real D1 field permissions authoritative for AI record reads", async () => {
    const test = await createTestD1();
    disposals.push(test.dispose);
    await seedTenants(test.db);
    const nowDate = new Date(now);
    await test.db.prepare(
      "INSERT INTO workspace_members (workspace_id,user_id,role,revision,joined_at,updated_at) VALUES ('ws-1','user-2','viewer',1,?,?)",
    ).bind(now, now).run();
    const repository = new D1DatabaseRepository(test.db, {
      createId: (() => {
        let index = 0;
        return () => `generated-${++index}`;
      })(),
      clock: () => nowDate,
    });
    const owner = { workspaceId: "ws-1", userId: "user-1", role: "owner" as const, capabilities: new Set<string>() };
    const viewer = { workspaceId: "ws-1", userId: "user-2", role: "viewer" as const, capabilities: new Set<string>() };
    const database = await repository.createDatabase(owner, { name: "Projects", description: "" });
    const title = await repository.createProperty(owner, database.id, { name: "Title", type: "text", config: {}, position: 0 });
    const secret = await repository.createProperty(owner, database.id, { name: "Secret", type: "text", config: {}, position: 1 });
    await repository.setFieldPermission(owner, database.id, secret.id, { subject_type: "role", subject_id: "viewer", can_read: false, can_write: false, base_revision: 1 });
    const record = await repository.createRecord(owner, database.id, { note_id: null, values: { [title.id]: "Visible", [secret.id]: "Hidden" } });
    const tools = new AiReadTools({
      notes: { get: vi.fn(), list: vi.fn() },
      knowledge: { listReminderPage: vi.fn() },
      databases: repository,
    });

    const result = await tools.execute("get_database_record", { database_id: database.id, record_id: record.id }, context({
      userId: "user-2",
      role: "viewer",
      selectedDatabaseIds: [database.id],
    }), new AbortController().signal);
    expect(result.items[0]?.values).toEqual({ [title.id]: "Visible" });
    expect(result.items[0]?.values).not.toHaveProperty(secret.id);
  });

  it("denies an unselected database even when the user can search selected databases", async () => {
    const tools = createTools();
    await expect(tools.execute("get_database_record", { database_id: "db-2", record_id: "record-1" }, context(), new AbortController().signal))
      .rejects.toMatchObject({ code: "AI_READ_TARGET_NOT_SELECTED", status: 403 });
  });

  it("lists reminders through the user-scoped knowledge service and returns a bounded source", async () => {
    const tools = createTools();
    const result = await tools.execute("list_reminders", { include_completed: true, limit: 500 }, context({ selectedNoteIds: [], selectedDatabaseIds: [] }), new AbortController().signal);
    expect(result.items[0]).toEqual(expect.objectContaining({ source_type: "reminder", source_id: "reminder-1", workspace_id: "ws-1", title: "Follow up" }));
    expect(result.items[0]).not.toHaveProperty("user_id");
  });

  it("propagates the bounded cancellation signal to reminder reads", async () => {
    let receivedSignal: AbortSignal | undefined;
    const listReminderPage = vi.fn(async (_actor: unknown, _query: unknown, signal?: AbortSignal) => {
      receivedSignal = signal;
      return { items: [reminder()], next_cursor: null };
    });
    const tools = createTools({ knowledge: { listReminderPage } });
    const externalSignal = new AbortController().signal;

    await tools.execute("list_reminders", {}, context({ selectedNoteIds: [], selectedDatabaseIds: [] }), externalSignal);

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal).not.toBe(externalSignal);
  });

  it("propagates cancellation and converts a slow read into a bounded timeout", async () => {
    const controller = new AbortController();
    const tools = createTools({
      deadlineMs: 5,
      notes: {
        get: vi.fn(async () => new Promise(() => undefined)),
        list: vi.fn(),
      },
    });
    const pending = tools.execute("get_note", { note_id: "note-1" }, context(), controller.signal);
    await expect(pending).rejects.toMatchObject({ code: "AI_READ_TIMEOUT", status: 504 });

    const aborted = createTools({ notes: { get: vi.fn(async () => new Promise(() => undefined)), list: vi.fn() } });
    const request = aborted.execute("get_note", { note_id: "note-1" }, context(), controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails closed for primitive tool arguments instead of applying default searches", async () => {
    const tools = createTools();
    await expect(tools.execute("search_notes", "search everything", context(), new AbortController().signal))
      .rejects.toMatchObject({ code: "AI_READ_INPUT_INVALID", status: 400 });
  });

  it("rejects cursors that are malformed or outside the selected database scope", async () => {
    const tools = createTools();
    await expect(tools.execute("search_databases", { query: "launch", cursor: "not-a-cursor" }, context(), new AbortController().signal))
      .rejects.toMatchObject({ code: "AI_READ_CURSOR_INVALID", status: 400 });
    const foreignCursor = encodeURIComponent(JSON.stringify({ database_id: "db-2", cursor: "cursor-1" }));
    await expect(tools.execute("search_databases", { query: "launch", cursor: foreignCursor }, context(), new AbortController().signal))
      .rejects.toMatchObject({ code: "AI_READ_TARGET_NOT_SELECTED", status: 403 });
  });

  it("maps an invalid workspace note cursor to a non-retryable client error", async () => {
    const tools = createTools({
      notes: {
        get: vi.fn(),
        list: vi.fn(async () => { throw new Error("INVALID_NOTE_CURSOR"); }),
      },
    });
    await expect(tools.execute("search_notes", { query: "plan", cursor: "bad" }, context({ selectedNoteIds: [], allowWorkspaceSearch: true }), new AbortController().signal))
      .rejects.toMatchObject({ code: "AI_READ_CURSOR_INVALID", status: 400, retryable: false });
  });

  it("defensively removes values for properties hidden from the supplied database bundle", async () => {
    const tools = new AiReadTools({
      notes: { get: vi.fn(), list: vi.fn() },
      knowledge: { listReminderPage: vi.fn() },
      databases: {
        listDatabases: vi.fn(async () => []),
        getDatabase: vi.fn(async () => ({
          database: { id: "db-1", workspace_id: "ws-1", name: "Projects", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now },
          role: "viewer" as const,
          properties: [{ id: "title", workspace_id: "ws-1", database_id: "db-1", name: "Title", type: "text" as const, config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now }],
          views: [], templates: [],
        })),
        searchRecords: vi.fn(),
        getRecord: vi.fn(async () => ({
          id: "record-1", workspace_id: "ws-1", database_id: "db-1", note_id: null,
          values: { title: "Visible", secret: "Should not escape" }, created_by: "user-1", updated_by: "user-1",
          revision: 1, created_at: now, updated_at: now,
        })),
      },
    });
    const result = await tools.execute("get_database_record", { database_id: "db-1", record_id: "record-1" }, context(), new AbortController().signal);
    expect(result.items[0]?.values).toEqual({ title: "Visible" });
  });

  it("stops scheduling selected-note reads after cancellation", async () => {
    const controller = new AbortController();
    let resolveFirst!: (value: ReturnType<typeof note>) => void;
    const get = vi.fn(async (_actor: unknown, id: string, signal?: AbortSignal) => {
      expect(signal).toBeDefined();
      if (id === "note-1") return new Promise<ReturnType<typeof note>>((resolve) => { resolveFirst = resolve; });
      return note({ id });
    });
    const tools = createTools({ notes: { get, list: vi.fn() } });
    const request = tools.execute("search_notes", { query: "", limit: 20 }, context({ selectedNoteIds: ["note-1", "note-2"] }), controller.signal);
    controller.abort(new DOMException("Cancelled", "AbortError"));
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    resolveFirst(note());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(get).toHaveBeenCalledTimes(1);
  });
});
