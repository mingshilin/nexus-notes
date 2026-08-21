import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

describe("gateway security", () => {
  it("rejects workspace routes without a session", async () => {
    const worker = await loadWorker();
    const createRouteRegistry = worker.createRouteRegistry as (options: Record<string, unknown>) => any;
    const registry = createRouteRegistry({ requestId: () => "req-auth", authenticate: vi.fn(async () => null) });
    registry.register({ method: "GET", path: "/api/v2/private", auth: "workspace", handler: () => ({ data: {} }) });

    const response = await registry.fetch(new Request("https://beta.test/api/v2/private", { headers: { "x-workspace-id": "ws-1" } }), {});

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false, error: { code: "UNAUTHENTICATED" } });
  });

  it("injects workspace context and enforces the minimum role", async () => {
    const worker = await loadWorker();
    const createRouteRegistry = worker.createRouteRegistry as (options: Record<string, unknown>) => any;
    const authorizeWorkspace = vi.fn(async () => ({ workspaceId: "ws-1", userId: "user-1", role: "viewer", capabilities: new Set() }));
    const options = {
      requestId: () => "req-role",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace,
    };
    const readRegistry = createRouteRegistry(options);
    readRegistry.register({ method: "GET", path: "/api/v2/read", auth: "workspace", handler: ({ workspace }: any) => ({ data: { role: workspace.role } }) });
    const writeRegistry = createRouteRegistry(options);
    writeRegistry.register({ method: "POST", path: "/api/v2/write", auth: "workspace", minimumRole: "editor", handler: () => ({ data: {} }) });

    const read = await readRegistry.fetch(new Request("https://beta.test/api/v2/read", { headers: { "x-workspace-id": "ws-1" } }), {});
    const write = await writeRegistry.fetch(new Request("https://beta.test/api/v2/write", { method: "POST", headers: { "x-workspace-id": "ws-1" } }), {});

    expect(await read.json()).toMatchObject({ success: true, data: { role: "viewer" } });
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
    expect(authorizeWorkspace).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1" }), "ws-1", expect.anything());
  });

  it("runs route rate-limit and quota hooks before the handler", async () => {
    const worker = await loadWorker();
    const createRouteRegistry = worker.createRouteRegistry as (options: Record<string, unknown>) => any;
    const enforceRateLimit = vi.fn(async () => undefined);
    const enforceQuota = vi.fn(async () => undefined);
    const handler = vi.fn(() => ({ data: { ok: true } }));
    const registry = createRouteRegistry({ requestId: () => "req-policy", enforceRateLimit, enforceQuota });
    registry.register({
      method: "POST", path: "/api/v2/register", auth: "public",
      rateLimit: { bucket: "ip", limit: 5, windowSeconds: 600 }, quota: "registrations", handler,
    });

    const response = await registry.fetch(new Request("https://beta.test/api/v2/register", { method: "POST" }), {});

    expect(response.status).toBe(200);
    expect(enforceRateLimit).toHaveBeenCalledOnce();
    expect(enforceQuota).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("serializes trusted policy failures without exposing internals", async () => {
    const worker = await loadWorker();
    const createRouteRegistry = worker.createRouteRegistry as (options: Record<string, unknown>) => any;
    const error = Object.assign(new Error("Too many requests"), {
      code: "RATE_LIMITED", status: 429, retryable: true, retryAfterSeconds: 60,
    });
    const registry = createRouteRegistry({
      requestId: () => "req-limited",
      enforceRateLimit: vi.fn(async () => { throw error; }),
    });
    registry.register({
      method: "POST", path: "/api/v2/limited", auth: "public",
      rateLimit: { bucket: "ip", limit: 1, windowSeconds: 60 }, handler: () => ({ data: {} }),
    });

    const response = await registry.fetch(new Request("https://beta.test/api/v2/limited", { method: "POST" }), {});

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: "RATE_LIMITED", message: "Too many requests", retryable: true },
      request_id: "req-limited",
    });
  });

  it("preserves safe structured details for trusted conflict errors", async () => {
    const worker = await loadWorker();
    const createRouteRegistry = worker.createRouteRegistry as (options: Record<string, unknown>) => any;
    const error = Object.assign(new Error("Note changed on another device"), {
      code: "NOTE_CONFLICT",
      status: 409,
      retryable: false,
      details: { server_revision: 3, submitted_revision: 2 },
    });
    const registry = createRouteRegistry({ requestId: () => "req-conflict" });
    registry.register({
      method: "PATCH",
      path: "/api/v2/notes/:noteId",
      auth: "public",
      handler: () => { throw error; },
    });

    const response = await registry.fetch(new Request("https://beta.test/api/v2/notes/note-1", {
      method: "PATCH",
    }), {});

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false,
      error: {
        code: "NOTE_CONFLICT",
        details: { server_revision: 3, submitted_revision: 2 },
      },
    });
  });

  it("rejects oversized JSON bodies before parsing or dispatching", async () => {
    const worker = await loadWorker();
    const createRouteRegistry = worker.createRouteRegistry as (options: Record<string, unknown>) => any;
    const handler = vi.fn(() => ({ data: {} }));
    const registry = createRouteRegistry({ requestId: () => "req-large", maxBodyBytes: 32 });
    registry.register({
      method: "POST",
      path: "/api/v2/body",
      auth: "public",
      body: { safeParse: (value: unknown) => ({ success: true, data: value }) },
      handler,
    });

    const response = await registry.fetch(new Request("https://beta.test/api/v2/body", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(64) }),
    }), {});

    expect(response.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: "BODY_TOO_LARGE", retryable: false },
      request_id: "req-large",
    });
  });

  it("returns a retryable deadline error when a route exceeds timeoutMs", async () => {
    vi.useFakeTimers();
    try {
      const worker = await loadWorker();
      const createRouteRegistry = worker.createRouteRegistry as (options: Record<string, unknown>) => any;
      const registry = createRouteRegistry({ requestId: () => "req-timeout" });
      registry.register({
        method: "GET",
        path: "/api/v2/slow",
        auth: "public",
        timeoutMs: 50,
        handler: () => new Promise(() => undefined),
      });

      const responsePromise = registry.fetch(new Request("https://beta.test/api/v2/slow"), {});
      await vi.advanceTimersByTimeAsync(50);
      const response = await responsePromise;

      expect(response.status).toBe(504);
      expect(await response.json()).toMatchObject({
        success: false,
        error: { code: "DEADLINE_EXCEEDED", retryable: true },
        request_id: "req-timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
