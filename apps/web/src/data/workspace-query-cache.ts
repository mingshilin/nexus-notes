export type WorkspaceCacheDomain =
  | "notes"
  | "databases"
  | "knowledge"
  | "reminders"
  | "collaboration"
  | "account"
  | "ai";

export interface WorkspaceCacheKey {
  userId: string;
  workspaceId: string;
  domain: WorkspaceCacheDomain;
  query: string;
}

export interface WorkspaceQueryCacheOptions {
  now?: () => number;
  onEvent?: (event: WorkspaceQueryCacheEvent) => void;
}

export type WorkspaceQueryCacheEventKind = "hit" | "miss" | "stale" | "dedupe" | "commit" | "error";

export interface WorkspaceQueryCacheEvent {
  kind: WorkspaceQueryCacheEventKind;
  domain: WorkspaceCacheDomain;
  durationMs?: number;
}

export interface WorkspaceQueryCacheMetrics {
  hits: number;
  misses: number;
  staleReads: number;
  deduped: number;
  commits: number;
  errors: number;
}

export interface WorkspaceQueryOptions {
  ttlMs: number;
  signal?: AbortSignal;
}

interface CacheEntry<T> {
  key: WorkspaceCacheKey;
  hasValue: boolean;
  value?: T;
  expiresAt: number;
  inFlight?: Promise<T>;
}

function cacheKey(key: WorkspaceCacheKey) {
  return JSON.stringify([key.userId, key.workspaceId, key.domain, key.query]);
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

function matchesKey(key: WorkspaceCacheKey, filter: Partial<WorkspaceCacheKey>) {
  return Object.entries(filter)
    .filter(([, value]) => value !== undefined)
    .every(([field, value]) => key[field as keyof WorkspaceCacheKey] === value);
}

/**
 * Shares workspace queries without sharing a caller's cancellation signal.
 * A cancelled view can leave the request alive for another view and for the cache.
 */
export class WorkspaceQueryCache {
  private readonly now: () => number;
  private readonly onEvent?: (event: WorkspaceQueryCacheEvent) => void;
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly counts: WorkspaceQueryCacheMetrics = {
    hits: 0,
    misses: 0,
    staleReads: 0,
    deduped: 0,
    commits: 0,
    errors: 0,
  };

  constructor(options: WorkspaceQueryCacheOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.onEvent = options.onEvent;
  }

  get<T>(
    key: WorkspaceCacheKey,
    loader: (signal: AbortSignal) => Promise<T>,
    options: WorkspaceQueryOptions,
  ): Promise<T> {
    const serializedKey = cacheKey(key);
    const ttlMs = Math.max(0, Number.isFinite(options.ttlMs) ? options.ttlMs : 0);
    let entry = this.entries.get(serializedKey) as CacheEntry<T> | undefined;

    if (entry?.hasValue && entry.expiresAt > this.now()) {
      this.emit("hit", key);
      return withAbort(Promise.resolve(entry.value as T), options.signal);
    }

    if (!entry) {
      entry = {
        key,
        hasValue: false,
        expiresAt: 0,
      };
      this.entries.set(serializedKey, entry);
    }

    const hadInFlight = Boolean(entry.inFlight);
    if (hadInFlight) this.emit("dedupe", key);
    else if (entry.hasValue) this.emit("stale", key);
    const request = this.startRequest(serializedKey, entry, loader, ttlMs);
    if (entry.hasValue) {
      // Stale reads are intentionally immediate. Refresh failures keep the stale value.
      void request.catch(() => undefined);
      return withAbort(Promise.resolve(entry.value as T), options.signal);
    }
    return withAbort(request, options.signal);
  }

  invalidate(filter?: Partial<WorkspaceCacheKey>) {
    if (!filter) {
      this.entries.clear();
      return;
    }
    for (const [serializedKey, entry] of this.entries) {
      if (matchesKey(entry.key, filter)) this.entries.delete(serializedKey);
    }
  }

  clearWorkspace(workspaceId: string) {
    this.invalidate({ workspaceId });
  }

  clearUser(userId: string) {
    this.invalidate({ userId });
  }

  clear() {
    this.invalidate();
  }

  metrics(): WorkspaceQueryCacheMetrics {
    return { ...this.counts };
  }

  private startRequest<T>(
    serializedKey: string,
    entry: CacheEntry<T>,
    loader: (signal: AbortSignal) => Promise<T>,
    ttlMs: number,
  ) {
    if (entry.inFlight) return entry.inFlight;
    this.emit("miss", entry.key);
    const startedAt = this.now();
    const controller = new AbortController();
    let loaded: Promise<T>;
    try {
      // Start the fetch synchronously so an urgent navigation does not wait for a microtask.
      loaded = Promise.resolve(loader(controller.signal));
    } catch (error) {
      loaded = Promise.reject(error);
    }
    const request = loaded
      .then((value) => {
        if (this.entries.get(serializedKey) === entry) {
          entry.hasValue = true;
          entry.value = value;
          entry.expiresAt = this.now() + ttlMs;
          this.emit("commit", entry.key, this.now() - startedAt);
        }
        return value;
      })
      .catch((error: unknown) => {
        this.emit("error", entry.key, this.now() - startedAt);
        if (this.entries.get(serializedKey) === entry && !entry.hasValue) {
          this.entries.delete(serializedKey);
        }
        throw error;
      })
      .finally(() => {
        if (this.entries.get(serializedKey) === entry) entry.inFlight = undefined;
      });
    entry.inFlight = request;
    return request;
  }

  private emit(kind: WorkspaceQueryCacheEventKind, key: WorkspaceCacheKey, durationMs?: number) {
    switch (kind) {
      case "hit": this.counts.hits += 1; break;
      case "miss": this.counts.misses += 1; break;
      case "stale": this.counts.staleReads += 1; break;
      case "dedupe": this.counts.deduped += 1; break;
      case "commit": this.counts.commits += 1; break;
      case "error": this.counts.errors += 1; break;
    }
    try {
      this.onEvent?.({ kind, domain: key.domain, ...(durationMs === undefined ? {} : { durationMs: Math.max(0, durationMs) }) });
    } catch {
      // Observability must never change query behavior.
    }
  }
}

const cacheRegistry = new WeakMap<object, WorkspaceQueryCache>();

export function workspaceQueryCacheFor(apiClient: object) {
  const current = cacheRegistry.get(apiClient);
  if (current) return current;
  const created = new WorkspaceQueryCache();
  cacheRegistry.set(apiClient, created);
  return created;
}

export function clearWorkspaceQueryCache(apiClient: object, filter?: Partial<WorkspaceCacheKey>) {
  cacheRegistry.get(apiClient)?.invalidate(filter);
}
