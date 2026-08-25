import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";

type WebExports = Record<string, unknown>;

async function loadWeb() {
  return (await import("../src/index")) as WebExports;
}

const stores: Array<{ destroy(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.destroy()));
  vi.restoreAllMocks();
});

describe("BetaLocalStore", () => {
  it("reports unavailable IndexedDB as a recoverable persistence failure", async () => {
    const web = await loadWeb();
    const Store = web.BetaLocalStore as new (options: Record<string, unknown>) => {
      listDrafts(workspaceId: string): Promise<Array<Record<string, unknown>>>;
    };
    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    try {
      const store = new Store({ databaseName: `nexus-test-${crypto.randomUUID()}` });
      await expect(store.listDrafts("ws-1")).rejects.toThrow("IndexedDB is unavailable");
    } finally {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
    }
  });

  it("persists drafts, ordered operations, and sync cursors", async () => {
    const web = await loadWeb();
    expect(web.BetaLocalStore).toBeTypeOf("function");
    const Store = web.BetaLocalStore as new (options: Record<string, unknown>) => {
      saveDraft(draft: Record<string, unknown>): Promise<void>;
      mutateDraft(workspaceId: string, entityId: string, mutation: (current: Record<string, unknown> | null) => Record<string, unknown> | null | undefined): Promise<Record<string, unknown> | null>;
      getDraft(workspaceId: string, entityId: string): Promise<Record<string, unknown> | null>;
      listDrafts(workspaceId: string): Promise<Array<Record<string, unknown>>>;
      removeDraft(workspaceId: string, entityId: string): Promise<void>;
      enqueueOperation(operation: Record<string, unknown>): Promise<void>;
      listOperations(workspaceId: string): Promise<Array<Record<string, unknown>>>;
      setSyncCursor(workspaceId: string, cursor: string): Promise<void>;
      getSyncCursor(workspaceId: string): Promise<string | null>;
      destroy(): Promise<void>;
    };
    const store = new Store({ databaseName: `nexus-test-${crypto.randomUUID()}` });
    stores.push(store);

    await store.saveDraft({ workspace_id: "ws-1", entity_id: "note-1", title: "Local", content: "Draft", updated_at: "2026-08-20T15:00:00.000Z" });
    await store.enqueueOperation({ operation_id: "op-2", workspace_id: "ws-1", entity_type: "note", entity_id: "note-2", base_revision: 0, kind: "create", patch: {}, created_at: "2026-08-20T15:02:00.000Z" });
    await store.enqueueOperation({ operation_id: "op-1", workspace_id: "ws-1", entity_type: "note", entity_id: "note-1", base_revision: 1, kind: "update", patch: {}, created_at: "2026-08-20T15:01:00.000Z" });
    await store.setSyncCursor("ws-1", "cursor-7");

    expect(await store.getDraft("ws-1", "note-1")).toMatchObject({ title: "Local", content: "Draft" });
    expect((await store.listOperations("ws-1")).map((operation) => operation.operation_id)).toEqual(["op-1", "op-2"]);
    expect(await store.getSyncCursor("ws-1")).toBe("cursor-7");
  });

  it("lists only workspace drafts newest first and removes only the scoped draft", async () => {
    const web = await loadWeb();
    const Store = web.BetaLocalStore as new (options: Record<string, unknown>) => {
      saveDraft(draft: Record<string, unknown>): Promise<void>;
      getDraft(workspaceId: string, entityId: string): Promise<Record<string, unknown> | null>;
      listDrafts(workspaceId: string): Promise<Array<Record<string, unknown>>>;
      removeDraft(workspaceId: string, entityId: string): Promise<void>;
      destroy(): Promise<void>;
    };
    const store = new Store({ databaseName: `nexus-test-${crypto.randomUUID()}` });
    stores.push(store);

    await store.saveDraft({ workspace_id: "ws-1", entity_id: "shared-id", title: "Older", content: "one", updated_at: "2026-08-22T00:00:00.000Z" });
    await store.saveDraft({ workspace_id: "ws-1", entity_id: "newest", title: "Newest", content: "two", updated_at: "2026-08-22T00:02:00.000Z" });
    await store.saveDraft({ workspace_id: "ws-1", entity_id: "tie-z", title: "Tie Z", content: "four", updated_at: "2026-08-22T00:04:00.000Z" });
    await store.saveDraft({ workspace_id: "ws-1", entity_id: "tie-a", title: "Tie A", content: "five", updated_at: "2026-08-22T00:04:00.000Z" });
    await store.saveDraft({ workspace_id: "ws-2", entity_id: "shared-id", title: "Other workspace", content: "three", updated_at: "2026-08-22T00:03:00.000Z" });

    expect((await store.listDrafts("ws-1")).map((draft) => draft.entity_id)).toEqual(["tie-z", "tie-a", "newest", "shared-id"]);

    await store.removeDraft("ws-1", "shared-id");

    expect(await store.getDraft("ws-1", "shared-id")).toBeNull();
    expect(await store.getDraft("ws-2", "shared-id")).toMatchObject({ title: "Other workspace" });
  });

  it("atomically applies conditional draft mutations without overwriting a newer intent", async () => {
    const web = await loadWeb();
    const Store = web.BetaLocalStore as new (options: Record<string, unknown>) => {
      saveDraft(draft: Record<string, unknown>): Promise<void>;
      mutateDraft(workspaceId: string, entityId: string, mutation: (current: Record<string, unknown> | null) => Record<string, unknown> | null | undefined): Promise<Record<string, unknown> | null>;
      getDraft(workspaceId: string, entityId: string): Promise<Record<string, unknown> | null>;
      destroy(): Promise<void>;
    };
    const store = new Store({ databaseName: `nexus-test-${crypto.randomUUID()}` });
    stores.push(store);

    await store.saveDraft({ workspace_id: "ws-1", entity_id: "draft-1", title: "Initial", content: "Body", updated_at: "2026-08-22T00:00:00.000Z" });
    await expect(store.mutateDraft("ws-1", "draft-1", (current) => ({ ...current!, title: "Newer", pending_patch: { idempotency_key: "key-b" } }))).resolves.toMatchObject({ title: "Newer" });

    await expect(store.mutateDraft("ws-1", "draft-1", (current) => current?.pending_patch?.idempotency_key === "key-a"
      ? { ...current, title: "Old response" }
      : undefined)).resolves.toMatchObject({ title: "Newer", pending_patch: { idempotency_key: "key-b" } });
    expect(await store.getDraft("ws-1", "draft-1")).toMatchObject({ title: "Newer", pending_patch: { idempotency_key: "key-b" } });
  });

  it("destroys the IndexedDB database and reopens without user-scoped records", async () => {
    const web = await loadWeb();
    const Store = web.BetaLocalStore as new (options: Record<string, unknown>) => {
      saveDraft(draft: Record<string, unknown>): Promise<void>;
      listDrafts(workspaceId: string): Promise<Array<Record<string, unknown>>>;
      destroy(): Promise<void>;
    };
    const databaseName = `nexus-test-${crypto.randomUUID()}`;
    const store = new Store({ databaseName });
    await store.saveDraft({ workspace_id: "ws-1", entity_id: "draft-1", title: "Private", content: "Local", updated_at: "2026-08-23T00:00:00.000Z" });

    await expect(store.destroy()).resolves.toBeUndefined();

    const reopened = new Store({ databaseName });
    stores.push(reopened);
    await expect(reopened.listDrafts("ws-1")).resolves.toEqual([]);
  });

  it("reports a fake-indexeddb blocked delete while another connection remains open", async () => {
    const web = await loadWeb();
    const Store = web.BetaLocalStore as new (options: Record<string, unknown>) => {
      saveDraft(draft: Record<string, unknown>): Promise<void>;
      listDrafts(workspaceId: string): Promise<Array<Record<string, unknown>>>;
      destroy(): Promise<void>;
    };
    const databaseName = `nexus-test-${crypto.randomUUID()}`;
    const store = new Store({ databaseName });
    await store.saveDraft({ workspace_id: "ws-1", entity_id: "draft-1", title: "Private", content: "Local", updated_at: "2026-08-23T00:00:00.000Z" });
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await expect(store.destroy()).rejects.toThrow("IndexedDB database deletion was blocked");
    blocker.close();

    const reopened = new Store({ databaseName });
    stores.push(reopened);
    await expect(reopened.listDrafts("ws-1")).resolves.toEqual([]);
  });

  it("reports an IndexedDB delete request failure", async () => {
    const web = await loadWeb();
    const Store = web.BetaLocalStore as new (options: Record<string, unknown>) => {
      saveDraft(draft: Record<string, unknown>): Promise<void>;
      destroy(): Promise<void>;
    };
    const store = new Store({ databaseName: `nexus-test-${crypto.randomUUID()}` });
    stores.push(store);
    await store.saveDraft({ workspace_id: "ws-1", entity_id: "draft-1", title: "Private", content: "Local", updated_at: "2026-08-23T00:00:00.000Z" });
    vi.spyOn(indexedDB, "deleteDatabase").mockImplementationOnce(() => {
      const request = {
        error: new Error("controlled delete failure"),
        onsuccess: null,
        onerror: null,
        onblocked: null,
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => request.onerror?.(new Event("error")));
      return request;
    });

    await expect(store.destroy()).rejects.toThrow("controlled delete failure");
  });
});
