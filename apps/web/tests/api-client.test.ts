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
