import { describe, expect, it, vi } from "vitest";
import {
  clearWorkspaceQueryCache,
  WorkspaceQueryCache,
  workspaceQueryCacheFor,
} from "../src/data/workspace-query-cache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const key = {
  userId: "user-1",
  workspaceId: "workspace-1",
  domain: "databases" as const,
  query: "bootstrap:first:50",
};

describe("WorkspaceQueryCache", () => {
  it("shares one loader request while keeping caller aborts isolated", async () => {
    const pending = deferred<string>();
    const loader = vi.fn(() => pending.promise);
    const cache = new WorkspaceQueryCache({ now: () => 1_000 });
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = cache.get(key, loader, { ttlMs: 60_000, signal: firstController.signal });
    const second = cache.get(key, loader, { ttlMs: 60_000, signal: secondController.signal });

    expect(loader).toHaveBeenCalledOnce();
    firstController.abort();
    pending.resolve("fresh");

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toBe("fresh");
  });

  it("returns stale data immediately and performs only one background refresh", async () => {
    let now = 1_000;
    const refresh = deferred<string>();
    const loader = vi.fn()
      .mockResolvedValueOnce("initial")
      .mockReturnValueOnce(refresh.promise);
    const cache = new WorkspaceQueryCache({ now: () => now });

    await expect(cache.get(key, loader, { ttlMs: 100 })).resolves.toBe("initial");
    now = 1_101;
    const staleReads = [
      cache.get(key, loader, { ttlMs: 100 }),
      cache.get(key, loader, { ttlMs: 100 }),
      cache.get(key, loader, { ttlMs: 100 }),
    ];

    await expect(Promise.all(staleReads)).resolves.toEqual(["initial", "initial", "initial"]);
    expect(loader).toHaveBeenCalledTimes(2);

    refresh.resolve("updated");
    await refresh.promise;
    await Promise.resolve();
    await Promise.resolve();
    await expect(cache.get(key, loader, { ttlMs: 100 })).resolves.toBe("updated");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not commit a response that belongs to an invalidated cache generation", async () => {
    const oldRequest = deferred<string>();
    const newRequest = deferred<string>();
    const loader = vi.fn()
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const cache = new WorkspaceQueryCache({ now: () => 1_000 });

    const old = cache.get(key, loader, { ttlMs: 60_000 });
    cache.invalidate({ workspaceId: key.workspaceId });
    const next = cache.get(key, loader, { ttlMs: 60_000 });

    newRequest.resolve("new");
    await expect(next).resolves.toBe("new");
    oldRequest.resolve("old");
    await expect(old).resolves.toBe("old");

    await expect(cache.get(key, loader, { ttlMs: 60_000 })).resolves.toBe("new");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keeps unrelated in-flight domains cacheable after scoped invalidation", async () => {
    const notesRequest = deferred<string>();
    const databaseRequest = deferred<string>();
    const cache = new WorkspaceQueryCache({ now: () => 1_000 });
    const databaseKey = { ...key, domain: "databases" as const, query: "list" };
    const notesKey = { ...key, domain: "notes" as const, query: "list" };
    const databaseLoader = vi.fn(() => databaseRequest.promise);

    const notes = cache.get(notesKey, () => notesRequest.promise, { ttlMs: 60_000 });
    const database = cache.get(databaseKey, databaseLoader, { ttlMs: 60_000 });
    cache.invalidate({ workspaceId: key.workspaceId, domain: "notes" });

    databaseRequest.resolve("database-value");
    notesRequest.resolve("notes-value");
    await expect(database).resolves.toBe("database-value");
    await expect(notes).resolves.toBe("notes-value");
    await expect(cache.get(databaseKey, databaseLoader, { ttlMs: 60_000 })).resolves.toBe("database-value");
    expect(databaseLoader).toHaveBeenCalledOnce();
  });

  it("does not share values across users, workspaces, domains, or queries", async () => {
    const loader = vi.fn(async (value: string) => value);
    const cache = new WorkspaceQueryCache({ now: () => 1_000 });

    await cache.get(key, () => loader("user-1"), { ttlMs: 60_000 });
    await cache.get({ ...key, userId: "user-2" }, () => loader("user-2"), { ttlMs: 60_000 });
    await cache.get({ ...key, workspaceId: "workspace-2" }, () => loader("workspace-2"), { ttlMs: 60_000 });
    await cache.get({ ...key, domain: "notes" }, () => loader("notes"), { ttlMs: 60_000 });
    await cache.get({ ...key, query: "bootstrap:second:50" }, () => loader("second-query"), { ttlMs: 60_000 });

    expect(loader).toHaveBeenCalledTimes(5);
  });

  it("keeps one cache per API client and supports scoped invalidation", async () => {
    const apiClient = {};
    const otherApiClient = {};
    const first = workspaceQueryCacheFor(apiClient);
    const same = workspaceQueryCacheFor(apiClient);
    const other = workspaceQueryCacheFor(otherApiClient);
    const loader = vi.fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("after-clear");

    expect(same).toBe(first);
    expect(other).not.toBe(first);
    await expect(first.get(key, loader, { ttlMs: 60_000 })).resolves.toBe("first");
    clearWorkspaceQueryCache(apiClient, { userId: key.userId, workspaceId: key.workspaceId });
    await expect(first.get(key, loader, { ttlMs: 60_000 })).resolves.toBe("after-clear");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("reports bounded cache metrics without exposing query or tenant identifiers", async () => {
    const events: Array<Record<string, unknown>> = [];
    const cache = new WorkspaceQueryCache({ onEvent: (event) => events.push(event) });
    await cache.get(key, async () => "value", { ttlMs: 60_000 });
    await cache.get(key, async () => "unused", { ttlMs: 60_000 });

    expect(cache.metrics()).toEqual(expect.objectContaining({ misses: 1, hits: 1, commits: 1 }));
    expect(events.some((event) => "query" in event || "userId" in event || "workspaceId" in event)).toBe(false);
  });
});
