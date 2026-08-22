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
    const request = {
      path: "/api/v2/notes",
      requestClass: "query",
      policy: { timeoutMs: 1_000, retry: 0, dedupeKey: "notes:ws-1" },
    };

    const first = client.request(request);
    const second = client.request(request);
    resolveFetch(success({ items: [] }));

    await expect(first).resolves.toEqual({ items: [] });
    await expect(second).resolves.toEqual({ items: [] });
    expect(fetchImpl).toHaveBeenCalledOnce();
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
});
