import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

const workspace = {
  workspaceId: "ws-1",
  userId: "user-1",
  role: "editor",
  capabilities: new Set<string>(),
};

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

function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("x-workspace-id", "ws-1");
  if (init?.body) headers.set("content-type", "application/json");
  return new Request(`https://beta.test${path}`, { ...init, headers });
}

function serviceDouble() {
  return {
    list: vi.fn(async () => ({ items: [note], next_cursor: null })),
    create: vi.fn(async () => note),
    get: vi.fn(async () => note),
    update: vi.fn(async () => ({ ...note, revision: 2 })),
    listRevisions: vi.fn(async () => []),
    restore: vi.fn(async () => ({ ...note, revision: 2 })),
    deletePermanently: vi.fn(async () => ({ deleted: true })),
    quickCapture: vi.fn(async () => note),
  };
}

describe("v2 note routes", () => {
  it("registers tenant-scoped CRUD, capture, and revision routes", async () => {
    const worker = await loadWorker();
    expect(worker.registerNoteRoutes).toBeTypeOf("function");
    const service = serviceDouble();
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-notes",
      authenticate: vi.fn(async () => ({ userId: "user-1", sessionId: "session-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    (worker.registerNoteRoutes as any)(registry, () => service);

    const responses = await Promise.all([
      registry.fetch(request("/api/v2/notes?cursor=cursor-1&limit=25"), {}),
      registry.fetch(request("/api/v2/notes", {
        method: "POST",
        body: JSON.stringify({ title: "Draft", content: "Body" }),
      }), {}),
      registry.fetch(request("/api/v2/notes/note-1"), {}),
      registry.fetch(request("/api/v2/notes/note-1", {
        method: "PATCH",
        body: JSON.stringify({ base_revision: 1, title: "Updated" }),
      }), {}),
      registry.fetch(request("/api/v2/notes/note-1", {
        method: "DELETE",
        body: JSON.stringify({ base_revision: 1 }),
      }), {}),
      registry.fetch(request("/api/v2/notes/note-1/revisions"), {}),
      registry.fetch(request("/api/v2/notes/note-1/revisions/1/restore", {
        method: "POST",
        body: JSON.stringify({ base_revision: 1 }),
      }), {}),
      registry.fetch(request("/api/v2/capture", {
        method: "POST",
        body: JSON.stringify({ content: "Quick thought" }),
      }), {}),
    ]);

    expect(responses.map((response: Response) => response.status)).toEqual([200, 201, 200, 200, 200, 200, 200, 201]);
    expect(await responses[4]!.json()).toEqual({ success: true, data: { deleted: true }, request_id: "req-notes" });
    expect(service.list).toHaveBeenCalledWith(workspace, { cursor: "cursor-1", limit: 25 });
    const mutationWorkspace = { ...workspace, requestId: "req-notes" };
    expect(service.create).toHaveBeenCalledWith(mutationWorkspace, { title: "Draft", content: "Body" });
    expect(service.get).toHaveBeenCalledWith(workspace, "note-1");
    expect(service.update).toHaveBeenCalledWith(mutationWorkspace, "note-1", {
      base_revision: 1,
      title: "Updated",
      source: "autosave",
    });
    expect(service.deletePermanently).toHaveBeenCalledWith(mutationWorkspace, "note-1", { base_revision: 1 });
    expect(service.listRevisions).toHaveBeenCalledWith(workspace, "note-1");
    expect(service.restore).toHaveBeenCalledWith(mutationWorkspace, "note-1", 1, { base_revision: 1 });
    expect(service.quickCapture).toHaveBeenCalledWith(mutationWorkspace, { content: "Quick thought" });
  });

  it("rejects missing workspace context before calling the note service", async () => {
    const worker = await loadWorker();
    const service = serviceDouble();
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-no-workspace",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
    });
    (worker.registerNoteRoutes as any)(registry, () => service);

    const response = await registry.fetch(new Request("https://beta.test/api/v2/notes"), {});

    expect(response.status).toBe(400);
    expect(service.list).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ success: false, error: { code: "WORKSPACE_REQUIRED" } });
  });

  it("allows viewers to read but rejects note mutations", async () => {
    const worker = await loadWorker();
    const service = serviceDouble();
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-viewer",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace: vi.fn(async () => ({ ...workspace, role: "viewer" })),
    });
    (worker.registerNoteRoutes as any)(registry, () => service);

    const read = await registry.fetch(request("/api/v2/notes"), {});
    const write = await registry.fetch(request("/api/v2/notes", {
      method: "POST",
      body: JSON.stringify({ title: "Denied", content: "" }),
    }), {});
    const deleteResponse = await registry.fetch(request("/api/v2/notes/note-1", {
      method: "DELETE",
      body: JSON.stringify({ base_revision: 1 }),
    }), {});

    expect(read.status).toBe(200);
    expect(write.status).toBe(403);
    expect(deleteResponse.status).toBe(403);
    expect(service.create).not.toHaveBeenCalled();
    expect(service.deletePermanently).not.toHaveBeenCalled();
  });

  it("rejects malformed permanent deletion input before service invocation", async () => {
    const worker = await loadWorker();
    const service = serviceDouble();
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-delete-invalid",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    (worker.registerNoteRoutes as any)(registry, () => service);

    const response = await registry.fetch(request("/api/v2/notes/note-1", {
      method: "DELETE", body: JSON.stringify({ base_revision: 0 }),
    }), {});

    expect(response.status).toBe(400);
    expect(service.deletePermanently).not.toHaveBeenCalled();
  });

  it("returns the standard error envelope for every permanent deletion classification", async () => {
    const worker = await loadWorker();
    const ServiceError = worker.NoteServiceError as new (code: string, message: string, status: number) => Error;
    const service = serviceDouble();
    service.deletePermanently.mockImplementation(async (_context: unknown, _noteId: string, input: { base_revision: number }) => {
      if (input.base_revision === 1) throw new ServiceError("NOTE_NOT_FOUND", "Note not found", 404);
      if (input.base_revision === 2) throw new ServiceError("NOTE_NOT_TRASHED", "Only trashed notes can be permanently deleted", 409);
      throw new ServiceError("NOTE_CONFLICT", "The note changed before it could be permanently deleted", 409);
    });
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-delete-classification",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    (worker.registerNoteRoutes as any)(registry, () => service);

    for (const [base_revision, code, status] of [[1, "NOTE_NOT_FOUND", 404], [2, "NOTE_NOT_TRASHED", 409], [3, "NOTE_CONFLICT", 409]] as const) {
      const response = await registry.fetch(request("/api/v2/notes/note-1", {
        method: "DELETE", body: JSON.stringify({ base_revision }),
      }), {});
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ success: false, error: { code } });
    }
  });

  it("registers note routes in the default Beta worker", async () => {
    const worker = await loadWorker();
    const betaWorker = (worker.createBetaWorker as any)();

    const response = await betaWorker.fetch(request("/api/v2/notes"), {
      DB: {},
      APP_BASE_URL: "https://beta.test",
      RATE_LIMIT_SECRET: "rate-limit-secret-at-least-32-characters",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
      RESEND_API_KEY: "resend-secret",
      EMAIL_FROM: "Nexus Notes <notes@beta.test>",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false, error: { code: "UNAUTHENTICATED" } });
  });
});
