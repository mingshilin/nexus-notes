import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src")) as WorkerExports;
}

const workspace = {
  workspaceId: "ws-1", userId: "user-1", role: "viewer", capabilities: new Set<string>(),
};

function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("x-workspace-id", "ws-1");
  if (init?.body) headers.set("content-type", "application/json");
  return new Request(`https://beta.test${path}`, { ...init, headers });
}

describe("v2 knowledge routes", () => {
  it("exposes workspace search and owner-scoped saved searches to viewers", async () => {
    const worker = await loadWorker();
    expect(worker.registerKnowledgeRoutes).toBeTypeOf("function");
    const service = {
      search: vi.fn(async () => ({ items: [], next_cursor: null })),
      listSavedSearches: vi.fn(async () => []),
      createSavedSearch: vi.fn(async () => ({ id: "saved-1" })),
      deleteSavedSearch: vi.fn(async () => undefined),
    };
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-knowledge",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    (worker.registerKnowledgeRoutes as any)(registry, () => service);

    const responses = await Promise.all([
      registry.fetch(request("/api/v2/search", {
        method: "POST",
        body: JSON.stringify({ query: "Alpha", filters: { tag_ids: ["tag-1"] }, limit: 25 }),
      }), {}),
      registry.fetch(request("/api/v2/search/saved"), {}),
      registry.fetch(request("/api/v2/search/saved", {
        method: "POST",
        body: JSON.stringify({ name: "Research", query: "Alpha", filters: { tag_ids: ["tag-1"] } }),
      }), {}),
      registry.fetch(request("/api/v2/search/saved/saved-1", { method: "DELETE" }), {}),
    ]);

    expect(responses.map((response: Response) => response.status)).toEqual([200, 200, 201, 200]);
    expect(service.search).toHaveBeenCalledWith(workspace, expect.objectContaining({
      query: "Alpha", limit: 25, filters: expect.objectContaining({ tag_ids: ["tag-1"] }),
    }));
    expect(service.deleteSavedSearch).toHaveBeenCalledWith(workspace, "saved-1");
  });

  it("registers knowledge routes in the default Beta worker", async () => {
    const worker = await loadWorker();
    const betaWorker = (worker.createBetaWorker as any)();
    const response = await betaWorker.fetch(request("/api/v2/search", {
      method: "POST",
      body: JSON.stringify({ query: "Alpha" }),
    }), {
      DB: {}, APP_BASE_URL: "https://beta.test",
      RATE_LIMIT_SECRET: "rate-limit-secret-at-least-32-characters",
      TURNSTILE_SECRET_KEY: "turnstile-secret", RESEND_API_KEY: "resend-secret",
      EMAIL_FROM: "Nexus Notes <notes@beta.test>",
    });

    expect(response.status).toBe(401);
  });

  it("registers taxonomy, reminder, and graph routes with editor-only shared mutations", async () => {
    const worker = await loadWorker();
    expect(worker.registerTaxonomyRoutes).toBeTypeOf("function");
    expect(worker.registerReminderRoutes).toBeTypeOf("function");
    expect(worker.registerGraphRoutes).toBeTypeOf("function");
    const service = {
      listFolders: vi.fn(async () => []), createFolder: vi.fn(async () => ({ id: "folder-1" })),
      listTags: vi.fn(async () => []), createTag: vi.fn(async () => ({ id: "tag-1" })),
      setNoteTags: vi.fn(async () => undefined), setNoteLinks: vi.fn(async () => undefined),
      listNoteLinks: vi.fn(async () => []), listBacklinks: vi.fn(async () => []),
      getGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
      listReminders: vi.fn(async () => []), createReminder: vi.fn(async () => ({ id: "reminder-1" })),
      updateReminder: vi.fn(async () => ({ id: "reminder-1", revision: 2 })),
    };
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-knowledge-actions",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace: vi.fn(async () => ({ ...workspace, role: "editor" })),
    });
    (worker.registerTaxonomyRoutes as any)(registry, () => service);
    (worker.registerReminderRoutes as any)(registry, () => service);
    (worker.registerGraphRoutes as any)(registry, () => service);

    const responses = await Promise.all([
      registry.fetch(request("/api/v2/folders"), {}),
      registry.fetch(request("/api/v2/folders", { method: "POST", body: JSON.stringify({ name: "Projects" }) }), {}),
      registry.fetch(request("/api/v2/tags"), {}),
      registry.fetch(request("/api/v2/tags", { method: "POST", body: JSON.stringify({ name: "research" }) }), {}),
      registry.fetch(request("/api/v2/notes/note-1/tags", { method: "PUT", body: JSON.stringify({ tag_ids: ["tag-1"] }) }), {}),
      registry.fetch(request("/api/v2/notes/note-1/links", { method: "PUT", body: JSON.stringify({ target_note_ids: ["note-2"] }) }), {}),
      registry.fetch(request("/api/v2/notes/note-1/links"), {}),
      registry.fetch(request("/api/v2/notes/note-1/backlinks"), {}),
      registry.fetch(request("/api/v2/graph"), {}),
      registry.fetch(request("/api/v2/graph/local/note-1"), {}),
      registry.fetch(request("/api/v2/reminders"), {}),
      registry.fetch(request("/api/v2/reminders", { method: "POST", body: JSON.stringify({ note_id: "note-1", remind_at: "2026-08-22T00:00:00.000Z" }) }), {}),
      registry.fetch(request("/api/v2/reminders/reminder-1", { method: "PATCH", body: JSON.stringify({ base_revision: 1, status: "dismissed" }) }), {}),
    ]);

    expect(responses.every((response: Response) => response.status >= 200 && response.status < 300)).toBe(true);
    expect(service.setNoteTags).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws-1" }), "note-1", { tag_ids: ["tag-1"] });
    expect(service.getGraph).toHaveBeenNthCalledWith(1, expect.objectContaining({ workspaceId: "ws-1" }));
    expect(service.getGraph).toHaveBeenNthCalledWith(2, expect.objectContaining({ workspaceId: "ws-1" }), "note-1");
  });
});
