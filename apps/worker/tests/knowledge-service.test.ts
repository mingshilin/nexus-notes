import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src")) as WorkerExports;
}

const context = { workspaceId: "ws-1", userId: "user-1", role: "viewer", capabilities: new Set<string>() };

describe("KnowledgeService", () => {
  it("forces search and saved-search operations into the caller context", async () => {
    const worker = await loadWorker();
    expect(worker.KnowledgeService).toBeTypeOf("function");
    const repository = {
      search: vi.fn(async () => ({ items: [], nextCursor: "next-1" })),
      listSavedSearches: vi.fn(async () => []),
      createSavedSearch: vi.fn(async (input) => ({ id: "saved-1", ...input })),
      deleteSavedSearch: vi.fn(async () => undefined),
    };
    const Service = worker.KnowledgeService as new (...args: any[]) => any;
    const service = new Service(repository, { clock: () => new Date("2026-08-21T00:00:00.000Z") });
    const search = { query: "Alpha", filters: {}, limit: 25 };
    const saved = { name: "Research", query: "Alpha", filters: {} };

    await expect(service.search(context, search)).resolves.toEqual({ items: [], next_cursor: "next-1" });
    await service.listSavedSearches(context);
    await service.createSavedSearch(context, saved);
    await service.deleteSavedSearch(context, "saved-1");

    expect(repository.search).toHaveBeenCalledWith("ws-1", search);
    expect(repository.listSavedSearches).toHaveBeenCalledWith("ws-1", "user-1");
    expect(repository.createSavedSearch).toHaveBeenCalledWith({
      workspaceId: "ws-1", userId: "user-1", input: saved, now: "2026-08-21T00:00:00.000Z",
    });
    expect(repository.deleteSavedSearch).toHaveBeenCalledWith("ws-1", "user-1", "saved-1");
  });

  it("scopes taxonomy, graph, and reminder actions and preserves reminder conflicts", async () => {
    const worker = await loadWorker();
    const serverReminder = { id: "reminder-1", revision: 2 };
    const repository = {
      listFolders: vi.fn(async () => []), createFolder: vi.fn(async () => ({ id: "folder-1" })),
      listTags: vi.fn(async () => []), createTag: vi.fn(async () => ({ id: "tag-1" })),
      setNoteTags: vi.fn(async () => undefined), setNoteLinks: vi.fn(async () => undefined),
      listNoteLinks: vi.fn(async () => []), listBacklinks: vi.fn(async () => []),
      getGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
      listReminders: vi.fn(async () => []), createReminder: vi.fn(async () => ({ id: "reminder-1" })),
      updateReminder: vi.fn(async () => ({ reminder: null, current: serverReminder })),
      listReminderPage: vi.fn(async () => ({ items: [], nextCursor: "cursor-2" })),
      snoozeReminder: vi.fn(async () => ({ reminder: { id: "reminder-1", revision: 3 }, current: null })),
      deleteReminder: vi.fn(async () => true),
    };
    const Service = worker.KnowledgeService as new (...args: any[]) => any;
    const service = new Service(repository, { clock: () => new Date("2026-08-21T00:00:00.000Z") });

    await service.listFolders(context);
    await service.createFolder(context, { name: "Projects" });
    await service.listTags(context);
    await service.createTag(context, { name: "research", color: "" });
    await service.setNoteTags(context, "note-1", { tag_ids: ["tag-1"] });
    await service.setNoteLinks(context, "note-1", { target_note_ids: ["note-2"] });
    await service.listNoteLinks(context, "note-1");
    await service.listBacklinks(context, "note-1");
    await service.getGraph(context, "note-1");
    await service.listReminders(context, true);
    await service.createReminder(context, { note_id: "note-1", remind_at: "2026-08-22T00:00:00.000Z" });

    expect(repository.setNoteTags).toHaveBeenCalledWith("ws-1", "note-1", ["tag-1"], "2026-08-21T00:00:00.000Z");
    expect(repository.getGraph).toHaveBeenCalledWith("ws-1", "note-1");
    expect(repository.listReminders).toHaveBeenCalledWith("ws-1", "user-1", true);
    await expect(service.listReminderPage(context, { status: "overdue", limit: 25 })).resolves.toEqual({
      items: [], next_cursor: "cursor-2",
    });
    await expect(service.snoozeReminder(context, "reminder-1", { base_revision: 2, minutes: 60 })).resolves.toEqual({
      id: "reminder-1", revision: 3,
    });
    await expect(service.deleteReminder(context, "reminder-1", { base_revision: 3 })).resolves.toBeUndefined();
    await expect(service.updateReminder(context, "reminder-1", {
      base_revision: 1, status: "dismissed",
    })).rejects.toMatchObject({
      code: "REMINDER_CONFLICT", status: 409,
      details: { server_reminder: serverReminder, submitted: { base_revision: 1, status: "dismissed" } },
    });
  });

  it("does not report invalid folder parents or reminder notes as created", async () => {
    const worker = await loadWorker();
    const Service = worker.KnowledgeService as new (...args: any[]) => any;
    const service = new Service({
      createFolder: vi.fn(async () => null),
      createReminder: vi.fn(async () => null),
    }, { clock: () => new Date("2026-08-21T00:00:00.000Z") });

    await expect(service.createFolder(context, {
      name: "Child", parent_id: "foreign-parent",
    })).rejects.toMatchObject({ code: "FOLDER_PARENT_NOT_FOUND", status: 404 });
    await expect(service.createReminder(context, {
      note_id: "foreign-note", remind_at: "2026-08-22T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "REMINDER_NOTE_NOT_FOUND", status: 404 });
  });

  it("scopes calendar feed reads to the workspace and requested date range", async () => {
    const worker = await loadWorker();
    const repository = {
      getCalendarFeed: vi.fn(async () => ({ items: [] })),
    };
    const Service = worker.KnowledgeService as new (...args: any[]) => any;
    const service = new Service(repository);

    await expect(service.getCalendarFeed(context, { from: "2026-08-01", to: "2026-08-31" })).resolves.toEqual({ items: [] });
    expect(repository.getCalendarFeed).toHaveBeenCalledWith(context, {
      from: "2026-08-01", to: "2026-08-31",
    });
  });
});
