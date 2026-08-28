import { describe, expect, it, vi } from "vitest";

type WebExports = Record<string, unknown>;

async function loadWeb() {
  return (await import("../src/index")) as WebExports;
}

function success(data: unknown, requestId = "req-test") {
  return new Response(JSON.stringify({ success: true, data, request_id: requestId }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function unavailable() {
  return new Response(
    JSON.stringify({
      success: false,
      error: { code: "UNAVAILABLE", message: "Retry", request_id: "req-fail", retryable: true },
      request_id: "req-fail",
    }),
    { status: 503, headers: { "content-type": "application/json" } },
  );
}

describe("ApiClient", () => {
  it("deduplicates identical active queries", async () => {
    const web = await loadWeb();
    expect(web.ApiClient).toBeTypeOf("function");
    let resolveFetch!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    const fetchImpl = vi.fn(() => pending);
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });
    const sharedSignal = new AbortController().signal;
    const request = {
      path: "/api/v2/notes",
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "notes:ws-1", signal: sharedSignal },
    };

    const first = client.request(request);
    const second = client.request(request);
    resolveFetch(success({ items: [] }));

    await expect(first).resolves.toEqual({ items: [] });
    await expect(second).resolves.toEqual({ items: [] });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps query dedupe opt-in when no dedupe key is provided", async () => {
    const web = await loadWeb();
    const pending: Array<{ resolve(response: Response): void }> = [];
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { pending.push({ resolve }); }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });
    const request = {
      path: "/api/v2/notes",
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0 },
    };

    const first = client.request<{ request: string }>(request);
    const second = client.request<{ request: string }>(request);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    pending[0]!.resolve(success({ request: "first" }));
    pending[1]!.resolve(success({ request: "second" }));
    await expect(first).resolves.toEqual({ request: "first" });
    await expect(second).resolves.toEqual({ request: "second" });
  });

  it("builds active query dedupe from workspace, path, normalized query, and normalized body", async () => {
    const web = await loadWeb();
    const pending: Array<{ resolve(response: Response): void }> = [];
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { pending.push({ resolve }); }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });

    const first = client.request<{ page: string }>({
      path: "/api/v2/databases/db-1/records?view_id=view-1&cursor=cursor-1&limit=25",
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "records" },
    });
    const sameQueryDifferentOrder = client.request<{ page: string }>({
      path: "/api/v2/databases/db-1/records?limit=25&cursor=cursor-1&view_id=view-1",
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "records" },
    });
    const differentPath = client.request<{ page: string }>({
      path: "/api/v2/databases/db-2/records?view_id=view-1&cursor=cursor-1&limit=25",
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "records" },
    });
    const preview = client.request<{ preview: string }>({
      path: "/api/v2/databases/db-1/import/csv/preview",
      method: "POST",
      body: { csv: "Name\r\nAlpha", header_property_ids: { Name: "name", Owner: "owner" } },
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "csv-preview" },
    });
    const samePreviewDifferentBodyOrder = client.request<{ preview: string }>({
      path: "/api/v2/databases/db-1/import/csv/preview",
      method: "POST",
      body: { header_property_ids: { Owner: "owner", Name: "name" }, csv: "Name\r\nAlpha" },
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "csv-preview" },
    });
    const differentPreviewBody = client.request<{ preview: string }>({
      path: "/api/v2/databases/db-1/import/csv/preview",
      method: "POST",
      body: { csv: "Name\r\nBeta", header_property_ids: { Name: "name", Owner: "owner" } },
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "csv-preview" },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    pending[0]!.resolve(success({ page: "db-1" }));
    pending[1]!.resolve(success({ page: "db-2" }));
    pending[2]!.resolve(success({ preview: "alpha" }));
    pending[3]!.resolve(success({ preview: "beta" }));

    await expect(first).resolves.toEqual({ page: "db-1" });
    await expect(sameQueryDifferentOrder).resolves.toEqual({ page: "db-1" });
    await expect(differentPath).resolves.toEqual({ page: "db-2" });
    await expect(preview).resolves.toEqual({ preview: "alpha" });
    await expect(samePreviewDifferentBodyOrder).resolves.toEqual({ preview: "alpha" });
    await expect(differentPreviewBody).resolves.toEqual({ preview: "beta" });
  });

  it("does not deduplicate distinct JSON bodies that collide under a short hash", async () => {
    const web = await loadWeb();
    const pending: Array<{ resolve(response: Response): void }> = [];
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { pending.push({ resolve }); }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });

    const first = client.request<{ value: string }>({
      path: "/api/v2/search/preview",
      method: "POST",
      body: { value: "MuxFK7bW" },
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "preview" },
    });
    const second = client.request<{ value: string }>({
      path: "/api/v2/search/preview",
      method: "POST",
      body: { value: "t98BxdeG" },
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "preview" },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    pending[0]!.resolve(success({ value: "first" }));
    pending[1]!.resolve(success({ value: "second" }));
    await expect(first).resolves.toEqual({ value: "first" });
    await expect(second).resolves.toEqual({ value: "second" });
  });

  it("treats workspace header names case-insensitively when scoping active queries", async () => {
    const web = await loadWeb();
    const pending: Array<{ resolve(response: Response): void }> = [];
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { pending.push({ resolve }); }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });

    const first = client.request<{ workspace: string }>({
      path: "/api/v2/databases",
      headers: { "X-Workspace-Id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "databases" },
    });
    const second = client.request<{ workspace: string }>({
      path: "/api/v2/databases",
      headers: { "X-WORKSPACE-ID": "ws-2" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "databases" },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    pending[0]!.resolve(success({ workspace: "ws-1" }));
    pending[1]!.resolve(success({ workspace: "ws-2" }));
    await expect(first).resolves.toEqual({ workspace: "ws-1" });
    await expect(second).resolves.toEqual({ workspace: "ws-2" });
  });

  it("uses one workspace header snapshot for both the dedupe key and wire request", async () => {
    const web = await loadWeb();
    let headerReads = 0;
    const headers = {} as Record<string, string>;
    Object.defineProperty(headers, "X-Workspace-Id", {
      enumerable: true,
      get() {
        headerReads += 1;
        return headerReads === 1 ? "ws-1" : "ws-2";
      },
    });
    let resolveFetch!: (response: Response) => void;
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve) => {
      expect(init.headers).toMatchObject({ "x-workspace-id": "ws-1" });
      resolveFetch = resolve;
    }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });
    const first = client.request<{ workspace: string }>({
      path: "/api/v2/databases",
      headers,
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "databases" },
    });
    const second = client.request<{ workspace: string }>({
      path: "/api/v2/databases",
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "databases" },
    });

    expect(headerReads).toBe(1);
    expect(fetchImpl).toHaveBeenCalledOnce();
    resolveFetch(success({ workspace: "ws-1" }));
    await expect(first).resolves.toEqual({ workspace: "ws-1" });
    await expect(second).resolves.toEqual({ workspace: "ws-1" });
  });

  it("reuses the initial workspace header snapshot across retries", async () => {
    const web = await loadWeb();
    const headers = { "x-workspace-id": "ws-1" };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(success({ workspace: "ws-1" }));
    const sleep = vi.fn(async () => {
      headers["x-workspace-id"] = "ws-2";
    });
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep, random: () => 0 });

    await expect(client.request({
      path: "/api/v2/databases",
      headers,
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 1, dedupeKey: "databases" },
    })).resolves.toEqual({ workspace: "ws-1" });
    expect(fetchImpl.mock.calls.map(([, init]) => (init as RequestInit).headers)).toEqual([
      expect.objectContaining({ "x-workspace-id": "ws-1" }),
      expect.objectContaining({ "x-workspace-id": "ws-1" }),
    ]);
  });

  it("rejects conflicting case-insensitive workspace headers without sending an ambiguous request", async () => {
    const web = await loadWeb();
    const fetchImpl = vi.fn(async () => success({ ok: true }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });

    await expect(client.request({
      path: "/api/v2/databases",
      headers: { "X-Workspace-Id": "ws-1", "x-workspace-id": "ws-2" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "databases" },
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips dedupe when custom JSON serialization is not safely canonicalizable", async () => {
    const web = await loadWeb();
    const pending: Array<{ resolve(response: Response): void }> = [];
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { pending.push({ resolve }); }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });
    const customBody = (wireValue: string) => Object.assign(Object.create({
      toJSON() {
        return { wire_value: wireValue };
      },
    }), { same_enumerable_value: true });

    const first = client.request<{ value: string }>({
      path: "/api/v2/search/preview",
      method: "POST",
      body: customBody("first"),
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "preview" },
    });
    const second = client.request<{ value: string }>({
      path: "/api/v2/search/preview",
      method: "POST",
      body: customBody("second"),
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "preview" },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).body).toBe(JSON.stringify({ wire_value: "first" }));
    expect((fetchImpl.mock.calls[1]?.[1] as RequestInit).body).toBe(JSON.stringify({ wire_value: "second" }));
    pending[0]!.resolve(success({ value: "first" }));
    pending[1]!.resolve(success({ value: "second" }));
    await expect(first).resolves.toEqual({ value: "first" });
    await expect(second).resolves.toEqual({ value: "second" });
  });

  it("skips dedupe for accessor-backed JSON values instead of reading them twice", async () => {
    const web = await loadWeb();
    const pending: Array<{ resolve(response: Response): void }> = [];
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { pending.push({ resolve }); }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });
    const accessorBody = (laterValue: string) => {
      let reads = 0;
      const body = {} as Record<string, unknown>;
      Object.defineProperty(body, "value", {
        enumerable: true,
        get() {
          reads += 1;
          return reads === 1 ? "shared" : laterValue;
        },
      });
      return { body, reads: () => reads };
    };
    const firstBody = accessorBody("first");
    const secondBody = accessorBody("second");

    const first = client.request<{ value: string }>({
      path: "/api/v2/search/preview",
      method: "POST",
      body: firstBody.body,
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "preview" },
    });
    const second = client.request<{ value: string }>({
      path: "/api/v2/search/preview",
      method: "POST",
      body: secondBody.body,
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "preview" },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(firstBody.reads()).toBe(1);
    expect(secondBody.reads()).toBe(1);
    pending[0]!.resolve(success({ value: "first" }));
    pending[1]!.resolve(success({ value: "second" }));
    await expect(first).resolves.toEqual({ value: "first" });
    await expect(second).resolves.toEqual({ value: "second" });
  });

  it("keeps malformed query paths on the asynchronous ApiClient error path", async () => {
    const web = await loadWeb();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Invalid URL");
    });
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });
    let request: Promise<unknown> | undefined;

    expect(() => {
      request = client.request({
        path: "http://[invalid",
        requestClass: "query",
        policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "malformed-path" },
      });
    }).not.toThrow();
    await expect(request).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("does not deduplicate raw query bodies that may contain different bytes", async () => {
    const web = await loadWeb();
    const pending: Array<{ resolve(response: Response): void }> = [];
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { pending.push({ resolve }); }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });
    const signal = new AbortController().signal;

    const first = client.request<{ uploaded: string }>({
      path: "/api/v2/databases/db-1/import/csv/preview",
      method: "POST",
      body: new Blob(["Name\r\nAlpha"], { type: "text/csv" }),
      bodyMode: "raw",
      headers: { "x-workspace-id": "ws-1", "content-type": "text/csv" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "raw-preview", signal },
    });
    const second = client.request<{ uploaded: string }>({
      path: "/api/v2/databases/db-1/import/csv/preview",
      method: "POST",
      body: new Blob(["Name\r\nBeta"], { type: "text/csv" }),
      bodyMode: "raw",
      headers: { "x-workspace-id": "ws-1", "content-type": "text/csv" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "raw-preview", signal },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    pending[0]!.resolve(success({ uploaded: "alpha" }));
    pending[1]!.resolve(success({ uploaded: "beta" }));

    await expect(first).resolves.toEqual({ uploaded: "alpha" });
    await expect(second).resolves.toEqual({ uploaded: "beta" });
  });

  it("keeps cyclic JSON query body errors asynchronous by skipping active dedupe", async () => {
    const web = await loadWeb();
    const fetchImpl = vi.fn(async () => success({ ok: true }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });
    const body: Record<string, unknown> = { title: "Cycle" };
    body.self = body;
    let request: Promise<unknown> | undefined;

    expect(() => {
      request = client.request({
        path: "/api/v2/databases/db-1/import/csv/preview",
        method: "POST",
        body,
        headers: { "x-workspace-id": "ws-1" },
        requestClass: "query",
        policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "cyclic-preview" },
      });
    }).not.toThrow();

    expect(request).toBeInstanceOf(Promise);
    await expect(request).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps stable JSON body dedupe for nested objects and isolates different abort signals", async () => {
    const web = await loadWeb();
    const pending: Array<{ resolve(response: Response): void }> = [];
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { pending.push({ resolve }); }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });
    const sharedSignal = new AbortController().signal;
    const otherSignal = new AbortController().signal;
    const requestBody = {
      filters: [{ config: { value: "open", operator: "eq" }, property_id: "status" }],
      sorts: [{ direction: "asc", property_id: "name" }],
    };
    const sameBodyDifferentOrder = {
      sorts: [{ property_id: "name", direction: "asc" }],
      filters: [{ property_id: "status", config: { operator: "eq", value: "open" } }],
    };

    const first = client.request<{ rows: string[] }>({
      path: "/api/v2/databases/db-1/records/query",
      method: "POST",
      body: requestBody,
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "records-query", signal: sharedSignal },
    });
    const sameSignal = client.request<{ rows: string[] }>({
      path: "/api/v2/databases/db-1/records/query",
      method: "POST",
      body: sameBodyDifferentOrder,
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "records-query", signal: sharedSignal },
    });
    const differentSignal = client.request<{ rows: string[] }>({
      path: "/api/v2/databases/db-1/records/query",
      method: "POST",
      body: sameBodyDifferentOrder,
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "records-query", signal: otherSignal },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    pending[0]!.resolve(success({ rows: ["shared"] }));
    pending[1]!.resolve(success({ rows: ["isolated"] }));

    await expect(first).resolves.toEqual({ rows: ["shared"] });
    await expect(sameSignal).resolves.toEqual({ rows: ["shared"] });
    await expect(differentSignal).resolves.toEqual({ rows: ["isolated"] });
  });

  it("does not share active queries across different abort signals", async () => {
    const web = await loadWeb();
    const pending: Array<{ resolve(response: Response): void }> = [];
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      pending.push({ resolve });
      (init.signal as AbortSignal).addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = client.request<{ items: string[] }>({
      path: "/api/v2/databases",
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "databases", signal: firstController.signal },
    });
    const firstRejected = first.then(
      () => { throw new Error("Expected the first query to reject after abort"); },
      (error) => error,
    );
    const second = client.request<{ items: string[] }>({
      path: "/api/v2/databases",
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "databases", signal: secondController.signal },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    firstController.abort();
    pending[1]!.resolve(success({ items: ["fresh"] }));

    await expect(second).resolves.toEqual({ items: ["fresh"] });
    await expect(firstRejected).resolves.toMatchObject({ name: "AbortError" });
  });

  it("scopes active query dedupe by workspace headers", async () => {
    const web = await loadWeb();
    const pending: Array<{ resolve(response: Response): void; signal: AbortSignal }> = [];
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      const signal = init.signal as AbortSignal;
      pending.push({ resolve, signal });
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });
    const firstController = new AbortController();
    const first = client.request<{ items: string[] }>({
      path: "/api/v2/databases",
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "databases", signal: firstController.signal },
    }).catch((error) => error);
    const second = client.request<{ items: string[] }>({
      path: "/api/v2/databases",
      headers: { "x-workspace-id": "ws-2" },
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "databases" },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    firstController.abort();
    pending[1]!.resolve(success({ items: ["ws-2"] }));

    await expect(second).resolves.toEqual({ items: ["ws-2"] });
    await expect(first).resolves.toMatchObject({ name: "AbortError" });
  });

  it("starts a fresh controlled fetch when an active query signal was aborted", async () => {
    const web = await loadWeb();
    const pending: Array<{ resolve(response: Response): void; reject(error: unknown): void }> = [];
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      pending.push({ resolve, reject });
      (init.signal as AbortSignal).addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep: vi.fn() });
    const firstController = new AbortController();
    const first = client.request<{ items: string[] }>({
      path: "/api/v2/knowledge/diagnostics?limit=50",
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "diagnostics:ws-1", signal: firstController.signal },
    });
    const firstRejected = first.then(
      () => { throw new Error("Expected the aborted query to reject"); },
      (error) => error,
    );

    firstController.abort();
    const second = client.request<{ items: string[] }>({
      path: "/api/v2/knowledge/diagnostics?limit=50",
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "diagnostics:ws-1", signal: new AbortController().signal },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    pending[1]?.resolve(success({ items: ["fresh"] }));
    await expect(second).resolves.toEqual({ items: ["fresh"] });
    await expect(firstRejected).resolves.toMatchObject({ name: "AbortError" });
  });

  it("retries retryable GET failures up to the policy bound", async () => {
    const web = await loadWeb();
    const responses = [unavailable(), unavailable(), success({ id: "note-1" })];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const sleep = vi.fn(async () => undefined);
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ baseUrl: "https://beta.test", fetchImpl, sleep, random: () => 0 });

    const result = await client.request<{ id: string }>({
      path: "/api/v2/notes/note-1",
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 2 },
    });

    expect(result).toEqual({ id: "note-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("retries writes only with an idempotency key", async () => {
    const web = await loadWeb();
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const unsafeFetch = vi.fn(async () => unavailable());
    const unsafe = new ApiClient({ baseUrl: "https://beta.test", fetchImpl: unsafeFetch, sleep: vi.fn() });

    await expect(unsafe.request({
      path: "/api/v2/notes",
      method: "POST",
      body: { title: "Draft" },
      requestClass: "command",
      policy: { timeoutMs: 1_000, retry: 2 },
    })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(unsafeFetch).toHaveBeenCalledOnce();

    const safeFetch = vi.fn()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(success({ id: "note-1" }));
    const safe = new ApiClient({ baseUrl: "https://beta.test", fetchImpl: safeFetch, sleep: vi.fn() });
    await expect(safe.request({
      path: "/api/v2/notes",
      method: "POST",
      body: { title: "Draft" },
      requestClass: "idempotent-command",
      policy: { timeoutMs: 1_000, retry: 1, idempotencyKey: "create-note-1" },
    })).resolves.toEqual({ id: "note-1" });
    expect(safeFetch).toHaveBeenCalledTimes(2);
    expect((safeFetch.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      "idempotency-key": "create-note-1",
    });

    const headerOnlyFetch = vi.fn(async () => unavailable());
    const headerOnly = new ApiClient({ baseUrl: "https://beta.test", fetchImpl: headerOnlyFetch, sleep: vi.fn() });
    await expect(headerOnly.request({
      path: "/api/v2/notes",
      method: "POST",
      headers: { "idempotency-key": "manual-header-only" },
      body: { title: "Draft" },
      requestClass: "command",
      policy: { timeoutMs: 1_000, retry: 2 },
    })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(headerOnlyFetch).toHaveBeenCalledOnce();
  });

  it("keeps the native global receiver when using the default fetch", async () => {
    const web = await loadWeb();
    const nativeLikeFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(success({ ok: true }));
    });
    vi.stubGlobal("fetch", nativeLikeFetch);
    try {
      const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
        request<T>(options: Record<string, unknown>): Promise<T>;
      };
      const client = new ApiClient({ baseUrl: "https://beta.test" });

      await expect(client.request({
        path: "/api/v2/health",
        requestClass: "query",
        policy: { timeoutMs: 1_000, retry: 0 },
      })).resolves.toEqual({ ok: true });
      expect(nativeLikeFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps JSON serialization as the default body mode", async () => {
    const web = await loadWeb();
    const fetchImpl = vi.fn(async () => success({ saved: true }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ fetchImpl });

    await client.request({
      path: "/api/v2/profile",
      method: "PATCH",
      body: { display_name: "Updated" },
      requestClass: "command",
      policy: { timeoutMs: 1_000, retry: 0 },
    });

    expect(fetchImpl).toHaveBeenCalledWith("/api/v2/profile", expect.objectContaining({
      body: JSON.stringify({ display_name: "Updated" }),
      headers: expect.objectContaining({ "content-type": "application/json" }),
    }));
  });

  it("sends a raw avatar body unchanged without overwriting its content type", async () => {
    const web = await loadWeb();
    const fetchImpl = vi.fn(async () => success({ uploaded: true }));
    const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
      request<T>(options: Record<string, unknown>): Promise<T>;
    };
    const client = new ApiClient({ fetchImpl });
    const file = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });

    await client.request({
      path: "/api/v2/profile/avatar",
      method: "POST",
      body: file,
      bodyMode: "raw",
      headers: { "content-type": "image/png" },
      requestClass: "command",
      policy: { timeoutMs: 8_000, retry: 0, idempotencyKey: "avatar-1" },
    });

    expect(fetchImpl).toHaveBeenCalledWith("/api/v2/profile/avatar", expect.objectContaining({
      body: file,
      credentials: "include",
      headers: expect.objectContaining({
        "content-type": "image/png",
        "idempotency-key": "avatar-1",
      }),
    }));
  });

  it("preserves timeout and external abort propagation for raw bodies", async () => {
    vi.useFakeTimers();
    try {
      const web = await loadWeb();
      let requestSignal: AbortSignal | undefined;
      const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        requestSignal = init.signal as AbortSignal;
        requestSignal.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
      }));
      const ApiClient = web.ApiClient as new (options: Record<string, unknown>) => {
        request<T>(options: Record<string, unknown>): Promise<T>;
      };
      const client = new ApiClient({ fetchImpl });
      const controller = new AbortController();
      const request = client.request({
        path: "/api/v2/profile/avatar",
        method: "POST",
        body: new Blob(["avatar"], { type: "image/png" }),
        bodyMode: "raw",
        requestClass: "command",
        policy: { timeoutMs: 15_000, retry: 0, signal: controller.signal },
      });

      controller.abort(new DOMException("Cancelled", "AbortError"));
      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      expect(requestSignal?.aborted).toBe(true);

      const timedOut = client.request({
        path: "/api/v2/profile/avatar",
        method: "POST",
        body: new Blob(["avatar"], { type: "image/png" }),
        bodyMode: "raw",
        requestClass: "command",
        policy: { timeoutMs: 15_000, retry: 0 },
      });
      const timeoutAssertion = expect(timedOut).rejects.toMatchObject({ code: "TIMEOUT" });
      await vi.advanceTimersByTimeAsync(15_000);
      await timeoutAssertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
