import { describe, expect, it, vi } from "vitest";
import { serializeDatabaseCsv } from "@nexus/domain";

async function loadData() {
  return await import("../src/data") as Record<string, any>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  return {
    promise: new Promise<T>((next, fail) => { resolve = next; reject = fail; }),
    resolve,
    reject,
  };
}

describe("DatabaseClient", () => {
  it("caches a database bootstrap for two minutes and invalidates it after a mutation", async () => {
    const data = await loadData();
    let now = 1_000;
    const bootstrap = {
      items: [{ id: "db-1", name: "Projects" }],
      selected_database_id: "db-1",
      bundle: { database: { id: "db-1" }, role: "editor", properties: [], views: [], templates: [] },
      records: { items: [], next_cursor: null },
    };
    const api = { request: vi.fn(async ({ path }: { path: string }) => path.includes("/bootstrap")
      ? bootstrap
      : { database: { id: "db-2", name: "Created" } }) };
    const client = new data.DatabaseClient(api, "ws-1", { now: () => now, createId: () => "create" });

    await expect(client.bootstrap({ databaseId: "db-1", limit: 25 })).resolves.toBe(bootstrap);
    await expect(client.bootstrap({ databaseId: "db-1", limit: 25 })).resolves.toBe(bootstrap);
    expect(api.request).toHaveBeenCalledTimes(1);

    now += 120_001;
    await client.bootstrap({ databaseId: "db-1", limit: 25 });
    expect(api.request).toHaveBeenCalledTimes(2);

    await client.createDatabase({ name: "Created", description: "" });
    await client.bootstrap({ databaseId: "db-1", limit: 25 });
    expect(api.request).toHaveBeenCalledTimes(4);
    expect(api.request.mock.calls[0]![0].path).toBe("/api/v2/databases/bootstrap?database_id=db-1&limit=25");
  });

  it("serves stale database cache while revalidating and keeps it after an aborted refresh", async () => {
    const data = await loadData();
    let now = 1_000;
    const stale = [{ id: "db-stale", name: "Stale" }];
    const fresh = [{ id: "db-fresh", name: "Fresh" }];
    const refresh = deferred<{ items: typeof fresh }>();
    const api = {
      request: vi.fn()
        .mockResolvedValueOnce({ items: stale })
        .mockImplementationOnce(() => refresh.promise)
        .mockImplementationOnce(({ policy }: { policy: { signal?: AbortSignal } }) => new Promise((_resolve, reject) => {
          policy.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        })),
    };
    const client = new data.DatabaseClient(api, "ws-1", { now: () => now, createId: () => "operation" });

    await expect(client.listDatabases()).resolves.toBe(stale);

    now += 120_001;
    const staleReads = [client.listDatabases(), client.listDatabases(), client.listDatabases()];
    await Promise.resolve();
    await expect(Promise.all(staleReads)).resolves.toEqual([stale, stale, stale]);
    expect(api.request).toHaveBeenCalledTimes(2);

    refresh.resolve({ items: fresh });
    await refresh.promise;
    await Promise.resolve();
    await expect(client.listDatabases()).resolves.toBe(fresh);

    now += 120_001;
    const controller = new AbortController();
    const staleDuringAbort = client.listDatabases(controller.signal);
    controller.abort();
    await expect(staleDuringAbort).resolves.toBe(fresh);
    expect(api.request).toHaveBeenCalledTimes(3);

    await Promise.resolve();
    await expect(client.listDatabases()).resolves.toBe(fresh);
  });

  it("does not restore derived bootstrap cache after a mutation invalidates an in-flight refresh", async () => {
    const data = await loadData();
    let now = 1_000;
    let bootstrapRequests = 0;
    const oldBundle = { database: { id: "db-old", name: "Old" }, role: "editor", properties: [], views: [], templates: [] };
    const oldBootstrap = {
      items: [{ id: "db-old", name: "Old" }],
      selected_database_id: "db-old",
      bundle: oldBundle,
      records: { items: [], next_cursor: null },
    };
    const newBundle = { database: { id: "db-new", name: "New" }, role: "editor", properties: [], views: [], templates: [] };
    const newDatabases = [{ id: "db-new", name: "New" }];
    const refresh = deferred<typeof oldBootstrap>();
    const api = {
      request: vi.fn(({ path, method }: { path: string; method?: string }) => {
        if (path.includes("/bootstrap")) {
          bootstrapRequests += 1;
          return bootstrapRequests === 1 ? Promise.resolve(oldBootstrap) : refresh.promise;
        }
        if (method === "POST") return Promise.resolve({ database: { id: "db-created", name: "Created" } });
        if (path === "/api/v2/databases") return Promise.resolve({ items: newDatabases });
        if (path === "/api/v2/databases/db-old") return Promise.resolve(newBundle);
        throw new Error(`Unexpected request: ${method ?? "GET"} ${path}`);
      }),
    };
    const client = new data.DatabaseClient(api, "ws-1", { now: () => now, createId: () => "create" });

    await expect(client.bootstrap({ databaseId: "db-old", limit: 25 })).resolves.toBe(oldBootstrap);

    now += 120_001;
    await expect(client.bootstrap({ databaseId: "db-old", limit: 25 })).resolves.toBe(oldBootstrap);
    expect(api.request).toHaveBeenCalledTimes(2);

    await client.createDatabase({ name: "Created", description: "" });
    refresh.resolve(oldBootstrap);
    await refresh.promise;
    await Promise.resolve();

    await expect(client.listDatabases()).resolves.toBe(newDatabases);
    await expect(client.getDatabase("db-old")).resolves.toBe(newBundle);
    expect(api.request).toHaveBeenCalledTimes(5);
  });

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

  it("loads management stats and previews CSV without treating preview as a mutation", async () => {
    const data = await loadData();
    const stats = { record_count: 12, property_count: 3, view_count: 2, template_count: 1, comment_count: 4, updated_at: "2026-08-25T00:00:00.000Z", role: "owner", database_permission_count: 1, field_permission_count: 2 };
    const preview = { headers: ["Name"], rows: [{ row_number: 2, values: { name: "Alpha" } }], errors: [], total_rows: 1 };
    const api = { request: vi.fn(async ({ path }: { path: string }) => path.endsWith("/stats") ? stats : preview) };
    const client = new data.DatabaseClient(api, "ws-1");

    await expect(client.getStats("db-1")).resolves.toEqual(stats);
    await expect(client.previewCsv("db-1", { csv: "Name\r\nAlpha", header_property_ids: { Name: "name" } })).resolves.toEqual(preview);

    expect(api.request.mock.calls.map(([options]) => [options.path, options.method ?? "GET", options.requestClass])).toEqual([
      ["/api/v2/databases/db-1/stats", "GET", "query"],
      ["/api/v2/databases/db-1/import/csv/preview", "POST", "query"],
    ]);
    expect(api.request.mock.calls[1]![0].policy).toMatchObject({ retry: 0 });
    expect(api.request.mock.calls[1]![0].policy.idempotencyKey).toBeUndefined();
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
        ? { csv: serializeDatabaseCsv([["Name"], ["One"], ["Two"]]), next_cursor: "next-1" }
        : { csv: serializeDatabaseCsv([["Three"]]), next_cursor: null };
    }) };
    const client = new data.DatabaseClient(api, "ws-1", { createId: () => "export" });

    await expect(client.exportAllCsv("db-1", { property_ids: ["name"], page_size: 100 })).resolves.toBe("Name\r\nOne\r\nTwo\r\nThree");
    expect(api.request.mock.calls.map(([request]) => request.body.cursor)).toEqual([null, "next-1"]);
    expect(api.request.mock.calls.map(([request]) => request.body.include_header)).toEqual([true, false]);
  });

  it("builds a Blob from bounded CSV response chunks without parsing quoted newlines", async () => {
    const data = await loadData();
    const api = { request: vi.fn(async ({ body }: { body: { cursor: string | null } }) => body.cursor === null
      ? { csv: serializeDatabaseCsv([["Na\nme"], ["One\nTwo"]]), next_cursor: "next" }
      : { csv: serializeDatabaseCsv([["Three\nFour"]]), next_cursor: null }) };
    const client = new data.DatabaseClient(api, "ws-1", { createId: () => "export" });

    const blob = await client.exportCsvBlob("db-1", { property_ids: ["name"], page_size: 1 });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(new Blob([serializeDatabaseCsv([["Na\nme"], ["One\nTwo"], ["Three\nFour"]])]).size);
    expect(api.request.mock.calls.map(([request]) => request.body.include_header)).toEqual([true, false]);
  });
});
