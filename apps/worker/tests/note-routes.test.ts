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
    openOrCreateDaily: vi.fn(async () => ({ ...note, daily_date: "2026-08-23" })),
    get: vi.fn(async () => note),
    update: vi.fn(async () => ({ ...note, revision: 2 })),
    listRevisions: vi.fn(async () => []),
    restore: vi.fn(async () => ({ ...note, revision: 2 })),
    deletePermanently: vi.fn(async () => ({ deleted: true })),
    quickCapture: vi.fn(async () => note),
    clipperCapture: vi.fn(async () => note),
  };
}

describe("v2 note routes", () => {
  it("returns 409 for controlled Daily Note conflicts on normal create and update routes", async () => {
    const worker = await loadWorker();
    const ServiceError = worker.NoteServiceError as new (code: string, message: string, status: number) => Error;
    const service = serviceDouble();
    service.create.mockRejectedValue(new ServiceError("DAILY_NOTE_CONFLICT", "Daily note already exists", 409));
    service.update.mockRejectedValue(new ServiceError("DAILY_NOTE_CONFLICT", "Daily note already exists", 409));
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-daily-conflict",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    (worker.registerNoteRoutes as any)(registry, () => service);

    const create = await registry.fetch(request("/api/v2/notes", {
      method: "POST", body: JSON.stringify({ title: "Daily", content: "", daily_date: "2026-08-23" }),
    }), {});
    const update = await registry.fetch(request("/api/v2/notes/note-1", {
      method: "PATCH", body: JSON.stringify({ base_revision: 1, daily_date: "2026-08-23" }),
    }), {});

    expect(create.status).toBe(409);
    expect(update.status).toBe(409);
    expect(await create.json()).toMatchObject({ success: false, error: { code: "DAILY_NOTE_CONFLICT", retryable: false } });
    expect(await update.json()).toMatchObject({ success: false, error: { code: "DAILY_NOTE_CONFLICT", retryable: false } });
  });

  it("opens a daily note for editors and validates its strict request body", async () => {
    const worker = await loadWorker();
    const service = serviceDouble();
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-daily",
      authenticate: vi.fn(async () => ({ userId: "user-1", sessionId: "session-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    (worker.registerNoteRoutes as any)(registry, () => service);

    const success = await registry.fetch(request("/api/v2/notes/daily", {
      method: "POST", body: JSON.stringify({ daily_date: "2026-08-23" }),
    }), {});
    expect(success.status).toBe(200);
    expect(await success.json()).toEqual({
      success: true,
      data: { note: expect.objectContaining({ daily_date: "2026-08-23" }) },
      request_id: "req-daily",
    });
    expect(service.openOrCreateDaily).toHaveBeenCalledWith(
      { ...workspace, requestId: "req-daily" },
      { daily_date: "2026-08-23" },
    );

    const invalid = await registry.fetch(request("/api/v2/notes/daily", {
      method: "POST", body: JSON.stringify({ daily_date: "2026-8-23", title: "not allowed" }),
    }), {});
    expect(invalid.status).toBe(400);
    expect(service.openOrCreateDaily).toHaveBeenCalledOnce();

    const viewerRegistry = (worker.createRouteRegistry as any)({
      requestId: () => "req-daily-viewer",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace: vi.fn(async () => ({ ...workspace, role: "viewer" })),
    });
    (worker.registerNoteRoutes as any)(viewerRegistry, () => service);
    const denied = await viewerRegistry.fetch(request("/api/v2/notes/daily", {
      method: "POST", body: JSON.stringify({ daily_date: "2026-08-23" }),
    }), {});
    expect(denied.status).toBe(403);
  });

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

  it("registers a workspace-scoped Web Clipper route without changing quick capture", async () => {
    const worker = await loadWorker();
    const service = serviceDouble();
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-clipper",
      authenticate: vi.fn(async () => ({ userId: "user-1", sessionId: "session-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    (worker.registerNoteRoutes as any)(registry, () => service);

    const response = await registry.fetch(request("/api/v2/clipper/capture", {
      method: "POST",
      body: JSON.stringify({
        title: "Article",
        url: "https://example.com/article",
        content: "Captured body",
        target: "database",
        database_id: "db-1",
      }),
    }), {});

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ success: true, data: { note }, request_id: "req-clipper" });
    expect(service.clipperCapture).toHaveBeenCalledWith(
      { ...workspace, requestId: "req-clipper" },
      { title: "Article", url: "https://example.com/article", content: "Captured body", target: "database", database_id: "db-1" },
    );

    const unsafe = await registry.fetch(request("/api/v2/clipper/capture", {
      method: "POST",
      body: JSON.stringify({ content: "Unsafe", url: "javascript:alert(1)" }),
    }), {});
    expect(unsafe.status).toBe(400);
    expect(service.clipperCapture).toHaveBeenCalledOnce();
  });

  it("passes note search and list filters to the service", async () => {
    const worker = await loadWorker();
    const service = serviceDouble();
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-note-search",
      authenticate: vi.fn(async () => ({ userId: "user-1", sessionId: "session-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    (worker.registerNoteRoutes as any)(registry, () => service);

    const response = await registry.fetch(request(
      "/api/v2/notes?q=project%20plan&status=active&folder_id=none&daily_date=2026-08-23&favorite=true&pinned=false&limit=30",
    ), {});

    expect(response.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith(workspace, {
      query: "project plan",
      status: "active",
      folderId: null,
      dailyDate: "2026-08-23",
      favorite: true,
      pinned: false,
      limit: 30,
    });
  });

  it("accepts a 500-character query and rejects longer queries before the service", async () => {
    const worker = await loadWorker();
    const service = serviceDouble();
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-note-search-limit",
      authenticate: vi.fn(async () => ({ userId: "user-1", sessionId: "session-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    (worker.registerNoteRoutes as any)(registry, () => service);

    const accepted = await registry.fetch(request(`/api/v2/notes?q=${"a".repeat(500)}`), {});
    expect(accepted.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith(workspace, expect.objectContaining({ query: "a".repeat(500) }));

    service.list.mockClear();
    const rejected = await registry.fetch(request(`/api/v2/notes?q=${"a".repeat(501)}`), {});
    expect(rejected.status).toBe(400);
    expect(service.list).not.toHaveBeenCalled();
    expect(await rejected.json()).toMatchObject({ success: false, error: { code: "INVALID_QUERY" } });
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
