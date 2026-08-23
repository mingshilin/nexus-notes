import { afterEach, describe, expect, it, vi } from "vitest";

type DataExports = Record<string, any>;

async function loadData() {
  return (await import("../src/data")) as DataExports;
}

const note = {
  id: "note-1",
  workspace_id: "ws-1",
  folder_id: null,
  database_id: null,
  created_by: "user-1",
  updated_by: "user-1",
  title: "Draft",
  content: "Body",
  status: "active",
  is_favorite: false,
  is_pinned: false,
  daily_date: null,
  revision: 1,
  created_at: "2026-08-21T00:00:00.000Z",
  updated_at: "2026-08-21T00:00:00.000Z",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("NotesClient", () => {
  it("opens or creates a daily note as a non-retryable idempotent command", async () => {
    const data = await loadData();
    const api = { request: vi.fn(async () => ({ note: { ...note, daily_date: "2026-08-23" } })) };
    const client = new data.NotesClient(api, "ws-1", { createId: () => "daily-operation-1" });

    await expect(client.openOrCreateDaily("2026-08-23")).resolves.toMatchObject({ daily_date: "2026-08-23" });

    expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/notes/daily",
      method: "POST",
      body: { daily_date: "2026-08-23" },
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "command",
      policy: expect.objectContaining({ retry: 0, idempotencyKey: "daily-operation-1" }),
    }));
  });

  it("adds workspace context and cancellable dedupe policy to list requests", async () => {
    const data = await loadData();
    expect(data.NotesClient).toBeTypeOf("function");
    const api = { request: vi.fn(async () => ({ items: [note], next_cursor: null })) };
    const client = new data.NotesClient(api, "ws-1");
    const controller = new AbortController();

    await expect(client.list({ cursor: "cursor-1", limit: 25, signal: controller.signal })).resolves.toMatchObject({
      items: [note],
      next_cursor: null,
    });

    expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/notes?cursor=cursor-1&limit=25",
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: expect.objectContaining({ retry: 2, dedupeKey: "notes:ws-1:cursor-1:25", signal: controller.signal }),
    }));
  });

  it("encodes inbox, daily, and trash filters in the list query", async () => {
    const data = await loadData();
    const api = { request: vi.fn(async () => ({ items: [], next_cursor: null })) };
    const client = new data.NotesClient(api, "ws-1");

    await client.list({ status: "active", folderId: null, dailyDate: "2026-08-23", limit: 20 });

    expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/notes?status=active&folder_id=none&daily_date=2026-08-23&limit=20",
      policy: expect.objectContaining({ dedupeKey: "notes:ws-1:first:20:active:none:2026-08-23" }),
    }));
  });

  it("sends revision-aware autosaves as idempotent commands", async () => {
    const data = await loadData();
    const api = { request: vi.fn(async () => ({ note: { ...note, revision: 2 } })) };
    const client = new data.NotesClient(api, "ws-1", { createId: () => "operation-1" });

    await client.update("note-1", { base_revision: 1, title: "Updated", source: "autosave" });

    expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/notes/note-1",
      method: "PATCH",
      body: { base_revision: 1, title: "Updated", source: "autosave" },
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "command",
      policy: expect.objectContaining({ retry: 0, idempotencyKey: "operation-1" }),
    }));
  });

  it("sends permanent deletion as a non-retryable DELETE command", async () => {
    const data = await loadData();
    const api = { request: vi.fn(async () => ({ deleted: true })) };
    const client = new data.NotesClient(api, "ws-1", { createId: () => "delete-operation-1" });

    await expect(client.deletePermanently("note-1", { base_revision: 2 })).resolves.toEqual({ deleted: true });

    expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/notes/note-1",
      method: "DELETE",
      body: { base_revision: 2 },
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "command",
      policy: expect.objectContaining({ retry: 0, idempotencyKey: "delete-operation-1" }),
    }));
  });

  it("accepts an explicit idempotency key for retried create and update commands", async () => {
    const data = await loadData();
    const api = { request: vi.fn(async () => ({ note: { ...note, revision: 2 } })) };
    const client = new data.NotesClient(api, "ws-1");

    await client.create({ title: "Draft", content: "Body" }, { idempotencyKey: "draft-local-1" });
    await client.update("note-1", { base_revision: 1, title: "Latest", source: "manual" }, { idempotencyKey: "draft-local-1:update:1" });

    expect(api.request.mock.calls.map(([options]) => options.policy.idempotencyKey)).toEqual([
      "draft-local-1",
      "draft-local-1:update:1",
    ]);
  });

  it("maps create, detail, capture, revision, and restore endpoints", async () => {
    const data = await loadData();
    const api = {
      request: vi.fn(async (options: { path: string }) => options.path.endsWith("/revisions")
        ? { items: [] }
        : { note }),
    };
    const client = new data.NotesClient(api, "ws-1", { createId: () => "operation-1" });

    await client.create({ title: "Draft", content: "Body" });
    await client.get("note-1");
    await client.quickCapture({ content: "Quick thought" });
    await client.listRevisions("note-1");
    await client.restore("note-1", 1, { base_revision: 1 });

    expect(api.request.mock.calls.map(([options]) => [options.path, options.method ?? "GET"])).toEqual([
      ["/api/v2/notes", "POST"],
      ["/api/v2/notes/note-1", "GET"],
      ["/api/v2/capture", "POST"],
      ["/api/v2/notes/note-1/revisions", "GET"],
      ["/api/v2/notes/note-1/revisions/1/restore", "POST"],
    ]);
    expect(api.request.mock.calls.every(([options]) => options.headers["x-workspace-id"] === "ws-1")).toBe(true);
  });
});

describe("NoteAutosaveController", () => {
  it("saves only the latest draft after 800 milliseconds", async () => {
    vi.useFakeTimers();
    const data = await loadData();
    expect(data.NoteAutosaveController).toBeTypeOf("function");
    const client = { update: vi.fn(async () => ({ ...note, revision: 2 })) };
    const onSaved = vi.fn();
    const autosave = new data.NoteAutosaveController(client, { onSaved });

    autosave.schedule("note-1", { base_revision: 1, title: "First", source: "autosave" });
    await vi.advanceTimersByTimeAsync(400);
    autosave.schedule("note-1", { base_revision: 1, title: "Latest", source: "autosave" });
    await vi.advanceTimersByTimeAsync(799);
    expect(client.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(client.update).toHaveBeenCalledOnce();
    expect(client.update).toHaveBeenCalledWith("note-1", {
      base_revision: 1,
      title: "Latest",
      source: "autosave",
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
  });

  it("preserves both server and submitted content when autosave conflicts", async () => {
    vi.useFakeTimers();
    const data = await loadData();
    const submitted = { base_revision: 1, content: "Local body", source: "autosave" };
    const conflict = new data.ApiClientError({
      code: "NOTE_CONFLICT",
      message: "Conflict",
      retryable: false,
      details: { server_note: { ...note, content: "Server body", revision: 2 }, submitted },
    }, 409);
    const client = { update: vi.fn(async () => { throw conflict; }) };
    const onConflict = vi.fn();
    const onError = vi.fn();
    const autosave = new data.NoteAutosaveController(client, { onConflict, onError });

    autosave.schedule("note-1", submitted);
    await vi.advanceTimersByTimeAsync(800);

    expect(onConflict).toHaveBeenCalledWith({
      serverNote: expect.objectContaining({ content: "Server body", revision: 2 }),
      submitted,
    });
    expect(onError).not.toHaveBeenCalled();
  });
});
