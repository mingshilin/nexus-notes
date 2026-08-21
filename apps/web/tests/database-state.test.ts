import { describe, expect, it, vi } from "vitest";

async function loadData() {
  return await import("../src/data") as Record<string, any>;
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("database web state", () => {
  it("persists pagination independently by workspace, database, and view", async () => {
    const data = await loadData();
    expect(data.DatabasePaginationStore).toBeTypeOf("function");
    const storage = memoryStorage();
    const store = new data.DatabasePaginationStore(storage);
    store.write("ws-1", "db-1", "view-table", { page: 3, pageSize: 25, cursors: { 1: null, 2: "cursor-1", 3: "cursor-3" } });
    store.write("ws-1", "db-1", "view-board", { page: 1, pageSize: 50, cursors: { 1: null } });

    const restored = new data.DatabasePaginationStore(storage);
    expect(restored.read("ws-1", "db-1", "view-table")).toEqual({ page: 3, pageSize: 25, cursors: { 1: null, 2: "cursor-1", 3: "cursor-3" } });
    expect(restored.read("ws-1", "db-1", "view-board")).toEqual({ page: 1, pageSize: 50, cursors: { 1: null } });
    expect(restored.read("ws-2", "db-1", "view-table")).toBeNull();
  });

  it("restores the exact optimistic snapshot on command failure", async () => {
    const data = await loadData();
    expect(data.runOptimisticMutation).toBeTypeOf("function");
    let state = [{ id: "record-1", status: "todo" }];
    const restore = vi.fn((snapshot) => { state = snapshot; });

    await expect(data.runOptimisticMutation({
      snapshot: () => structuredClone(state),
      apply: () => { state = [{ id: "record-1", status: "done" }]; },
      command: async () => { throw new Error("denied"); },
      restore,
    })).rejects.toThrow("denied");

    expect(state).toEqual([{ id: "record-1", status: "todo" }]);
    expect(restore).toHaveBeenCalledOnce();
  });
});
