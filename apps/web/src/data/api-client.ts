import type {
  ApiErrorPayload,
  ApiResponse,
  AiActionExecutionResult,
  RequestClass,
  RequestPolicy,
} from "@nexus/contracts";

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export interface ApiRequestOptions {
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  bodyMode?: "json" | "raw";
  headers?: Record<string, string>;
  requestClass: RequestClass;
  policy: RequestPolicy;
}

export interface ApiDownloadOptions {
  path: string;
  headers?: Record<string, string>;
  requestClass: "query";
  policy: RequestPolicy;
}

export interface ConfirmAiActionResult {
  action: AiActionExecutionResult;
}

export interface RejectAiActionResult {
  action: {
    rejected: true;
  };
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly details?: Record<string, unknown>;

  constructor(error: Partial<ApiErrorPayload> & { code: string; message: string }, status?: number) {
    super(error.message);
    this.name = "ApiClientError";
    this.code = error.code;
    this.requestId = error.request_id;
    this.retryable = error.retryable ?? false;
    this.status = status;
    this.details = error.details;
  }
}

function canonicalizeHeaders(headers: Record<string, string> | undefined) {
  const canonical = Object.create(null) as Record<string, string>;
  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = name.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(canonical, key) && canonical[key] !== value) {
      throw new ApiClientError({
        code: "INVALID_REQUEST",
        message: `Conflicting ${key} headers`,
        retryable: false,
      });
    }
    canonical[key] = value;
  }
  return canonical;
}

const retryableStatuses = new Set([408, 429]);

function isRetryableStatus(status: number) {
  return retryableStatuses.has(status) || status >= 500;
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function createAttemptSignal(timeoutMs: number, external?: AbortSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(external?.reason);
  if (external?.aborted) controller.abort(external.reason);
  else external?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

async function readResponse<T>(response: Response): Promise<ApiResponse<T>> {
  try {
    return await response.json() as ApiResponse<T>;
  } catch {
    throw new ApiClientError(
      { code: "INVALID_RESPONSE", message: "Server returned invalid JSON", retryable: response.status >= 500 },
      response.status,
    );
  }
}

function assertDataProperties(value: object) {
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (descriptor.enumerable && !("value" in descriptor)) {
      throw new TypeError("Cannot safely canonicalize accessor-backed JSON value");
    }
  }
}

function normalizeJsonValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.prototype.hasOwnProperty.call(value, "toJSON")) {
      throw new TypeError("Cannot safely canonicalize custom array JSON value");
    }
    assertDataProperties(value);
    if (seen.has(value)) throw new TypeError("Cannot normalize cyclic JSON value");
    seen.add(value);
    const normalized = value.map((item) => item === undefined ? null : normalizeJsonValue(item, seen));
    seen.delete(value);
    return normalized;
  }
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) {
    if (Object.getPrototypeOf(value) !== Date.prototype || Object.prototype.hasOwnProperty.call(value, "toJSON")) {
      throw new TypeError("Cannot safely canonicalize custom date JSON value");
    }
    return value.toJSON();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Cannot safely canonicalize custom JSON object");
  }
  if (Object.prototype.hasOwnProperty.call(value, "toJSON") || typeof (Object.prototype as { toJSON?: unknown }).toJSON === "function") {
    throw new TypeError("Cannot safely canonicalize custom JSON serialization");
  }
  assertDataProperties(value);
  if (seen.has(value)) throw new TypeError("Cannot normalize cyclic JSON value");

  seen.add(value);
  const normalized = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeJsonValue(entry, seen)]),
  );
  seen.delete(value);
  return normalized;
}

function stableJson(value: unknown) {
  return JSON.stringify(normalizeJsonValue(value));
}

interface PreparedApiRequest {
  path: string;
  method: NonNullable<ApiRequestOptions["method"]>;
  headers: Record<string, string>;
  requestBody?: BodyInit;
  requestClass: RequestClass;
  canRetry: boolean;
  timeoutMs: number;
  retry: RequestPolicy["retry"];
  signal?: AbortSignal;
  activeQueryKey?: string;
}

