import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src")) as WorkerExports;
}

const context = { workspaceId: "ws-1", userId: "user-1" };

describe("KnowledgeService", () => {
  it("forces search and saved-search operations into the caller context", async () => {
    const worker = await loadWorker();
    expect(worker.KnowledgeService).toBeTypeOf("function");
    const repository = {
      search: vi.fn(async () => ({ items: [], nextCursor: "next-1" })),
      listSavedSearches: vi.fn(async () => []),
      createSavedSearch: vi.fn(async (input) => ({ id: "saved-1", ...input })),
      deleteSavedSearch: vi.fn(async () => undefined),
    };
    const Service = worker.KnowledgeService as new (...args: any[]) => any;
    const service = new Service(repository, { clock: () => new Date("2026-08-21T00:00:00.000Z") });
    const search = { query: "Alpha", filters: {}, limit: 25 };
    const saved = { name: "Research", query: "Alpha", filters: {} };

    await expect(service.search(context, search)).resolves.toEqual({ items: [], next_cursor: "next-1" });
    await service.listSavedSearches(context);
    await service.createSavedSearch(context, saved);
    await service.deleteSavedSearch(context, "saved-1");

    expect(repository.search).toHaveBeenCalledWith("ws-1", search);
    expect(repository.listSavedSearches).toHaveBeenCalledWith("ws-1", "user-1");
    expect(repository.createSavedSearch).toHaveBeenCalledWith({
      workspaceId: "ws-1", userId: "user-1", input: saved, now: "2026-08-21T00:00:00.000Z",
    });
    expect(repository.deleteSavedSearch).toHaveBeenCalledWith("ws-1", "user-1", "saved-1");
  });
});
