import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

const now = "2026-08-21T00:00:00.000Z";
const database = { id: "db-1", workspace_id: "ws-1", name: "Projects", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now };
const name = { id: "name", workspace_id: "ws-1", database_id: "db-1", name: "Name", type: "text", config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now };
const status = { id: "status", workspace_id: "ws-1", database_id: "db-1", name: "Status", type: "select", config: { options: [{ id: "todo", name: "Todo" }, { id: "done", name: "Done" }] }, position: 1, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now };
const due = { id: "due", workspace_id: "ws-1", database_id: "db-1", name: "Due", type: "date", config: {}, position: 2, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now };

function record(id: string, values: Record<string, unknown>, revision = 1) {
  return { id, workspace_id: "ws-1", database_id: "db-1", note_id: null, values, created_by: "user-1", updated_by: "user-1", revision, created_at: now, updated_at: now };
}

function view(id: string, type: "table" | "board" | "calendar", config: Record<string, unknown>) {
  return { id, workspace_id: "ws-1", database_id: "db-1", name: id, type, config, position: 0, revision: 1, created_at: now, updated_at: now };
}

const config = { filters: [], sorts: [], grouping: null, visible_columns: ["name", "status", "due"], page_size: 2, settings: {} };

async function web() {
  return await import("../src/index") as Record<string, any>;
}

