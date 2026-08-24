import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src")) as WorkerExports;
}

const workspace = { workspaceId: "ws-1", userId: "user-1", role: "editor", capabilities: new Set<string>() };

function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("x-workspace-id", "ws-1");
  if (init?.body) headers.set("content-type", "application/json");
  return new Request(`https://beta.test${path}`, { ...init, headers });
}

describe("v2 sync routes", () => {
  it("registers authenticated push and pull routes with the typed protocol", async () => {
    const worker = await loadWorker();
    expect(worker.registerSyncRoutes).toBeTypeOf("function");
    const service = {
      push: vi.fn(async () => ({ operations: [], next_cursor: "4" })),
      pull: vi.fn(async () => ({ changes: [], next_cursor: "4" })),
    };
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-sync",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    (worker.registerSyncRoutes as any)(registry, () => service);

    const push = await registry.fetch(request("/api/v2/sync/push", {
      method: "POST",
      body: JSON.stringify({ operations: [] }),
    }), {});
    const pull = await registry.fetch(request("/api/v2/sync/pull?cursor=3"), {});

    expect(push.status).toBe(200);
    expect(pull.status).toBe(200);
    expect(service.push).toHaveBeenCalledWith(workspace, { operations: [] });
    expect(service.pull).toHaveBeenCalledWith(workspace, "3");
  });

  it("rejects malformed cursors before calling the sync service", async () => {
    const worker = await loadWorker();
    const service = { push: vi.fn(), pull: vi.fn() };
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-sync-invalid",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    (worker.registerSyncRoutes as any)(registry, () => service);

    const response = await registry.fetch(request("/api/v2/sync/pull?cursor=-1"), {});
    expect(response.status).toBe(400);
    expect(service.pull).not.toHaveBeenCalled();
  });
});
