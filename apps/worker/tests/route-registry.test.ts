import { describe, expect, it } from "vitest";

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
      auth: "workspace",
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
});
