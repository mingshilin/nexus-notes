import type {
  ApiErrorPayload,
  ApiResponse,
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
  action: {
    action_id: string;
    revision?: number;
    status?: string;
  };
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

function normalizeJsonValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Cannot normalize cyclic JSON value");
    seen.add(value);
    const normalized = value.map((item) => item === undefined ? null : normalizeJsonValue(item, seen));
    seen.delete(value);
    return normalized;
  }
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value.toJSON();
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

function hashString(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
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
    const dedupeKey = options.requestClass === "query" ? this.createActiveQueryKey(options) : undefined;
    if (dedupeKey) {
      const activeQueries = this.activeQueries.get(dedupeKey)?.filter((active) => !active.signal?.aborted) ?? [];
      const active = activeQueries.find((query) => query.signal === options.policy.signal);
      if (active) return active.promise as Promise<T>;
      if (activeQueries.length > 0) this.activeQueries.set(dedupeKey, activeQueries);
      else this.activeQueries.delete(dedupeKey);
    }

    const promise = this.execute<T>(options);
    if (!dedupeKey) return promise;

    const active = { promise, signal: options.policy.signal };
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

  private createActiveQueryKey(options: ApiRequestOptions) {
    const bodyKey = this.normalizeBody(options.body, options.bodyMode);
    if (bodyKey === undefined) return undefined;
    const workspaceId = options.headers?.["x-workspace-id"] ?? "";
    return [
      workspaceId,
      options.method ?? "GET",
      this.normalizePath(options.path),
      bodyKey,
    ].join("\n");
  }

  private normalizePath(path: string) {
    const url = new URL(path, "https://nexus.local");
    url.searchParams.sort();
    const query = url.searchParams.toString();
    return query ? `${url.pathname}?${query}` : url.pathname;
  }

  private normalizeBody(body: unknown, bodyMode: ApiRequestOptions["bodyMode"]) {
    if (body === undefined) return "";
    if (bodyMode === "raw") return undefined;
    try {
      const serialized = stableJson(body);
      return `${serialized.length}:${hashString(serialized)}`;
    } catch {
      return undefined;
    }
  }

  private async execute<T>(options: ApiRequestOptions): Promise<T> {
    const method = options.method ?? "GET";
    const canRetry = options.requestClass === "query" || Boolean(options.policy.idempotencyKey);
    const retryCount = canRetry ? options.policy.retry : 0;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const attemptSignal = createAttemptSignal(options.policy.timeoutMs, options.policy.signal);
      try {
        const bodyMode = options.bodyMode ?? "json";
        const headers: Record<string, string> = {
          accept: "application/json",
          ...options.headers,
        };
        if (options.body !== undefined && bodyMode === "json") headers["content-type"] = "application/json";
        if (options.policy.idempotencyKey) headers["idempotency-key"] = options.policy.idempotencyKey;
        const requestBody = options.body === undefined
          ? undefined
          : bodyMode === "raw"
            ? options.body as BodyInit
            : JSON.stringify(options.body);

        const response = await this.fetchImpl(`${this.baseUrl}${options.path}`, {
          method,
          headers,
          body: requestBody,
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
        if (options.policy.signal?.aborted) throw error;
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
    const retryCount = options.policy.retry;
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const attemptSignal = createAttemptSignal(options.policy.timeoutMs, options.policy.signal);
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${options.path}`, {
          method: "GET",
          headers: { accept: "application/octet-stream", ...options.headers },
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
        if (options.policy.signal?.aborted) throw error;
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
