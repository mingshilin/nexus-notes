import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

describe("typed v2 route registry", () => {
  it("dispatches a registered route and serializes a success envelope", async () => {
    const worker = await loadWorker();
    expect(worker.createRouteRegistry).toBeTypeOf("function");

    const createRouteRegistry = worker.createRouteRegistry as (options: Record<string, unknown>) => {
      register(route: Record<string, unknown>): void;
      fetch(request: Request, env: unknown): Promise<Response>;
    };
    const registry = createRouteRegistry({ requestId: () => "req-health" });
    registry.register({
      method: "GET",
      path: "/api/v2/health",
      auth: "public",
      handler: () => ({ data: { status: "ok" } }),
    });

    const response = await registry.fetch(new Request("https://beta.test/api/v2/health"), {});

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-health");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({
      success: true,
      data: { status: "ok" },
      request_id: "req-health",
    });
  });

  it("extracts path parameters and reports unsupported methods", async () => {
    const worker = await loadWorker();
    const createRouteRegistry = worker.createRouteRegistry as (options: Record<string, unknown>) => {
      register(route: Record<string, unknown>): void;
      fetch(request: Request, env: unknown): Promise<Response>;
    };
    const registry = createRouteRegistry({ requestId: () => "req-route" });
    registry.register({
      method: "GET",
      path: "/api/v2/notes/:noteId",
      auth: "public",
      handler: ({ params }: { params: Record<string, string> }) => ({ data: { id: params.noteId } }),
    });

    const found = await registry.fetch(new Request("https://beta.test/api/v2/notes/note-1"), {});
    const rejected = await registry.fetch(
      new Request("https://beta.test/api/v2/notes/note-1", { method: "DELETE" }),
      {},
    );

    expect(await found.json()).toMatchObject({ success: true, data: { id: "note-1" } });
    expect(rejected.status).toBe(405);
    expect(await rejected.json()).toMatchObject({
      success: false,
      error: { code: "METHOD_NOT_ALLOWED", retryable: false },
      request_id: "req-route",
    });
  });

  it("returns a request-correlated not-found envelope", async () => {
    const worker = await loadWorker();
    const createRouteRegistry = worker.createRouteRegistry as (options: Record<string, unknown>) => {
      fetch(request: Request, env: unknown): Promise<Response>;
    };
    const registry = createRouteRegistry({ requestId: () => "req-missing" });

    const response = await registry.fetch(new Request("https://beta.test/api/v2/missing"), {});

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND", request_id: "req-missing", retryable: false },
      request_id: "req-missing",
    });
  });

  it("treats malformed encoded path parameters as not found", async () => {
    const worker = await loadWorker();
    const createRouteRegistry = worker.createRouteRegistry as (options: Record<string, unknown>) => {
      register(route: Record<string, unknown>): void;
      fetch(request: Request, env: unknown): Promise<Response>;
    };
    const registry = createRouteRegistry({ requestId: () => "req-malformed" });
    registry.register({
      method: "GET",
      path: "/api/v2/notes/:noteId",
      auth: "workspace",
      handler: () => ({ data: { unexpected: true } }),
    });

    const response = await registry.fetch(new Request("https://beta.test/api/v2/notes/%E0%A4%A"), {});

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
      request_id: "req-malformed",
    });
  });

  it("relays client disconnect cancellation to the route handler", async () => {
    const worker = await loadWorker();
    const createRouteRegistry = worker.createRouteRegistry as (options: Record<string, unknown>) => {
      register(route: Record<string, unknown>): void;
      fetch(request: Request, env: unknown): Promise<Response>;
    };
    const registry = createRouteRegistry({ requestId: () => "req-abort" });
    registry.register({
      method: "GET", path: "/api/v2/abort", auth: "public", timeoutMs: 5_000,
      handler: ({ signal }: { signal: AbortSignal }) => new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve({ data: { reason: signal.reason?.name } }), { once: true });
      }),
    });
    const requestController = new AbortController();
    const startedAt = Date.now();
    const pending = registry.fetch(new Request("https://beta.test/api/v2/abort", { signal: requestController.signal }), {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    requestController.abort(new DOMException("client disconnected", "AbortError"));

    const response = await pending;
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { reason: "AbortError" } });
  });

  it("preserves the deadline response when aborting the handler on timeout", async () => {
    const worker = await loadWorker();
    const createRouteRegistry = worker.createRouteRegistry as (options: Record<string, unknown>) => {
      register(route: Record<string, unknown>): void;
      fetch(request: Request, env: unknown): Promise<Response>;
    };
    const registry = createRouteRegistry({ requestId: () => "req-timeout" });
    registry.register({
      method: "GET", path: "/api/v2/timeout", auth: "public", timeoutMs: 10,
      handler: ({ signal }: { signal: AbortSignal }) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    });

    const response = await registry.fetch(new Request("https://beta.test/api/v2/timeout"), {});

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: "DEADLINE_EXCEEDED", retryable: true },
      request_id: "req-timeout",
    });
  });

  it("removes the request cancellation listener after the handler settles", async () => {
    const worker = await loadWorker();
    const createRouteRegistry = worker.createRouteRegistry as (options: Record<string, unknown>) => {
      register(route: Record<string, unknown>): void;
      fetch(request: Request, env: unknown): Promise<Response>;
    };
    const registry = createRouteRegistry({ requestId: () => "req-cleanup" });
    registry.register({
      method: "GET", path: "/api/v2/cleanup", auth: "public",
      handler: () => ({ data: { status: "ok" } }),
    });
    const request = new Request("https://beta.test/api/v2/cleanup");
    const removeEventListener = vi.spyOn(request.signal, "removeEventListener");

    const response = await registry.fetch(request, {});

    expect(response.status).toBe(200);
    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
