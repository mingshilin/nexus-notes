import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "@nexus/contracts";

import { AiReadToolError, AiReadTools, type AiReadExecutionContext } from "../src/ai/ai-read-tools";
import { D1DatabaseRepository } from "../src/databases/d1-database-repository";
import { cursorFingerprint, encodeRecordCursor } from "../src/databases/database-model";
import { D1ReminderRepository } from "../src/knowledge/d1-reminder-repository";
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
      listDatabasePage: vi.fn(async () => ({ items: [{ id: "db-1", workspace_id: "ws-1", name: "Projects", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now }], next_cursor: null })),
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
    const result = await tools.execute("search_notes", { query: "plan", limit: 50 }, context(), new AbortController().signal);

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
    const result = await tools.execute("search_notes", { query: "plan", limit: 50 }, context({ selectedNoteIds: [], allowWorkspaceSearch: true }), new AbortController().signal);
    expect(notes.list).toHaveBeenCalledOnce();
    expect(result.next_cursor).toEqual(expect.any(String));
    expect(result.next_cursor).not.toBe("next");
    expect(result.scope).toEqual(expect.objectContaining({ selected_only: false }));
  });

  it("binds workspace note cursors to the query before forwarding them", async () => {
    const list = vi.fn(async (_actor: unknown, options: { cursor?: string }) => ({
      items: [note()],
      next_cursor: options.cursor ? null : "raw-note-cursor",
    }));
    const tools = createTools({ notes: { get: vi.fn(), list } });
    const readContext = context({ selectedNoteIds: [], allowWorkspaceSearch: true });

    const first = await tools.execute("search_notes", { query: "plan", limit: 1 }, readContext, new AbortController().signal);
    expect(first.next_cursor).toEqual(expect.any(String));
    await expect(tools.execute("search_notes", { query: "other", limit: 1, cursor: first.next_cursor! }, readContext, new AbortController().signal))
      .rejects.toMatchObject({ code: "AI_READ_CURSOR_INVALID", status: 400 });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("returns a bounded continuation for a large workspace note page", async () => {
    const notes = Array.from({ length: 50 }, (_, index) => note({
      id: `note-${index + 1}-${"i".repeat(108)}`,
      title: `Plan ${index + 1} ${"t".repeat(150)}`,
      content: "x".repeat(1_000),
      updated_at: `2026-08-28T00:${String(index).padStart(2, "0")}:00.000Z`,
    }));
    const list = vi.fn(async (_actor: unknown, options: { cursor?: string }) => {
      const start = options.cursor
        ? notes.findIndex((candidate) => decodeURIComponent(options.cursor!).split("\n").at(-1) === candidate.id)
        : -1;
      return { items: notes.slice(start + 1), next_cursor: null };
    });
    const tools = createTools({ maxResults: 50, notes: { get: vi.fn(), list } });
    const readContext = context({ selectedNoteIds: [], allowWorkspaceSearch: true });

    const first = await tools.execute("search_notes", { query: "plan", limit: 50 }, readContext, new AbortController().signal);
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.items.length).toBeLessThan(notes.length);
    expect(first.next_cursor).toEqual(expect.any(String));
    const second = await tools.execute("search_notes", { query: "plan", limit: 50, cursor: first.next_cursor! }, readContext, new AbortController().signal);
    expect(second.items.length).toBeGreaterThan(0);
    expect(new Set([...first.items, ...second.items].map((item) => item.source_id)).size).toBeGreaterThan(first.items.length);
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

  it("rejects a selected-note cursor reused by another user or workspace", async () => {
    const tools = createTools({ notes: {
      get: vi.fn(async (_actor: unknown, id: string) => note({ id })),
      list: vi.fn(),
    } });
    const selected = context({ selectedNoteIds: ["note-1", "note-2"] });
    const first = await tools.execute("search_notes", { query: "plan", limit: 1 }, selected, new AbortController().signal);

    await expect(tools.execute(
      "search_notes",
      { query: "plan", limit: 1, cursor: first.next_cursor! },
      { ...selected, userId: "user-2" },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "AI_READ_CURSOR_INVALID", status: 400 });
    await expect(tools.execute(
      "search_notes",
      { query: "plan", limit: 1, cursor: first.next_cursor! },
      { ...selected, workspaceId: "ws-2" },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "AI_READ_CURSOR_INVALID", status: 400 });
  });

  it("keeps a continuation when selected-note results reach the byte budget", async () => {
    const selectedNoteIds = Array.from({ length: 50 }, (_, index) => `note-${index + 1}-${"i".repeat(108)}`);
    const get = vi.fn(async (_actor: unknown, id: string) => note({ id, title: `${id}-${"t".repeat(160)}`, content: "x".repeat(1_000) }));
    const tools = createTools({ maxResults: 50, notes: { get, list: vi.fn() } });
    const readContext = context({ selectedNoteIds });
    const seen = new Set<string>();
    let cursor: string | null | undefined;
    let pageCount = 0;

    for (let page = 0; page < 4; page += 1) {
      const result = await tools.execute("search_notes", { query: "", limit: 50, ...(cursor ? { cursor } : {}) }, readContext, new AbortController().signal);
      pageCount += 1;
      result.items.forEach((item) => seen.add(item.source_id));
      cursor = result.next_cursor;
      if (!cursor) break;
    }

    expect(seen).toEqual(new Set(selectedNoteIds));
    expect(pageCount).toBeGreaterThan(1);
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
        listDatabasePage: vi.fn(async () => ({ items: [], next_cursor: null })),
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
    const result = await tools.execute("list_reminders", { include_completed: true, limit: 50 }, context({ selectedNoteIds: [], selectedDatabaseIds: [] }), new AbortController().signal);
    expect(result.items[0]).toEqual(expect.objectContaining({ source_type: "reminder", source_id: "reminder-1", workspace_id: "ws-1", title: "Follow up" }));
    expect(result.items[0]).not.toHaveProperty("user_id");
  });

  it("binds reminder cursors to the workspace, user, status, and query", async () => {
    const listReminderPage = vi.fn(async (_actor: unknown, query: { cursor?: string }) => ({
      items: [reminder()],
      next_cursor: query.cursor ? null : "raw-reminder-cursor",
    }));
    const tools = createTools({ knowledge: { listReminderPage } });
    const readContext = context({ selectedNoteIds: [], selectedDatabaseIds: [] });

    const first = await tools.execute("list_reminders", { query: "follow", limit: 1 }, readContext, new AbortController().signal);
    expect(first.next_cursor).toEqual(expect.any(String));
    await expect(tools.execute("list_reminders", { query: "different", limit: 1, cursor: first.next_cursor! }, readContext, new AbortController().signal))
      .rejects.toMatchObject({ code: "AI_READ_CURSOR_INVALID", status: 400 });
    expect(listReminderPage).toHaveBeenCalledTimes(1);
  });

  it("rejects a reminder cursor reused by another user or workspace", async () => {
    const listReminderPage = vi.fn(async () => ({ items: [reminder()], next_cursor: "raw-reminder-cursor" }));
    const tools = createTools({ knowledge: { listReminderPage } });
    const readContext = context({ selectedNoteIds: [], selectedDatabaseIds: [] });
    const first = await tools.execute("list_reminders", { limit: 1 }, readContext, new AbortController().signal);

    await expect(tools.execute(
      "list_reminders",
      { limit: 1, cursor: first.next_cursor! },
      { ...readContext, userId: "user-2" },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "AI_READ_CURSOR_INVALID", status: 400 });
    await expect(tools.execute(
      "list_reminders",
      { limit: 1, cursor: first.next_cursor! },
      { ...readContext, workspaceId: "ws-2" },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "AI_READ_CURSOR_INVALID", status: 400 });
  });

  it("keeps a maximum workspace reminder page within the byte budget", async () => {
    const reminders = Array.from({ length: 50 }, (_, index) => reminder({
      id: `reminder-${index + 1}`,
      title: `Reminder ${index + 1} ${"x".repeat(1_200)}`,
      remind_at: `2026-08-${String((index % 28) + 1).padStart(2, "0")}T09:00:00.000Z`,
    }));
    const listReminderPage = vi.fn(async (_actor: unknown, query: { cursor?: string }) => ({
      items: reminders,
      next_cursor: query.cursor ? null : "repository-reminder-next",
    }));
    const tools = createTools({ maxResults: 50, knowledge: { listReminderPage } });
    const readContext = context({ selectedNoteIds: [], selectedDatabaseIds: [] });

    const first = await tools.execute("list_reminders", { limit: 50 }, readContext, new AbortController().signal);
    expect(first.items).toHaveLength(reminders.length);
    expect(new TextEncoder().encode(JSON.stringify(first)).byteLength).toBeLessThanOrEqual(64 * 1024);
    expect(first.next_cursor).toEqual(expect.any(String));
  });

  it("maps malformed reminder cursors to a stable AI read error", async () => {
    const test = await createTestD1();
    disposals.push(test.dispose);
    await seedTenants(test.db);
    const reminders = new D1ReminderRepository(test.db);
    const tools = createTools({
      knowledge: {
        listReminderPage: (actor: { workspaceId: string; userId: string }, query: Parameters<D1ReminderRepository["listReminderPage"]>[2], signal?: AbortSignal) => {
          signal?.throwIfAborted();
          return reminders.listReminderPage(actor.workspaceId, actor.userId, query, now);
        },
      },
    });

    await expect(tools.execute(
      "list_reminders",
      { cursor: "not-a-reminder-cursor" },
      context({ selectedNoteIds: [], selectedDatabaseIds: [] }),
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "AI_READ_CURSOR_INVALID", status: 400, retryable: false });
  });

  it("continues workspace database search across bounded database pages", async () => {
    const databases = [
      { id: "db-1", workspace_id: "ws-1", name: "First", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: "2026-08-28T00:02:00.000Z" },
      { id: "db-2", workspace_id: "ws-1", name: "Second", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: "2026-08-28T00:01:00.000Z" },
    ];
    const property = (databaseId: string) => ({ id: `${databaseId}-title`, workspace_id: "ws-1", database_id: databaseId, name: "Title", type: "text" as const, config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now });
    const listDatabasePage = vi.fn(async (_actor: unknown, options: { cursor?: string | null; limit: number }) => {
      expect(options.limit).toBe(1);
      return options.cursor ? { items: [databases[1]], next_cursor: null } : { items: [databases[0]], next_cursor: "after-db-1" };
    });
    const getDatabase = vi.fn(async (_actor: unknown, databaseId: string) => ({
      database: databases.find((database) => database.id === databaseId)!, role: "viewer" as const,
      properties: [property(databaseId)], views: [], templates: [],
    }));
    const searchRecords = vi.fn(async (_actor: unknown, databaseId: string, options: { limit: number; cursor?: string | null }) => {
      expect(options.limit).toBe(1);
      return { items: [{ id: `${databaseId}-record`, workspace_id: "ws-1", database_id: databaseId, note_id: null, values: { [`${databaseId}-title`]: "launch" }, created_by: "user-1", updated_by: "user-1", revision: 1, created_at: now, updated_at: now }], next_cursor: null };
    });
    const tools = createTools({ databases: {
      listDatabases: vi.fn(async () => { throw new Error("unbounded discovery must not be used"); }),
      listDatabasePage, getDatabase, searchRecords, getRecord: vi.fn(),
    } });
    const readContext = context({ selectedNoteIds: [], selectedDatabaseIds: [], allowWorkspaceSearch: true });

    const first = await tools.execute("search_databases", { query: "launch", limit: 1 }, readContext, new AbortController().signal);
    const second = await tools.execute("search_databases", { query: "launch", limit: 1, cursor: first.next_cursor }, readContext, new AbortController().signal);

    expect(first.items[0]?.source_id).toBe("db-1-record");
    expect(second.items[0]?.source_id).toBe("db-2-record");
    expect(listDatabasePage).toHaveBeenCalledTimes(2);
  });

  it("rejects workspace database cursors reused by another user", async () => {
    const databases = [{ id: "db-1", workspace_id: "ws-1", name: "First", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now }];
    const tools = createTools({ databases: {
      listDatabasePage: vi.fn(async () => ({ items: databases, next_cursor: "next-database" })),
      getDatabase: vi.fn(async () => ({ database: databases[0], role: "viewer" as const, properties: [], views: [], templates: [] })),
      searchRecords: vi.fn(async () => ({ items: [], next_cursor: null })),
      getRecord: vi.fn(),
    } });
    const selected = context({ selectedNoteIds: [], selectedDatabaseIds: [], allowWorkspaceSearch: true });
    const first = await tools.execute("search_databases", { query: "", limit: 1 }, selected, new AbortController().signal);
    expect(first.next_cursor).toEqual(expect.any(String));
    await expect(tools.execute(
      "search_databases",
      { query: "", limit: 1, cursor: first.next_cursor! },
      { ...selected, userId: "user-2" },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "AI_READ_CURSOR_INVALID", status: 400 });
  });

  it("migrates the earlier workspace database cursor without losing its record position", async () => {
    const databases = [
      { id: "db-1", workspace_id: "ws-1", name: "First", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: "2026-08-28T00:02:00.000Z" },
      { id: "db-2", workspace_id: "ws-1", name: "Second", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: "2026-08-28T00:01:00.000Z" },
    ];
    const listDatabasePage = vi.fn(async () => ({ items: [databases[1]], next_cursor: null }));
    const legacyRecordCursor = encodeRecordCursor(
      { updated_at: now, id: "record-1" },
      undefined,
      cursorFingerprint({ kind: "search", database_id: "db-1", query: "launch" }),
    );
    const searchRecords = vi.fn(async (_actor: unknown, databaseId: string, options: { cursor?: string | null }) => {
      if (databaseId === "db-1") expect(options.cursor).toBe(legacyRecordCursor);
      return { items: [{ id: `${databaseId}-record`, workspace_id: "ws-1", database_id: databaseId, note_id: null, values: { title: "launch" }, created_by: "user-1", updated_by: "user-1", revision: 1, created_at: now, updated_at: now }], next_cursor: null };
    });
    const tools = createTools({ databases: {
      listDatabasePage,
      getDatabase: vi.fn(async (_actor: unknown, databaseId: string) => ({
        database: databases.find((database) => database.id === databaseId)!, role: "viewer" as const,
        properties: [{ id: "title", workspace_id: "ws-1", database_id: databaseId, name: "Title", type: "text" as const, config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now }],
        views: [], templates: [],
      })),
      searchRecords,
      getRecord: vi.fn(),
    } });
    const readContext = context({ selectedNoteIds: [], selectedDatabaseIds: [], allowWorkspaceSearch: true });
    const legacyCursor = encodeURIComponent(JSON.stringify({ database_id: "db-1", cursor: legacyRecordCursor }));

    const first = await tools.execute("search_databases", { query: "launch", limit: 1, cursor: legacyCursor }, readContext, new AbortController().signal);
    expect(first.items[0]?.source_id).toBe("db-1-record");
    expect(first.next_cursor).toEqual(expect.any(String));
    const second = await tools.execute("search_databases", { query: "launch", limit: 1, cursor: first.next_cursor! }, readContext, new AbortController().signal);
    expect(second.items[0]?.source_id).toBe("db-2-record");
    expect(listDatabasePage).toHaveBeenCalledOnce();
  });

  it("fails closed when a legacy workspace cursor targets an inaccessible database", async () => {
    const legacyRecordCursor = encodeRecordCursor(
      { updated_at: now, id: "record-1" },
      undefined,
      cursorFingerprint({ kind: "search", database_id: "db-1", query: "launch" }),
    );
    const tools = createTools({ databases: {
      listDatabasePage: vi.fn(),
      getDatabase: vi.fn(async () => { throw Object.assign(new Error("DATABASE_NOT_FOUND"), { code: "DATABASE_NOT_FOUND", status: 404 }); }),
      searchRecords: vi.fn(),
      getRecord: vi.fn(),
    } });
    const legacyCursor = encodeURIComponent(JSON.stringify({ database_id: "db-1", cursor: legacyRecordCursor }));

    await expect(tools.execute(
      "search_databases",
      { query: "launch", limit: 1, cursor: legacyCursor },
      context({ selectedNoteIds: [], selectedDatabaseIds: [], allowWorkspaceSearch: true }),
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "AI_READ_CURSOR_INVALID", status: 400 });
  });

  it("keeps a compound workspace cursor within the shared contract limit", async () => {
    const databaseId = `db-${"d".repeat(125)}`;
    const recordId = `record-${"r".repeat(121)}`;
    const tools = createTools({ databases: {
      listDatabasePage: vi.fn(async () => ({ items: [{ id: databaseId, workspace_id: "ws-1", name: "Records", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now }], next_cursor: "d".repeat(900) })),
      getDatabase: vi.fn(async () => ({
        database: { id: databaseId, workspace_id: "ws-1", name: "Records", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now },
        role: "viewer" as const,
        properties: [{ id: "title", workspace_id: "ws-1", database_id: databaseId, name: "Title", type: "text" as const, config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now }],
        views: [], templates: [],
      })),
      searchRecords: vi.fn(async () => ({ items: [{ id: recordId, workspace_id: "ws-1", database_id: databaseId, note_id: null, values: { title: "launch" }, created_by: "user-1", updated_by: "user-1", revision: 1, created_at: now, updated_at: now }], next_cursor: "r".repeat(900) })),
      getRecord: vi.fn(),
    } });

    const read = await tools.execute(
      "search_databases",
      { query: "launch", limit: 1 },
      context({ selectedNoteIds: [], selectedDatabaseIds: [], allowWorkspaceSearch: true }),
      new AbortController().signal,
    );

    expect(read.next_cursor?.length).toBeGreaterThan(1_024);
    expect(read.next_cursor?.length).toBeLessThanOrEqual(4_096);
  });

  it("bounds workspace database discovery when a query has no matches", async () => {
    const databases = Array.from({ length: 55 }, (_, index) => ({
      id: `db-${index + 1}`, workspace_id: "ws-1", name: `Database ${index + 1}`, description: "",
      created_by: "user-1", revision: 1, created_at: now, updated_at: now,
    }));
    const listDatabasePage = vi.fn(async (_actor: unknown, options: { cursor?: string | null }) => {
      const index = options.cursor ? Number(options.cursor) : 0;
      return { items: [databases[index]], next_cursor: index + 1 < databases.length ? String(index + 1) : null };
    });
    const tools = createTools({ databases: {
      listDatabasePage,
      getDatabase: vi.fn(async (_actor: unknown, databaseId: string) => ({
        database: databases.find((database) => database.id === databaseId)!, role: "viewer" as const,
        properties: [{ id: "title", workspace_id: "ws-1", database_id: databaseId, name: "Title", type: "text" as const, config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now }],
        views: [], templates: [],
      })),
      searchRecords: vi.fn(async () => ({ items: [], next_cursor: null })),
      getRecord: vi.fn(),
    } });

    const result = await tools.execute(
      "search_databases",
      { query: "missing", limit: 20 },
      context({ selectedNoteIds: [], selectedDatabaseIds: [], allowWorkspaceSearch: true }),
      new AbortController().signal,
    );

    expect(result.items).toEqual([]);
    expect(result.next_cursor).toEqual(expect.any(String));
    expect(listDatabasePage.mock.calls.length).toBeLessThanOrEqual(50);
  });

  it("fails closed when workspace database pagination does not advance", async () => {
    const listDatabasePage = vi.fn(async () => ({ items: [], next_cursor: "stuck" }));
    const tools = createTools({ deadlineMs: 500, databases: {
      listDatabasePage,
      getDatabase: vi.fn(),
      searchRecords: vi.fn(),
      getRecord: vi.fn(),
    } });
    const startedAt = Date.now();

    await expect(tools.execute(
      "search_databases",
      { query: "missing", limit: 20 },
      context({ selectedNoteIds: [], selectedDatabaseIds: [], allowWorkspaceSearch: true }),
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "AI_READ_PAGING_STALLED", status: 503, retryable: true });

    expect(Date.now() - startedAt).toBeLessThan(400);
    expect(listDatabasePage).toHaveBeenCalledTimes(2);
  });

  it("rejects a legacy database cursor when its record query fingerprint differs", async () => {
    const recordCursor = encodeRecordCursor(
      { updated_at: now, id: "record-1" },
      undefined,
      cursorFingerprint({ kind: "search", database_id: "db-1", query: "launch" }),
    );
    const searchRecords = vi.fn(async () => ({ items: [], next_cursor: null }));
    const tools = createTools({ databases: {
      listDatabasePage: vi.fn(),
      getDatabase: vi.fn(async () => ({
        database: { id: "db-1", workspace_id: "ws-1", name: "Records", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now },
        role: "viewer" as const,
        properties: [{ id: "title", workspace_id: "ws-1", database_id: "db-1", name: "Title", type: "text" as const, config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now }],
        views: [], templates: [],
      })),
      searchRecords,
      getRecord: vi.fn(),
    } });
    const legacyCursor = encodeURIComponent(JSON.stringify({ database_id: "db-1", cursor: recordCursor }));

    await expect(tools.execute(
      "search_databases",
      { query: "different", limit: 1, cursor: legacyCursor },
      context({ selectedNoteIds: [], selectedDatabaseIds: [], allowWorkspaceSearch: true }),
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "AI_READ_CURSOR_INVALID", status: 400, retryable: false });
    expect(searchRecords).not.toHaveBeenCalled();
  });

  it("continues selected database search without losing later databases", async () => {
    const databases = [
      { id: "db-1", workspace_id: "ws-1", name: "First", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now },
      { id: "db-2", workspace_id: "ws-1", name: "Second", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now },
    ];
    const getDatabase = vi.fn(async (_actor: unknown, databaseId: string) => ({
      database: databases.find((database) => database.id === databaseId)!, role: "viewer" as const,
      properties: [{ id: "title", workspace_id: "ws-1", database_id: databaseId, name: "Title", type: "text" as const, config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now }],
      views: [], templates: [],
    }));
    const searchRecords = vi.fn(async (_actor: unknown, databaseId: string) => ({
      items: [{ id: `${databaseId}-record`, workspace_id: "ws-1", database_id: databaseId, note_id: null, values: { title: "launch" }, created_by: "user-1", updated_by: "user-1", revision: 1, created_at: now, updated_at: now }],
      next_cursor: null,
    }));
    const tools = createTools({ databases: { listDatabasePage: vi.fn(), getDatabase, searchRecords, getRecord: vi.fn() } });
    const readContext = context({ selectedDatabaseIds: ["db-1", "db-2"] });

    const first = await tools.execute("search_databases", { query: "launch", limit: 1 }, readContext, new AbortController().signal);
    expect(first.items[0]?.source_id).toBe("db-1-record");
    expect(first.next_cursor).toEqual(expect.any(String));
    const second = await tools.execute("search_databases", { query: "launch", limit: 1, cursor: first.next_cursor! }, readContext, new AbortController().signal);
    expect(second.items[0]?.source_id).toBe("db-2-record");
  });

  it("rejects selected database cursors reused by another user", async () => {
    const databases = [
      { id: "db-1", workspace_id: "ws-1", name: "First", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now },
      { id: "db-2", workspace_id: "ws-1", name: "Second", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now },
    ];
    const tools = createTools({ databases: {
      listDatabasePage: vi.fn(),
      getDatabase: vi.fn(async (_actor: unknown, databaseId: string) => ({
        database: databases.find((database) => database.id === databaseId)!,
        role: "viewer" as const,
        properties: [{ id: "title", workspace_id: "ws-1", database_id: databaseId, name: "Title", type: "text" as const, config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now }],
        views: [], templates: [],
      })),
      searchRecords: vi.fn(async (_actor: unknown, databaseId: string) => ({ items: [{ id: `${databaseId}-record`, workspace_id: "ws-1", database_id: databaseId, note_id: null, values: { title: "launch" }, created_by: "user-1", updated_by: "user-1", revision: 1, created_at: now, updated_at: now }], next_cursor: null })),
      getRecord: vi.fn(),
    } });
    const selected = context({ selectedDatabaseIds: ["db-1", "db-2"] });
    const first = await tools.execute("search_databases", { query: "launch", limit: 1 }, selected, new AbortController().signal);
    expect(first.next_cursor).toEqual(expect.any(String));
    await expect(tools.execute(
      "search_databases",
      { query: "launch", limit: 1, cursor: first.next_cursor! },
      { ...selected, userId: "user-2" },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "AI_READ_CURSOR_INVALID", status: 400 });
  });

  it("does not skip oversized records when returning a bounded continuation", async () => {
    const records = Array.from({ length: 8 }, (_, index) => ({
      id: `record-${index + 1}`, workspace_id: "ws-1", database_id: "db-1", note_id: null,
      values: { title: `${String(index + 1)}-${"x".repeat(15_000)}` }, created_by: "user-1", updated_by: "user-1",
      revision: 1, created_at: now, updated_at: now,
    }));
    const searchRecords = vi.fn(async (_actor: unknown, _databaseId: string, options: { limit: number; cursor?: string | null }) => {
      const start = options.cursor ? Number(String(options.cursor).replace("cursor-", "")) : 0;
      const page = records.slice(start, start + options.limit);
      return { items: page, next_cursor: start + page.length < records.length ? `cursor-${start + page.length}` : null };
    });
    const tools = createTools({ databases: {
      listDatabases: vi.fn(),
      listDatabasePage: vi.fn(async () => ({ items: [{ id: "db-1", workspace_id: "ws-1", name: "Records", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now }], next_cursor: null })),
      getDatabase: vi.fn(async () => ({
        database: { id: "db-1", workspace_id: "ws-1", name: "Records", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now },
        role: "viewer" as const,
        properties: [{ id: "title", workspace_id: "ws-1", database_id: "db-1", name: "Title", type: "text" as const, config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now }],
        views: [], templates: [],
      })),
      searchRecords, getRecord: vi.fn(),
    } });
    const readContext = context({ selectedNoteIds: [], selectedDatabaseIds: [], allowWorkspaceSearch: true });
    const seen = new Set<string>();
    let cursor: string | null | undefined;
    let pageCount = 0;
    for (let page = 0; page < 8; page += 1) {
      const result = await tools.execute("search_databases", { query: "x", limit: 50, ...(cursor ? { cursor } : {}) }, readContext, new AbortController().signal);
      pageCount += 1;
      result.items.forEach((item) => seen.add(item.source_id));
      cursor = result.next_cursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(new Set(records.map((record) => record.id)));
    expect(pageCount).toBeGreaterThan(1);
    expect(searchRecords.mock.calls.every((call) => call[2].limit === 1)).toBe(true);
  });

  it("returns oversized individual record values as a source-only item", async () => {
    const tools = createTools({ databases: {
      listDatabasePage: vi.fn(async () => ({ items: [{ id: "db-1", workspace_id: "ws-1", name: "Records", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now }], next_cursor: null })),
      getDatabase: vi.fn(async () => ({
        database: { id: "db-1", workspace_id: "ws-1", name: "Records", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now },
        role: "viewer" as const,
        properties: [{ id: "title", workspace_id: "ws-1", database_id: "db-1", name: "Title", type: "text" as const, config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now }],
        views: [], templates: [],
      })),
      searchRecords: vi.fn(async () => ({ items: [{
        id: "record-large", workspace_id: "ws-1", database_id: "db-1", note_id: null,
        values: { title: "x".repeat(20_000) }, created_by: "user-1", updated_by: "user-1",
        revision: 1, created_at: now, updated_at: now,
      }], next_cursor: null })),
      getRecord: vi.fn(),
    } });

    const read = await tools.execute(
      "search_databases",
      { query: "x", limit: 1 },
      context({ selectedNoteIds: [], selectedDatabaseIds: [], allowWorkspaceSearch: true }),
      new AbortController().signal,
    );

    expect(read.items[0]).toMatchObject({ source_type: "database_record", source_id: "record-large", values: {} });
  });

  it("fails closed when a database record cursor repeats", async () => {
    let calls = 0;
    const tools = createTools({ databases: {
      listDatabasePage: vi.fn(async () => ({ items: [{ id: "db-1", workspace_id: "ws-1", name: "Records", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now }], next_cursor: null })),
      getDatabase: vi.fn(async () => ({
        database: { id: "db-1", workspace_id: "ws-1", name: "Records", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now },
        role: "viewer" as const,
        properties: [{ id: "title", workspace_id: "ws-1", database_id: "db-1", name: "Title", type: "text" as const, config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now }],
        views: [], templates: [],
      })),
      searchRecords: vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? { items: [{ id: "record-1", workspace_id: "ws-1", database_id: "db-1", note_id: null, values: { title: "launch" }, created_by: "user-1", updated_by: "user-1", revision: 1, created_at: now, updated_at: now }], next_cursor: "stuck" }
          : { items: [], next_cursor: "stuck" };
      }),
      getRecord: vi.fn(),
    } });

    await expect(tools.execute(
      "search_databases",
      { query: "launch", limit: 2 },
      context({ selectedNoteIds: [], selectedDatabaseIds: [], allowWorkspaceSearch: true }),
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "AI_READ_PAGING_STALLED", status: 503, retryable: true });
    expect(calls).toBe(2);
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
        listDatabasePage: vi.fn(async () => ({ items: [], next_cursor: null })),
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
