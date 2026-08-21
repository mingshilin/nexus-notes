import { describe, expect, it, vi } from "vitest";

type DataExports = Record<string, any>;

async function loadData() {
  return (await import("../src/data")) as DataExports;
}

const filters = {
  tag_ids: ["tag-1"], folder_ids: [], database_ids: [], member_ids: [],
  attachment_types: [], ocr_statuses: [], source_types: ["note"],
};

describe("KnowledgeClient", () => {
  it("runs cancellable deduplicated workspace searches with complete filters", async () => {
    const data = await loadData();
    expect(data.KnowledgeClient).toBeTypeOf("function");
    const api = { request: vi.fn(async () => ({ items: [], next_cursor: null })) };
    const client = new data.KnowledgeClient(api, "ws-1");
    const controller = new AbortController();

    await client.search({ query: "Alpha", filters, limit: 25, signal: controller.signal });

    expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/search",
      method: "POST",
      headers: { "x-workspace-id": "ws-1" },
      body: { query: "Alpha", filters, limit: 25 },
      requestClass: "query",
      policy: expect.objectContaining({ retry: 2, signal: controller.signal }),
    }));
  });

  it("maps owner-scoped saved-search list, create, and delete", async () => {
    const data = await loadData();
    const api = {
      request: vi.fn(async (options: { path: string; method?: string }) => {
        if (!options.method) return { items: [] };
        if (options.method === "DELETE") return { deleted: true };
        return { saved_search: { id: "saved-1" } };
      }),
    };
    const client = new data.KnowledgeClient(api, "ws-1", { createId: () => "operation-1" });

    await client.listSavedSearches();
    await client.createSavedSearch({ name: "Research", query: "Alpha", filters });
    await client.deleteSavedSearch("saved-1");

    expect(api.request.mock.calls.map(([options]) => [options.path, options.method ?? "GET"])).toEqual([
      ["/api/v2/search/saved", "GET"],
      ["/api/v2/search/saved", "POST"],
      ["/api/v2/search/saved/saved-1", "DELETE"],
    ]);
    expect(api.request.mock.calls.every(([options]) => options.headers["x-workspace-id"] === "ws-1")).toBe(true);
    expect(api.request.mock.calls[1]?.[0].policy).toMatchObject({ retry: 0, idempotencyKey: "operation-1" });
  });
});
