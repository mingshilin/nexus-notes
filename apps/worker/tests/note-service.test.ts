import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

const serverNote = {
  id: "note-1",
  workspace_id: "ws-1",
  folder_id: null,
  database_id: null,
  created_by: "user-1",
  updated_by: "user-2",
  title: "Server title",
  content: "Server body",
  status: "active",
  is_favorite: false,
  is_pinned: false,
  daily_date: null,
  revision: 3,
  created_at: "2026-08-21T00:00:00.000Z",
  updated_at: "2026-08-21T00:02:00.000Z",
};

function createRepository(overrides: Record<string, unknown> = {}) {
  return {
    createNote: vi.fn(async (input) => ({ ...serverNote, ...input, revision: 1 })),
    getNote: vi.fn(async () => serverNote),
    listNotes: vi.fn(async () => ({ items: [serverNote], nextCursor: null })),
    updateNote: vi.fn(async () => ({ note: { ...serverNote, revision: 4 }, current: null })),
    listRevisions: vi.fn(async () => []),
    restoreRevision: vi.fn(async () => ({ note: { ...serverNote, revision: 4 }, current: null, revisionFound: true })),
    deletePermanently: vi.fn(async () => ({ deleted: true, state: "deleted" })),
    ...overrides,
  };
}

describe("NoteService", () => {
  it("creates tenant-scoped notes and derives readable quick-capture titles", async () => {
    const worker = await loadWorker();
    expect(worker.NoteService).toBeTypeOf("function");
    const repository = createRepository();
    const Service = worker.NoteService as new (...args: any[]) => any;
    const service = new Service(repository, {
      createId: () => "new-note",
      clock: () => new Date("2026-08-21T00:00:00.000Z"),
    });

    await service.create(
      { workspaceId: "ws-1", userId: "user-1" },
      { title: "Draft", content: "Body" },
    );
    await service.quickCapture(
      { workspaceId: "ws-1", userId: "user-1" },
      { content: "  First useful line  \nMore context" },
    );

    expect(repository.createNote).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: "new-note",
      workspaceId: "ws-1",
      userId: "user-1",
      title: "Draft",
      content: "Body",
      source: "manual",
    }));
    expect(repository.createNote).toHaveBeenNthCalledWith(2, expect.objectContaining({
      title: "First useful line",
      content: "  First useful line  \nMore context",
      source: "manual",
    }));
  });

  it("returns both server and submitted revisions when an update conflicts", async () => {
    const worker = await loadWorker();
    const repository = createRepository({
      updateNote: vi.fn(async () => ({ note: null, current: serverNote })),
    });
    const Service = worker.NoteService as new (...args: any[]) => any;
    const service = new Service(repository);

    await expect(service.update(
      { workspaceId: "ws-1", userId: "user-1" },
      "note-1",
      { base_revision: 2, title: "Local title", source: "autosave" },
    )).rejects.toMatchObject({
      code: "NOTE_CONFLICT",
      status: 409,
      retryable: false,
      details: {
        server_note: serverNote,
        submitted: { base_revision: 2, title: "Local title", source: "autosave" },
      },
    });
  });

  it("restores a snapshot only when the caller still owns the current revision", async () => {
    const worker = await loadWorker();
    const repository = createRepository({
      restoreRevision: vi.fn(async () => ({ note: null, current: serverNote, revisionFound: true })),
    });
    const Service = worker.NoteService as new (...args: any[]) => any;
    const service = new Service(repository);

    await expect(service.restore(
      { workspaceId: "ws-1", userId: "user-1" },
      "note-1",
      1,
      { base_revision: 2 },
    )).rejects.toMatchObject({
      code: "NOTE_CONFLICT",
      details: { server_note: serverNote, submitted_revision: 2, restore_revision: 1 },
    });
  });

  it("scopes note and revision reads to the caller workspace", async () => {
    const worker = await loadWorker();
    const repository = createRepository();
    const Service = worker.NoteService as new (...args: any[]) => any;
    const service = new Service(repository);
    const context = { workspaceId: "ws-1", userId: "user-1" };

    await expect(service.list(context, { cursor: "cursor-1", limit: 25 })).resolves.toMatchObject({
      items: [serverNote],
      next_cursor: null,
    });
    await expect(service.get(context, "note-1")).resolves.toEqual(serverNote);
    await expect(service.listRevisions(context, "note-1")).resolves.toEqual([]);

    expect(repository.listNotes).toHaveBeenCalledWith({ workspaceId: "ws-1", cursor: "cursor-1", limit: 25 });
    expect(repository.getNote).toHaveBeenCalledWith("ws-1", "note-1");
    expect(repository.listRevisions).toHaveBeenCalledWith("ws-1", "note-1");
  });

  it("returns a trusted 404 when a tenant-scoped note is missing", async () => {
    const worker = await loadWorker();
    const repository = createRepository({ getNote: vi.fn(async () => null) });
    const Service = worker.NoteService as new (...args: any[]) => any;
    const service = new Service(repository);

    await expect(service.get(
      { workspaceId: "ws-1", userId: "user-1" },
      "missing-note",
    )).rejects.toMatchObject({ code: "NOTE_NOT_FOUND", status: 404, retryable: false });
  });

  it("distinguishes missing notes and revisions from update conflicts", async () => {
    const worker = await loadWorker();
    const Service = worker.NoteService as new (...args: any[]) => any;
    const context = { workspaceId: "ws-1", userId: "user-1" };
    const missingNote = new Service(createRepository({
      updateNote: vi.fn(async () => ({ note: null, current: null })),
    }));
    const missingRevision = new Service(createRepository({
      restoreRevision: vi.fn(async () => ({ note: null, current: serverNote, revisionFound: false })),
    }));

    await expect(missingNote.update(context, "missing-note", {
      base_revision: 1,
      title: "Local",
      source: "autosave",
    })).rejects.toMatchObject({ code: "NOTE_NOT_FOUND", status: 404 });
    await expect(missingRevision.restore(context, "note-1", 99, {
      base_revision: 3,
    })).rejects.toMatchObject({ code: "NOTE_REVISION_NOT_FOUND", status: 404 });
  });

  it("classifies permanent deletion outcomes without exposing cross-workspace notes", async () => {
    const worker = await loadWorker();
    const Service = worker.NoteService as new (...args: any[]) => any;
    const context = { workspaceId: "ws-1", userId: "user-1" };

    for (const [state, expected] of [
      ["not_found", { code: "NOTE_NOT_FOUND", status: 404 }],
      ["not_trashed", { code: "NOTE_NOT_TRASHED", status: 409 }],
      ["conflict", { code: "NOTE_CONFLICT", status: 409 }],
    ] as const) {
      const repository = createRepository({ deletePermanently: vi.fn(async () => ({ deleted: false, state })) });
      const service = new Service(repository);
      await expect(service.deletePermanently(context, "note-1", { base_revision: 2 })).rejects.toMatchObject(expected);
    }

    const repository = createRepository();
    const service = new Service(repository, { clock: () => new Date("2026-08-21T00:00:00.000Z") });
    await expect(service.deletePermanently(context, "note-1", { base_revision: 2 })).resolves.toEqual({ deleted: true });
    expect(repository.deletePermanently).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "ws-1", userId: "user-1", noteId: "note-1", baseRevision: 2,
    }));
  });
});