describe("Task 7 database web behavior", () => {
  it("executes saved filters, sorts, visible columns, and page size against loaded records", async () => {
    const { DatabaseWorkbench } = await web() as { DatabaseWorkbench: ComponentType<any> };
    render(createElement(DatabaseWorkbench, {
      database,
      properties: [name, status],
      records: [record("one", { name: "Alpha low", status: "todo" }), record("two", { name: "Alpha high", status: "done" }), record("three", { name: "Beta", status: "done" })],
      views: [view("table", "table", { ...config, visible_columns: ["name"], filters: [{ property_id: "name", operator: "contains", value: "Alpha" }], sorts: [{ property_id: "name", direction: "desc" }], page_size: 1 })],
    }));

    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    expect(screen.getByText("Alpha low")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("Alpha high")).toBeInTheDocument();
  });

  it("restores page three from its exact cursor chain instead of appending it after page one", async () => {
    const { DatabaseWorkbench, DatabasePaginationStore } = await web() as Record<string, any>;
    const values = new Map<string, string>();
    const store = new DatabasePaginationStore({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    store.write("ws-1", "db-1", "table", { page: 3, pageSize: 2, cursors: { 1: null, 2: "cursor-1", 3: "cursor-2" } });
    const request = vi.fn(async ({ cursor }: { cursor: string | null }) => ({ items: [record("five", { name: "Five" }), record("six", { name: "Six" })], next_cursor: null }));
    render(createElement(DatabaseWorkbench, {
      database, properties: [name], records: [record("one", { name: "One" }), record("two", { name: "Two" })], recordsNextCursor: "cursor-1",
      views: [view("table", "table", { ...config, visible_columns: ["name"] })], paginationStore: store, onRecordsPageRequest: request,
    }));

    await waitFor(() => expect(request).toHaveBeenCalledWith({ cursor: "cursor-2", limit: 2 }));
    expect(await screen.findByText("Five")).toBeInTheDocument();
    expect(screen.getByText("Six")).toBeInTheDocument();
    expect(screen.queryByText("One")).not.toBeInTheDocument();
  });

  it("keeps a later board operation when an earlier operation fails and clears cancelled drag state", async () => {
    const { DatabaseWorkbench } = await web() as { DatabaseWorkbench: ComponentType<any> };
    let failFirst!: () => void;
    const first = new Promise<never>((_, reject) => { failFirst = () => reject(new Error("stale")); });
    const move = vi.fn((input: any) => move.mock.calls.length === 1 ? first : Promise.resolve(record(input.record_id, { name: "Race", status: input.option_id }, input.base_revision + 1)));
    render(createElement(DatabaseWorkbench, {
      database, properties: [name, status], records: [record("race", { name: "Race", status: "todo" })],
      views: [view("board", "board", { ...config, grouping: { property_id: "status" }, settings: { segment_size: 10 } })], onBoardMove: move,
    }));
    const card = screen.getByTestId("board-card-race");
    fireEvent.dragStart(card);
    fireEvent.dragEnd(card);
    fireEvent.drop(screen.getByTestId("board-column-done"));
    expect(move).not.toHaveBeenCalled();
    fireEvent.dragStart(card);
    fireEvent.drop(screen.getByTestId("board-column-done"));
    await waitFor(() => expect(move).toHaveBeenCalledTimes(1));
    fireEvent.dragStart(screen.getByTestId("board-card-race"));
    fireEvent.drop(screen.getByTestId("board-column-todo"));
    await waitFor(() => expect(move).toHaveBeenCalledTimes(2));
    failFirst();
    await waitFor(() => expect(within(screen.getByTestId("board-column-todo")).getByTestId("board-card-race")).toBeInTheDocument());
  });

  it("uses the typed client for every tools workflow, including CRUD, bulk edit, CSV, comments and permissions", async () => {
    const { DatabaseWorkbench, DatabaseClient } = await web() as Record<string, any>;
    const api = { request: vi.fn(async ({ path }: { path: string }) => {
      if (path.includes("export/csv")) return { csv: "Name\r\nLaunch", next_cursor: null };
      if (path.includes("comments") && !path.includes("records")) return { id: "comment-1" };
      if (path.includes("permissions")) return { permission: { id: "permission-1" } };
      if (path.includes("templates") && !path.includes("apply")) return { template: { id: "template-1" } };
      if (path.includes("views")) return { view: { id: "view-1" } };
      if (path.includes("properties")) return { property: { id: "property-1" } };
      if (path.includes("records")) return { record: record("record-1", { name: "Launch" }) };
      return { database };
    }) };
    const client = new DatabaseClient(api, "ws-1", { createId: () => "operation" });
    render(createElement(DatabaseWorkbench, {
      database, properties: [name, status, due], records: [record("record-1", { name: "Launch" })],
      views: [view("table", "table", { ...config, visible_columns: ["name"] })], client,
    }));
    fireEvent.click(screen.getByRole("button", { name: "数据库工具" }));
    const drawer = screen.getByRole("dialog", { name: "数据库工具" });
    const action = within(drawer).getByLabelText("数据库操作");
    const payload = within(drawer).getByLabelText("操作数据 JSON");
    const run = async (name: string, value: Record<string, unknown>) => {
      fireEvent.change(action, { target: { value: name } });
      fireEvent.change(payload, { target: { value: JSON.stringify(value) } });
      fireEvent.click(within(drawer).getByRole("button", { name: "执行操作" }));
      await waitFor(() => expect(api.request).toHaveBeenCalled());
    };
    await run("create-property", { name: "Cost", type: "number", config: {}, position: 3, hidden: false, read_only: false });
    await run("update-property", { id: "name", base_revision: 1, name: "Title" });
    await run("delete-property", { id: "name", base_revision: 1 });
    await run("create-record", { values: { name: "New" } });
    await run("update-record", { id: "record-1", base_revision: 1, values: { name: "Edited" } });
    await run("delete-record", { id: "record-1", base_revision: 1 });
    await run("bulk-edit", { mutations: [{ record_id: "record-1", base_revision: 1, values: { status: "done" } }] });
    await run("create-view", { name: "Board", type: "board", config: { ...config, settings: { segment_size: 10 } } });
    await run("update-view", { id: "table", base_revision: 1, name: "Table" });
    await run("delete-view", { id: "table", base_revision: 1 });
    await run("create-template", { name: "Default", default_values: { status: "todo" } });
    await run("update-template", { id: "template-1", base_revision: 1, name: "Updated" });
    await run("delete-template", { id: "template-1", base_revision: 1 });
    await run("apply-template", { template_id: "template-1", records: [{ record_id: "record-1", base_revision: 1 }] });
    await run("create-comment", { record_id: "record-1", body: "Note" });
    await run("update-comment", { id: "comment-1", base_revision: 1, body: "Edited" });
    await run("delete-comment", { id: "comment-1", base_revision: 1 });
    await run("set-database-permission", { subject_type: "user", subject_id: "user-2", role: "viewer", base_revision: 1 });
    await run("set-field-permission", { property_id: "name", subject_type: "user", subject_id: "user-2", can_read: true, can_write: false, base_revision: 1 });
    await run("import-csv", { csv: "Name\r\nLaunch", header_property_ids: { Name: "name" } });
    await run("export-csv", { property_ids: ["name"], cursor: null, page_size: 100 });
    await run("update-database", { base_revision: 1, name: "Renamed" });
    await run("delete-database", { base_revision: 1 });
    expect(api.request.mock.calls.map(([request]: any[]) => request.path)).toEqual(expect.arrayContaining([
      "/api/v2/databases/db-1/properties", "/api/v2/databases/db-1/records/bulk", "/api/v2/databases/db-1/views", "/api/v2/databases/db-1/templates/apply", "/api/v2/databases/db-1/import/csv", "/api/v2/databases/db-1/export/csv", "/api/v2/databases/db-1/permissions",
    ]));
  });

  it("loads every bounded page for board and calendar datasets before rendering their segmented cards", async () => {
    const { DatabaseWorkbench } = await web() as { DatabaseWorkbench: ComponentType<any> };
    const request = vi.fn(async ({ cursor }: { cursor: string | null }) => cursor === "next" ? { items: [record("late", { name: "Late", status: "done", due: "2026-08-21" })], next_cursor: null } : { items: [], next_cursor: null });
    const { rerender } = render(createElement(DatabaseWorkbench, {
      database, properties: [name, status, due], records: [record("first", { name: "First", status: "todo", due: "2026-08-21" })], recordsNextCursor: "next",
      views: [view("board", "board", { ...config, grouping: { property_id: "status" }, settings: { segment_size: 10 } })], onRecordsPageRequest: request,
    }));
    await waitFor(() => expect(request).toHaveBeenCalledWith({ cursor: "next", limit: 2 }));
    expect(await screen.findByTestId("board-card-late")).toBeInTheDocument();
    rerender(createElement(DatabaseWorkbench, {
      database, properties: [name, status, due], records: [record("first", { name: "First", status: "todo", due: "2026-08-21" })], recordsNextCursor: "next",
      views: [view("calendar", "calendar", { ...config, settings: { date_property_id: "due", segment_size: 10 } })], onRecordsPageRequest: request,
    }));
    expect(await screen.findByTestId("calendar-card-late")).toBeInTheDocument();
  });

  it("keeps the mobile tools action usable at 390px and 200% zoom with the page as the only scroll owner", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    const { AdaptiveWorkbench, DatabaseWorkbench, DatabaseClient } = await web() as Record<string, any>;
    const api = { request: vi.fn(async () => ({ record: record("mobile", { name: "Mobile" }) })) };
    render(createElement(AdaptiveWorkbench, {
      mode: "mobile", navigation: "", contextualList: "", inspectorOpen: false, onInspectorClose: vi.fn(),
    }, createElement(DatabaseWorkbench, {
      database, properties: [name], records: [], views: [view("table", "table", { ...config, visible_columns: ["name"] })],
      client: new DatabaseClient(api, "ws-1", { createId: () => "mobile-operation" }),
    })));
    fireEvent.click(screen.getByRole("button", { name: "数据库工具" }));
    const drawer = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.change(within(drawer).getByLabelText("操作数据 JSON"), { target: { value: '{"values":{"name":"Mobile"}}' } });
    fireEvent.click(within(drawer).getByRole("button", { name: "执行操作" }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/databases/db-1/records", method: "POST" })));
    expect(document.querySelector('[data-mode="mobile"]')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-scroll-owner="page"]')).toHaveLength(1);
  });
});
