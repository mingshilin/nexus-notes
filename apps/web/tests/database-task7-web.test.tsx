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

    await waitFor(() => expect(request).toHaveBeenCalledWith({ cursor: "cursor-2", limit: 2, viewId: "table" }));
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
    expect(move).toHaveBeenCalledTimes(1);
    failFirst();
    await waitFor(() => expect(move).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(screen.getByTestId("board-column-todo")).getByTestId("board-card-race")).toBeInTheDocument());
  });

  it("uses typed property and record forms with entity pickers, templates and comments", async () => {
    const { DatabaseWorkbench, DatabaseClient } = await web() as Record<string, any>;
    const template = { id: "template-1", workspace_id: "ws-1", database_id: "db-1", name: "Launch", default_values: { status: "todo" }, revision: 1, created_at: now, updated_at: now };
    const api = { request: vi.fn(async ({ path }: { path: string }) => {
      if (path.endsWith("/comments")) return { items: [{ id: "comment-1", body: "Existing note", record_id: "record-1", workspace_id: "ws-1", database_id: "db-1", author_user_id: "user-1", parent_id: null, revision: 1, created_at: now, updated_at: now }] };
      if (path.includes("properties")) return { property: { ...status, id: "priority" } };
      if (path.includes("records") && !path.includes("comments")) return { record: record("record-2", { name: "New", status: "todo" }) };
      return { items: [] };
    }) };
    render(createElement(DatabaseWorkbench, {
      database, properties: [name, status, due], records: [record("record-1", { name: "Launch", status: "todo" })], templates: [template],
      views: [view("table", "table", { ...config, visible_columns: ["name"] })], client: new DatabaseClient(api, "ws-1", { createId: () => "operation" }),
    }));
    fireEvent.click(screen.getByRole("button", { name: "数据库工具" }));
    const drawer = screen.getByRole("dialog", { name: "数据库工具" });
    expect(within(drawer).queryByLabelText(/JSON/)).not.toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: "属性" }));
    fireEvent.change(within(drawer).getByLabelText("属性名称"), { target: { value: "Priority" } });
    fireEvent.change(within(drawer).getByLabelText("字段类型"), { target: { value: "select" } });
    fireEvent.change(within(drawer).getByLabelText("选项"), { target: { value: "Low, High" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "添加属性" }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/databases/db-1/properties", body: expect.objectContaining({ name: "Priority", type: "select", config: { options: [{ id: "low", name: "Low", color: "" }, { id: "high", name: "High", color: "" }] } }) })));
    fireEvent.click(within(drawer).getByRole("button", { name: "记录" }));
    fireEvent.change(within(drawer).getByLabelText("Name"), { target: { value: "New" } });
    fireEvent.change(within(drawer).getByLabelText("Status"), { target: { value: "todo" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "创建记录" }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/databases/db-1/records", body: { note_id: null, values: { name: "New", status: "todo" } } })));
    fireEvent.click(within(drawer).getByRole("button", { name: "模板" }));
    expect(within(drawer).getByText("Launch")).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: "评论" }));
    await waitFor(() => expect(within(drawer).getByText("Existing note")).toBeInTheDocument());
  });

  it("previews a bulk edit immediately and restores only its current records when the atomic command fails", async () => {
    const { DatabaseWorkbench, DatabaseClient } = await web() as Record<string, any>;
    let rejectBulk!: (reason: Error) => void;
    const bulk = new Promise<never>((_, reject) => { rejectBulk = reject; });
    const api = { request: vi.fn(({ path }: { path: string }) => path.endsWith("/records/bulk") ? bulk : Promise.resolve({ items: [] })) };
    render(createElement(DatabaseWorkbench, {
      database, properties: [name, status], records: [record("record-1", { name: "Launch", status: "todo" })],
      views: [view("table", "table", { ...config, visible_columns: ["name", "status"] })], client: new DatabaseClient(api, "ws-1", { createId: () => "bulk" }),
    }));
    fireEvent.click(screen.getByRole("button", { name: "数据库工具" }));
    const drawer = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(drawer).getByRole("button", { name: "批量" }));
    fireEvent.click(within(drawer).getByRole("checkbox"));
    fireEvent.change(within(drawer).getByLabelText("字段"), { target: { value: "status" } });
    fireEvent.change(within(drawer).getByLabelText("新值"), { target: { value: "done" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "预览并应用" }));
    expect(await screen.findByText("done")).toBeInTheDocument();
    rejectBulk(new Error("denied"));
    await waitFor(() => expect(screen.getByText("todo")).toBeInTheDocument());
  });

  it("loads one larger bounded board/calendar window instead of draining tiny saved pages", async () => {
    const { DatabaseWorkbench } = await web() as { DatabaseWorkbench: ComponentType<any> };
    const request = vi.fn(async ({ cursor }: { cursor: string | null }) => cursor === "next" ? { items: [record("late", { name: "Late", status: "done", due: "2026-08-21" })], next_cursor: "still-more" } : { items: [], next_cursor: null });
    const { rerender } = render(createElement(DatabaseWorkbench, {
      database, properties: [name, status, due], records: [record("first", { name: "First", status: "todo", due: "2026-08-21" })], recordsNextCursor: "next",
      views: [view("board", "board", { ...config, grouping: { property_id: "status" }, settings: { segment_size: 10 } })], onRecordsPageRequest: request,
    }));
    await waitFor(() => expect(request).toHaveBeenCalledWith({ cursor: "next", limit: 100, viewId: "board" }));
    expect(await screen.findByTestId("board-card-late")).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
    rerender(createElement(DatabaseWorkbench, {
      database, properties: [name, status, due], records: [record("first", { name: "First", status: "todo", due: "2026-08-21" })], recordsNextCursor: "next",
      views: [view("calendar", "calendar", { ...config, settings: { date_property_id: "due", segment_size: 10 } })], onRecordsPageRequest: request,
    }));
    expect(await screen.findByTestId("calendar-card-late")).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps the mobile tools action usable at 390px and 200% zoom with the page as the only scroll owner", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: { height: 500, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() } });
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
    expect(within(drawer).getByRole("button", { name: "关闭" })).toHaveFocus();
    expect(document.documentElement.style.getPropertyValue("--database-drawer-keyboard")).toBe("344px");
    fireEvent.change(within(drawer).getByLabelText("Name"), { target: { value: "Mobile" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "创建记录" }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/databases/db-1/records", method: "POST" })));
    expect(document.querySelector('[data-mode="mobile"]')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-scroll-owner="page"]')).toHaveLength(1);
    fireEvent.keyDown(drawer, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "数据库工具" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "数据库工具" })).toHaveFocus();
  });
});
