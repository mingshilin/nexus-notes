import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";

type WebExports = Record<string, unknown>;

async function loadWeb() {
  return (await import("../src/index")) as WebExports;
}

const stores: Array<{ destroy(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.destroy()));
});

describe("SyncEngine", () => {
  it("pushes in order, preserves conflicts, applies pulls, and advances the cursor last", async () => {
    const web = await loadWeb();
    expect(web.BetaLocalStore).toBeTypeOf("function");
    expect(web.SyncEngine).toBeTypeOf("function");
    const Store = web.BetaLocalStore as new (options: Record<string, unknown>) => any;
    const Engine = web.SyncEngine as new (options: Record<string, unknown>) => {
      sync(workspaceId: string): Promise<Record<string, unknown>>;
    };
    const store = new Store({ databaseName: `nexus-sync-${crypto.randomUUID()}` });
    stores.push(store);
    await store.enqueueOperation({ operation_id: "op-1", workspace_id: "ws-1", entity_type: "note", entity_id: "note-1", base_revision: 1, kind: "update", patch: { title: "A" }, created_at: "2026-08-20T15:01:00.000Z" });
    await store.enqueueOperation({ operation_id: "op-2", workspace_id: "ws-1", entity_type: "note", entity_id: "note-2", base_revision: 1, kind: "update", patch: { title: "B" }, created_at: "2026-08-20T15:02:00.000Z" });
    const applyChange = vi.fn(async () => undefined);
    const onConflict = vi.fn();
    const transport = {
      push: vi.fn(async (_workspaceId: string, operations: Array<Record<string, unknown>>) => ({
        operations: operations.map((operation) => ({
          operation_id: operation.operation_id,
          status: operation.operation_id === "op-1" ? "applied" : "conflict",
          revision: operation.operation_id === "op-1" ? 2 : undefined,
        })),
        next_cursor: "cursor-8",
      })),
      pull: vi.fn(async () => ({
        changes: [{ cursor: "cursor-9", entity_type: "note", entity_id: "note-3", revision: 1, kind: "create", payload: { title: "Remote" } }],
        next_cursor: "cursor-9",
      })),
    };
    const engine = new Engine({ store, transport, applyChange, onConflict });

    const result = await engine.sync("ws-1");

    expect(transport.push.mock.calls[0]?.[1].map((operation: Record<string, unknown>) => operation.operation_id)).toEqual(["op-1", "op-2"]);
    expect((await store.listOperations("ws-1")).map((operation: Record<string, unknown>) => operation.operation_id)).toEqual(["op-2"]);
    expect(onConflict).toHaveBeenCalledWith(
      expect.objectContaining({ operation_id: "op-2" }),
      expect.objectContaining({ operation_id: "op-2", status: "conflict" }),
    );
    expect(applyChange).toHaveBeenCalledOnce();
    expect(await store.getSyncCursor("ws-1")).toBe("cursor-9");
    expect(result).toMatchObject({ pushed: 2, applied: 1, conflicts: 1, pulled: 1 });
  });

  it("keeps local operations when push fails", async () => {
    const web = await loadWeb();
    const Store = web.BetaLocalStore as new (options: Record<string, unknown>) => any;
    const Engine = web.SyncEngine as new (options: Record<string, unknown>) => { sync(workspaceId: string): Promise<unknown> };
    const store = new Store({ databaseName: `nexus-sync-fail-${crypto.randomUUID()}` });
    stores.push(store);
    await store.enqueueOperation({ operation_id: "op-1", workspace_id: "ws-1", entity_type: "note", entity_id: "note-1", base_revision: 1, kind: "update", patch: {}, created_at: "2026-08-20T15:01:00.000Z" });
    const engine = new Engine({
      store,
      transport: { push: async () => { throw new Error("SESSION_EXPIRED"); }, pull: vi.fn() },
      applyChange: vi.fn(),
      onConflict: vi.fn(),
    });

    await expect(engine.sync("ws-1")).rejects.toThrow("SESSION_EXPIRED");
    expect(await store.listOperations("ws-1")).toHaveLength(1);
  });
});
