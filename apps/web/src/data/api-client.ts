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
  headers?: Record<string, string>;
  requestClass: RequestClass;
  policy: RequestPolicy;
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

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly activeQueries = new Map<string, Promise<unknown>>();

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, "") ?? "";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  request<T>(options: ApiRequestOptions): Promise<T> {
    const dedupeKey = options.requestClass === "query" ? options.policy.dedupeKey : undefined;
    if (dedupeKey) {
      const active = this.activeQueries.get(dedupeKey);
      if (active) return active as Promise<T>;
    }

    const promise = this.execute<T>(options);
    if (!dedupeKey) return promise;

    this.activeQueries.set(dedupeKey, promise);
    return promise.finally(() => {
      if (this.activeQueries.get(dedupeKey) === promise) this.activeQueries.delete(dedupeKey);
    });
  }

  private async execute<T>(options: ApiRequestOptions): Promise<T> {
    const method = options.method ?? "GET";
    const canRetry = options.requestClass === "query" || Boolean(options.policy.idempotencyKey);
    const retryCount = canRetry ? options.policy.retry : 0;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const attemptSignal = createAttemptSignal(options.policy.timeoutMs, options.policy.signal);
      try {
        const headers: Record<string, string> = {
          accept: "application/json",
          ...options.headers,
        };
        if (options.body !== undefined) headers["content-type"] = "application/json";
        if (options.policy.idempotencyKey) headers["idempotency-key"] = options.policy.idempotencyKey;

        const response = await this.fetchImpl(`${this.baseUrl}${options.path}`, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
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

  private waitBeforeRetry(attempt: number) {
    const delay = Math.min(1_000, 100 * 2 ** attempt + Math.floor(this.random() * 100));
    return this.sleep(delay);
  }
}
