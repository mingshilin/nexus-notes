import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src")) as WorkerExports;
}

describe("D1GraphRepository", () => {
  it("builds unique global and local graph nodes from workspace-scoped links", async () => {
    const worker = await loadWorker();
    expect(worker.D1GraphRepository).toBeTypeOf("function");
    const statement = { bind: vi.fn(), all: vi.fn(async () => ({ results: [
      { source: "note-1", target: "note-2", source_title: "One", target_title: "Two" },
      { source: "note-1", target: "note-3", source_title: "One", target_title: "Three" },
    ] })) };
    statement.bind.mockReturnValue(statement);
    const db = { prepare: vi.fn(() => statement) };
    const Repository = worker.D1GraphRepository as new (db: unknown) => any;
    const repository = new Repository(db);

    const graph = await repository.getGraph("ws-1", "note-1");

    expect(graph.nodes).toEqual([
      { id: "note-1", title: "One", is_current: true },
      { id: "note-2", title: "Two", is_current: false },
      { id: "note-3", title: "Three", is_current: false },
    ]);
    expect(graph.edges).toHaveLength(2);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringMatching(/note_links[\s\S]*workspace_id = \?/i));
    expect(statement.bind).toHaveBeenCalledWith("ws-1", "note-1", "note-1");
  });
});