function preparationError(error: unknown) {
  if (error instanceof ApiClientError) return error;
  return new ApiClientError({
    code: "NETWORK_ERROR",
    message: "Network request failed",
    retryable: true,
  });
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly activeQueries = new Map<string, Array<{ promise: Promise<unknown>; signal?: AbortSignal }>>();

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, "") ?? "";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  request<T>(options: ApiRequestOptions): Promise<T> {
    let prepared: PreparedApiRequest;
    try {
      prepared = this.prepareRequest(options);
    } catch (error) {
      return Promise.reject(preparationError(error));
    }
    const dedupeKey = prepared.activeQueryKey;
    if (dedupeKey) {
      const activeQueries = this.activeQueries.get(dedupeKey)?.filter((active) => !active.signal?.aborted) ?? [];
      const active = activeQueries.find((query) => query.signal === prepared.signal);
      if (active) return active.promise as Promise<T>;
      if (activeQueries.length > 0) this.activeQueries.set(dedupeKey, activeQueries);
      else this.activeQueries.delete(dedupeKey);
    }

    const promise = this.execute<T>(prepared);
    if (!dedupeKey) return promise;

    const active = { promise, signal: prepared.signal };
    const activeQueries = this.activeQueries.get(dedupeKey) ?? [];
    activeQueries.push(active);
    this.activeQueries.set(dedupeKey, activeQueries);
    return promise.finally(() => {
      const activeQueries = this.activeQueries.get(dedupeKey);
      if (!activeQueries) return;
      const remaining = activeQueries.filter((query) => query !== active);
      if (remaining.length > 0) this.activeQueries.set(dedupeKey, remaining);
      else this.activeQueries.delete(dedupeKey);
    });
  }

  download(options: ApiDownloadOptions): Promise<Blob> {
    return this.executeDownload(options);
  }

  confirmAiAction(workspaceId: string, actionId: string, baseRevision: number) {
    return this.request<ConfirmAiActionResult>({
      path: `/api/v2/ai/actions/${encodeURIComponent(actionId)}/confirm`,
      method: "POST",
      headers: { "x-workspace-id": workspaceId },
      body: { action_id: actionId, base_revision: baseRevision },
      requestClass: "command",
      policy: { timeoutMs: 12_000, retry: 0, idempotencyKey: crypto.randomUUID() },
    });
  }

  rejectAiAction(workspaceId: string, actionId: string, baseRevision: number) {
    return this.request<RejectAiActionResult>({
      path: `/api/v2/ai/actions/${encodeURIComponent(actionId)}/reject`,
      method: "POST",
      headers: { "x-workspace-id": workspaceId },
      body: { action_id: actionId, base_revision: baseRevision },
      requestClass: "command",
      policy: { timeoutMs: 12_000, retry: 0, idempotencyKey: crypto.randomUUID() },
    });
  }

  private prepareRequest(options: ApiRequestOptions): PreparedApiRequest {
    const path = options.path;
    const method = options.method ?? "GET";
    const requestClass = options.requestClass;
    const body = options.body;
    const bodyMode = options.bodyMode ?? "json";
    const policy = options.policy;
    const { timeoutMs, retry, dedupeKey, idempotencyKey, signal } = policy;
    const canonicalHeaders = canonicalizeHeaders(options.headers);
    const headers: Record<string, string> = { accept: "application/json", ...canonicalHeaders };
    if (body !== undefined && bodyMode === "json") headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

    let requestBody: BodyInit | undefined;
    let bodyKey = body === undefined ? "" : undefined;
    if (body !== undefined && bodyMode === "raw") {
      requestBody = body as BodyInit;
    } else if (body !== undefined) {
      if (requestClass === "query" && dedupeKey) {
        try {
          const canonicalBody = stableJson(body);
          if (typeof canonicalBody === "string") {
            bodyKey = canonicalBody;
            requestBody = canonicalBody;
          }
        } catch {
          // Custom serializers and accessors use their normal wire form without active dedupe.
        }
      }
      if (requestBody === undefined) requestBody = JSON.stringify(body);
    }

    let activeQueryKey: string | undefined;
    if (requestClass === "query" && dedupeKey && bodyKey !== undefined) {
      try {
        activeQueryKey = JSON.stringify([
          canonicalHeaders["x-workspace-id"] ?? "",
          method,
          this.normalizePath(path),
          bodyKey,
        ]);
      } catch {
        // Invalid paths remain on the normal asynchronous request error path.
      }
    }

    return {
      path,
      method,
      headers: Object.freeze(headers),
      requestBody,
      requestClass,
      canRetry: requestClass === "query" || Boolean(idempotencyKey),
      timeoutMs,
      retry,
      signal,
      activeQueryKey,
    };
  }

  private normalizePath(path: string) {
    const url = new URL(path, "https://nexus.local");
    url.searchParams.sort();
    const query = url.searchParams.toString();
    return query ? `${url.pathname}?${query}` : url.pathname;
  }

  private async execute<T>(request: PreparedApiRequest): Promise<T> {
    const retryCount = request.canRetry ? request.retry : 0;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const attemptSignal = createAttemptSignal(request.timeoutMs, request.signal);
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${request.path}`, {
          method: request.method,
          headers: request.headers,
          body: request.requestBody,
          signal: attemptSignal.signal,
          credentials: "include",
        });
        const envelope = await readResponse<T>(response);
        if (response.ok && envelope.success) return envelope.data;

        const payload = envelope.success
          ? { code: "HTTP_ERROR", message: `Request failed with ${response.status}`, retryable: isRetryableStatus(response.status) }
          : envelope.error;
        if (attempt < retryCount && isRetryableStatus(response.status)) {
          await this.waitBeforeRetry(attempt);
          continue;
        }
        throw new ApiClientError(payload, response.status);
      } catch (error) {
        if (error instanceof ApiClientError) throw error;
        if (request.signal?.aborted) throw error;
        if (attempt < retryCount) {
          await this.waitBeforeRetry(attempt);
          continue;
        }
        throw new ApiClientError({
          code: attemptSignal.signal.reason?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR",
          message: attemptSignal.signal.reason?.name === "TimeoutError" ? "Request timed out" : "Network request failed",
          retryable: true,
        });
      } finally {
        attemptSignal.dispose();
      }
    }

    throw new ApiClientError({ code: "UNREACHABLE", message: "Request did not complete", retryable: false });
  }

  private async executeDownload(options: ApiDownloadOptions): Promise<Blob> {
    const path = options.path;
    const { retry: retryCount, timeoutMs, signal } = options.policy;
    const headers = Object.freeze({ accept: "application/octet-stream", ...canonicalizeHeaders(options.headers) });
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const attemptSignal = createAttemptSignal(timeoutMs, signal);
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: "GET",
          headers,
          signal: attemptSignal.signal,
          credentials: "include",
        });
        if (response.ok) return await response.blob();
        const envelope = await readResponse<unknown>(response);
        const payload = envelope.success
          ? { code: "HTTP_ERROR", message: `Request failed with ${response.status}`, retryable: isRetryableStatus(response.status) }
          : envelope.error;
        if (attempt < retryCount && isRetryableStatus(response.status)) {
          await this.waitBeforeRetry(attempt);
          continue;
        }
        throw new ApiClientError(payload, response.status);
      } catch (error) {
        if (error instanceof ApiClientError) throw error;
        if (signal?.aborted) throw error;
        if (attempt < retryCount) {
          await this.waitBeforeRetry(attempt);
          continue;
        }
        throw new ApiClientError({
          code: attemptSignal.signal.reason?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR",
          message: attemptSignal.signal.reason?.name === "TimeoutError" ? "Request timed out" : "Network request failed",
          retryable: true,
        });
      } finally {
        attemptSignal.dispose();
      }
    }
    throw new ApiClientError({ code: "UNREACHABLE", message: "Download did not complete", retryable: false });
  }

  private waitBeforeRetry(attempt: number) {
    const delay = Math.min(1_000, 100 * 2 ** attempt + Math.floor(this.random() * 100));
    return this.sleep(delay);
  }
}
