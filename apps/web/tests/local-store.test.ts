import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";

type WebExports = Record<string, unknown>;

async function loadWeb() {
  return (await import("../src/index")) as WebExports;
}

const stores: Array<{ destroy(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.destroy()));
});

describe("BetaLocalStore", () => {
  it("persists drafts, ordered operations, and sync cursors", async () => {
    const web = await loadWeb();
    expect(web.BetaLocalStore).toBeTypeOf("function");
    const Store = web.BetaLocalStore as new (options: Record<string, unknown>) => {
      saveDraft(draft: Record<string, unknown>): Promise<void>;
      getDraft(workspaceId: string, entityId: string): Promise<Record<string, unknown> | null>;
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
});
