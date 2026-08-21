import { describe, expect, it, vi } from "vitest";

async function loadData() {
  return await import("../src/data") as Record<string, any>;
}

describe("DatabaseClient", () => {
  it("uses workspace-bound deduplicated queries for bundles, pages, and search", async () => {
    const data = await loadData();
    expect(data.DatabaseClient).toBeTypeOf("function");
    const api = { request: vi.fn(async () => ({ items: [], next_cursor: null })) };
    const client = new data.DatabaseClient(api, "ws-1");
    const signal = new AbortController().signal;

    await client.listDatabases(signal);
    await client.getDatabase("db-1", signal);
    await client.listRecords("db-1", { cursor: "cursor-1", viewId: "view-1", limit: 25, signal });
    await client.searchRecords("db-1", "alpha beta", { cursor: "search-next", limit: 20, signal });

    expect(api.request.mock.calls.map(([options]) => options.path)).toEqual([
      "/api/v2/databases",
      "/api/v2/databases/db-1",
      "/api/v2/databases/db-1/records?cursor=cursor-1&view_id=view-1&limit=25",
      "/api/v2/databases/db-1/records/search?q=alpha+beta&limit=20&cursor=search-next",
    ]);
    expect(api.request.mock.calls.every(([options]) => options.headers["x-workspace-id"] === "ws-1")).toBe(true);
    expect(api.request.mock.calls.every(([options]) => options.policy.dedupeKey && options.policy.signal === signal)).toBe(true);
  });

  it("maps CRUD and atomic commands with non-retrying idempotent policies", async () => {
    const data = await loadData();
    const api = { request: vi.fn(async () => ({ record: { id: "record-1" } })) };
    let operation = 0;
    const client = new data.DatabaseClient(api, "ws-1", { createId: () => `operation-${++operation}` });

    await client.createDatabase({ name: "Projects", description: "" });
    await client.createProperty("db-1", { name: "Status", type: "select", config: { options: [] }, position: 0, hidden: false, read_only: false });
    await client.updateRecord("db-1", "record-1", { base_revision: 1, values: { status: "done" } });
    await client.bulkEdit("db-1", { mutations: [{ record_id: "record-1", base_revision: 1, values: { status: "done" } }] });
    await client.boardMove("db-1", { record_id: "record-1", property_id: "status", option_id: "done", base_revision: 1 });
    await client.calendarAssign("db-1", { record_id: "record-1", property_id: "due", date: null, base_revision: 1 });
    await client.applyTemplate("db-1", { template_id: "template-1", records: [{ record_id: "record-1", base_revision: 1 }] });
    await client.importCsv("db-1", { csv: "Name\r\nOne", header_property_ids: { Name: "name" } });
    await client.exportCsv("db-1", { property_ids: ["name"], cursor: null, page_size: 100 });

    expect(api.request.mock.calls.map(([options]) => [options.path, options.method])).toEqual([
      ["/api/v2/databases", "POST"],
      ["/api/v2/databases/db-1/properties", "POST"],
      ["/api/v2/databases/db-1/records/record-1", "PATCH"],
      ["/api/v2/databases/db-1/records/bulk", "POST"],
      ["/api/v2/databases/db-1/board-move", "POST"],
      ["/api/v2/databases/db-1/calendar-assign", "POST"],
      ["/api/v2/databases/db-1/templates/apply", "POST"],
      ["/api/v2/databases/db-1/import/csv", "POST"],
      ["/api/v2/databases/db-1/export/csv", "POST"],
    ]);
    expect(api.request.mock.calls.every(([options]) => options.requestClass === "command" && options.policy.retry === 0)).toBe(true);
    expect(new Set(api.request.mock.calls.map(([options]) => options.policy.idempotencyKey)).size).toBe(9);
  });

  it("lists and deletes permission rows through v2 envelopes", async () => {
    const data = await loadData();
    const api = { request: vi.fn(async () => ({ items: [{ id: "permission-1" }] })) };
    const client = new data.DatabaseClient(api, "ws-1", { createId: () => "permission-delete" });

    await expect(client.listDatabasePermissions("db-1")).resolves.toEqual([{ id: "permission-1" }]);
    await expect(client.listFieldPermissions("db-1", "prop-1")).resolves.toEqual([{ id: "permission-1" }]);
    await client.deleteDatabasePermission("db-1", "permission-1", { base_revision: 2 });
    await client.deleteFieldPermission("db-1", "prop-1", "permission-1", { base_revision: 2 });

    expect(api.request.mock.calls.map(([options]) => [options.path, options.method, options.requestClass])).toEqual([
      ["/api/v2/databases/db-1/permissions", undefined, "query"],
      ["/api/v2/databases/db-1/properties/prop-1/permissions", undefined, "query"],
      ["/api/v2/databases/db-1/permissions/permission-1", "DELETE", "command"],
      ["/api/v2/databases/db-1/properties/prop-1/permissions/permission-1", "DELETE", "command"],
    ]);
  });

  it("exports every bounded CSV page without repeating headers", async () => {
    const data = await loadData();
    const api = { request: vi.fn(async ({ body }: { body: { cursor: string | null; include_header?: boolean } }) => {
      return body.cursor === null
        ? { csv: "Name\r\nOne\r\nTwo\r\n", next_cursor: "next-1" }
        : { csv: "Three\r\n", next_cursor: null };
    }) };
    const client = new data.DatabaseClient(api, "ws-1", { createId: () => "export" });

    await expect(client.exportAllCsv("db-1", { property_ids: ["name"], page_size: 100 })).resolves.toBe("Name\r\nOne\r\nTwo\r\nThree\r\n");
    expect(api.request.mock.calls.map(([request]) => request.body.cursor)).toEqual([null, "next-1"]);
    expect(api.request.mock.calls.map(([request]) => request.body.include_header)).toEqual([true, false]);
  });

  it("builds a Blob from bounded CSV response chunks without parsing quoted newlines", async () => {
    const data = await loadData();
    const api = { request: vi.fn(async ({ body }: { body: { cursor: string | null } }) => body.cursor === null
      ? { csv: '"Na\\nme"\r\n"One\\nTwo"\r\n', next_cursor: "next" }
      : { csv: '"Three\\nFour"\r\n', next_cursor: null }) };
    const client = new data.DatabaseClient(api, "ws-1", { createId: () => "export" });

    const blob = await client.exportCsvBlob("db-1", { property_ids: ["name"], page_size: 1 });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(new Blob(['"Na\\nme"\r\n"One\\nTwo"\r\n"Three\\nFour"\r\n']).size);
    expect(api.request.mock.calls.map(([request]) => request.body.include_header)).toEqual([true, false]);
  });
});
