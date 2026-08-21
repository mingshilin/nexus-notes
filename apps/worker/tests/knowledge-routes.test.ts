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
});
