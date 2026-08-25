import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

const now = "2026-08-21T00:00:00.000Z";
const database = { id: "db-1", workspace_id: "ws-1", name: "Projects", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now };
const name = { id: "name", workspace_id: "ws-1", database_id: "db-1", name: "Name", type: "text", config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now };
const status = { id: "status", workspace_id: "ws-1", database_id: "db-1", name: "Status", type: "select", config: { options: [{ id: "todo", name: "Todo" }, { id: "done", name: "Done" }] }, position: 1, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now };
const due = { id: "due", workspace_id: "ws-1", database_id: "db-1", name: "Due", type: "date", config: {}, position: 2, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now };

const typedProperties = [
  name,
  { ...name, id: "score", name: "Score", type: "number", position: 1 },
  { ...name, id: "complete", name: "Complete", type: "checkbox", position: 2 },
  { ...status, position: 3 },
  { ...name, id: "tags", name: "Tags", type: "multi_select", position: 4, config: { options: [{ id: "a", name: "A" }, { id: "b", name: "B" }] } },
  { ...due, position: 5 },
  { ...name, id: "website", name: "Website", type: "url", position: 6 },
  { ...name, id: "email", name: "Email", type: "email", position: 7 },
  { ...name, id: "assignee", name: "Assignee", type: "member", position: 8, config: {} },
  { ...name, id: "related", name: "Related", type: "relation", position: 9, config: { target_database_id: "db-2", allow_multiple: true } },
] as const;

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

function selectValues(element: HTMLElement, values: readonly string[]) {
  for (const option of Array.from((element as HTMLSelectElement).options)) option.selected = values.includes(option.value);
  fireEvent.change(element);
}

describe("Task 7 database web behavior", () => {
  it("refetches page one when the selected view revision or configuration changes", async () => {
    const { DatabaseWorkbench } = await web() as { DatabaseWorkbench: ComponentType<any> };
    const request = vi.fn(async () => ({ items: [record("fresh", { name: "Fresh" })], next_cursor: null }));
    const initialView = view("table", "table", { ...config, page_size: 2 });
    const { rerender } = render(createElement(DatabaseWorkbench, {
      database, properties: [name], records: [record("stale", { name: "Stale" })], views: [initialView], onRecordsPageRequest: request,
    }));

    expect(request).not.toHaveBeenCalled();
    rerender(createElement(DatabaseWorkbench, {
      database, properties: [name], records: [record("stale", { name: "Stale" })],
      views: [{ ...initialView, revision: 2, config: { ...initialView.config, page_size: 3 } }], onRecordsPageRequest: request,
    }));
    await waitFor(() => expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: null, limit: 3, viewId: "table" })));
  });

  it("keeps the database header and creation tools available without a saved view", async () => {
    const { DatabaseWorkbench } = await web() as { DatabaseWorkbench: ComponentType<any> };
    render(createElement(DatabaseWorkbench, { database, properties: [], records: [], views: [] }));

    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "数据库工具" }));
    expect(screen.getByRole("button", { name: "视图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "属性" })).toBeInTheDocument();
  });

  it("loads the next board window only after the user explicitly asks for more records", async () => {
    const { DatabaseWorkbench } = await web() as { DatabaseWorkbench: ComponentType<any> };
    const request = vi.fn(async () => ({ items: [record("later", { name: "Later", status: "done" })], next_cursor: null }));
    render(createElement(DatabaseWorkbench, {
      database, properties: [name, status], records: [record("first", { name: "First", status: "todo" })], recordsNextCursor: "next",
      views: [view("board", "board", { ...config, grouping: { property_id: "status" }, settings: { segment_size: 10 } })], onRecordsPageRequest: request,
    }));

    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "加载更多记录" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith({ cursor: "next", limit: 100, viewId: "board" }));
    expect(await screen.findByTestId("board-card-later")).toBeInTheDocument();
  });

  it("uses the newest source revision after a board queue drains", async () => {
    const { DatabaseWorkbench } = await web() as { DatabaseWorkbench: ComponentType<any> };
    const onBoardMove = vi.fn(async (input: any) => record(input.record_id, { name: "Race", status: input.option_id }, input.base_revision + 1));
    const board = view("board", "board", { ...config, grouping: { property_id: "status" }, settings: { segment_size: 10 } });
    const { rerender } = render(createElement(DatabaseWorkbench, {
      database, properties: [name, status], records: [record("race", { name: "Race", status: "todo" })], views: [board], onBoardMove,
    }));
    fireEvent.dragStart(screen.getByTestId("board-card-race"));
    fireEvent.drop(screen.getByTestId("board-column-done"));
    await waitFor(() => expect(onBoardMove).toHaveBeenCalledTimes(1));
    rerender(createElement(DatabaseWorkbench, {
      database, properties: [name, status], records: [record("race", { name: "Race", status: "done" }, 9)], views: [board], onBoardMove,
    }));
    fireEvent.dragStart(screen.getByTestId("board-card-race"));
    fireEvent.drop(screen.getByTestId("board-column-todo"));
    await waitFor(() => expect(onBoardMove).toHaveBeenCalledTimes(2));
    expect(onBoardMove.mock.calls[1]![0].base_revision).toBe(9);
  });

  it("browses and mutates database and field permissions with the fetched revisions", async () => {
    const { DatabaseWorkbench, DatabaseClient } = await web() as Record<string, any>;
    const databasePermission = { id: "db-permission", workspace_id: "ws-1", database_id: "db-1", subject_type: "user", subject_id: "user-2", role: "viewer", revision: 4, updated_at: now };
    const fieldPermission = { id: "field-permission", workspace_id: "ws-1", database_id: "db-1", property_id: "name", subject_type: "user", subject_id: "user-2", can_read: true, can_write: false, revision: 6, updated_at: now };
    const api = { request: vi.fn(async ({ path, method }: { path: string; method?: string }) => {
      if (method === undefined && path.endsWith("/properties/name/permissions")) return { items: [fieldPermission] };
      if (method === undefined && path.endsWith("/permissions")) return { items: [databasePermission] };
      return { permission: databasePermission, id: "permission" };
    }) };
    render(createElement(DatabaseWorkbench, {
      database, properties: [name], records: [], views: [view("table", "table", config)], client: new DatabaseClient(api, "ws-1", { createId: () => "permission" }),
    }));
    fireEvent.click(screen.getByRole("button", { name: "数据库工具" }));
    const drawer = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(drawer).getByRole("button", { name: "权限" }));
    expect(await within(drawer).findByRole("button", { name: "删除数据库权限 user-2" })).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: "删除数据库权限 user-2" }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/api/v2/databases/db-1/permissions/db-permission", body: { base_revision: 4 } })));
    fireEvent.change(within(drawer).getByLabelText("权限字段"), { target: { value: "name" } });
    expect(await within(drawer).findByRole("button", { name: "删除字段权限 user-2" })).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: "删除字段权限 user-2" }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/api/v2/databases/db-1/properties/name/permissions/field-permission", body: { base_revision: 6 } })));
  });

  it("upserts database and field permissions for role subjects with role-specific revisions", async () => {
    const { DatabaseWorkbench, DatabaseClient } = await web() as Record<string, any>;
    const databasePermissions = [
      { id: "db-user", workspace_id: "ws-1", database_id: "db-1", subject_type: "user", subject_id: "viewer", role: "viewer", revision: 4, updated_at: now },
      { id: "db-role", workspace_id: "ws-1", database_id: "db-1", subject_type: "role", subject_id: "viewer", role: "viewer", revision: 7, updated_at: now },
    ];
    const fieldPermissions = [
      { id: "field-user", workspace_id: "ws-1", database_id: "db-1", property_id: "name", subject_type: "user", subject_id: "viewer", can_read: true, can_write: false, revision: 6, updated_at: now },
      { id: "field-role", workspace_id: "ws-1", database_id: "db-1", property_id: "name", subject_type: "role", subject_id: "viewer", can_read: true, can_write: false, revision: 9, updated_at: now },
    ];
    const api = { request: vi.fn(async ({ path, method }: { path: string; method?: string }) => {
      if (method === undefined && path.endsWith("/properties/name/permissions")) return { items: fieldPermissions };
      if (method === undefined && path.endsWith("/permissions")) return { items: databasePermissions };
      if (path.endsWith("/properties/name/permissions")) return { permission: fieldPermissions[1] };
      return { permission: databasePermissions[1] };
    }) };
    render(createElement(DatabaseWorkbench, {
      database, properties: [name], records: [], views: [view("table", "table", config)],
      client: new DatabaseClient(api, "ws-1", { createId: () => "role-permission" }),
    }));
    fireEvent.click(screen.getByRole("button", { name: "数据库工具" }));
    const drawer = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(drawer).getByRole("button", { name: "权限" }));
    await within(drawer).findByText("viewer · viewer · r7");

    fireEvent.change(within(drawer).getByLabelText("主体类型"), { target: { value: "role" } });
    expect(within(drawer).queryByLabelText("成员 ID")).not.toBeInTheDocument();
    fireEvent.change(within(drawer).getByLabelText("工作区角色"), { target: { value: "viewer" } });
    fireEvent.change(within(drawer).getByLabelText("权限角色"), { target: { value: "editor" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "保存权限" }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
      method: "PUT", path: "/api/v2/databases/db-1/permissions",
      body: { subject_type: "role", subject_id: "viewer", role: "editor", base_revision: 7 },
    })));
    await waitFor(() => expect(within(drawer).getByRole("button", { name: "保存字段权限" })).not.toBeDisabled());
    fireEvent.click(within(drawer).getByRole("button", { name: "保存字段权限" }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
      method: "PUT", path: "/api/v2/databases/db-1/properties/name/permissions",
      body: { subject_type: "role", subject_id: "viewer", can_read: true, can_write: false, base_revision: 9 },
    })));
  });

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

    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ cursor: "cursor-2", limit: 2, viewId: "table" })));
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
    const request = vi.fn(async ({ cursor }: { cursor: string | null }) => cursor === null ? { items: [record("first", { name: "First", status: "todo", due: "2026-08-21" })], next_cursor: "next" } : { items: [record("late", { name: "Late", status: "done", due: "2026-08-21" })], next_cursor: "still-more" });
    const { rerender } = render(createElement(DatabaseWorkbench, {
      database, properties: [name, status, due], records: [record("first", { name: "First", status: "todo", due: "2026-08-21" })], recordsNextCursor: "next",
      views: [view("board", "board", { ...config, grouping: { property_id: "status" }, settings: { segment_size: 10 } })], onRecordsPageRequest: request,
    }));
    fireEvent.click(screen.getByRole("button", { name: "加载更多记录" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith({ cursor: "next", limit: 100, viewId: "board" }));
    expect(await screen.findByTestId("board-card-late")).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
    rerender(createElement(DatabaseWorkbench, {
      database, properties: [name, status, due], records: [record("first", { name: "First", status: "todo", due: "2026-08-21" })], recordsNextCursor: "next",
      views: [view("calendar", "calendar", { ...config, settings: { date_property_id: "due", segment_size: 10 } })], onRecordsPageRequest: request,
    }));
    await screen.findByLabelText("数据库日历");
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ cursor: null, viewId: "calendar" })));
    fireEvent.click(screen.getByRole("button", { name: "加载更多记录" }));
    expect(await screen.findByTestId("calendar-card-late")).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("ignores a deferred collection response after the active view fingerprint changes", async () => {
    const { DatabaseWorkbench } = await web() as { DatabaseWorkbench: ComponentType<any> };
    let resolveBoard!: (page: { items: ReturnType<typeof record>[]; next_cursor: null }) => void;
    const boardPage = new Promise<{ items: ReturnType<typeof record>[]; next_cursor: null }>((resolve) => { resolveBoard = resolve; });
    const request = vi.fn(({ cursor, viewId }: { cursor: string | null; viewId: string }) => {
      if (cursor === "board-next") return boardPage;
      return Promise.resolve({ items: [record("calendar-fresh", { name: "Calendar fresh", due: "2026-08-21" })], next_cursor: null });
    });
    const board = view("board", "board", { ...config, grouping: { property_id: "status" }, settings: { segment_size: 10 } });
    const calendar = view("calendar", "calendar", { ...config, settings: { date_property_id: "due", segment_size: 10 } });
    const props = {
      database, properties: [name, status, due], records: [record("first", { name: "First", status: "todo" })], recordsNextCursor: "board-next",
      views: [board, calendar], onRecordsPageRequest: request,
    };
    const { rerender } = render(createElement(DatabaseWorkbench, { ...props, activeViewId: "board" }));
    fireEvent.click(screen.getByRole("button", { name: "加载更多记录" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ cursor: "board-next", viewId: "board" })));

    rerender(createElement(DatabaseWorkbench, { ...props, activeViewId: "calendar" }));
    await screen.findByLabelText("数据库日历");
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ cursor: null, viewId: "calendar" })));
    await act(async () => {
      resolveBoard({ items: [record("board-stale", { name: "Board stale", status: "done" })], next_cursor: null });
      await boardPage;
    });
    await waitFor(() => expect(screen.queryByText("Board stale")).not.toBeInTheDocument());
    expect(screen.getByText("Calendar fresh")).toBeInTheDocument();
  });

  it("submits typed record values for all ten property types", async () => {
    const { DatabaseWorkbench, DatabaseClient } = await web() as Record<string, any>;
    const api = { request: vi.fn(async () => ({ record: record("typed", {}) })) };
    render(createElement(DatabaseWorkbench, {
      database, properties: typedProperties, records: [], views: [view("table", "table", { ...config, visible_columns: typedProperties.map((property) => property.id) })],
      client: new DatabaseClient(api, "ws-1", { createId: () => "typed" }),
    }));
    fireEvent.click(screen.getByRole("button", { name: "数据库工具" }));
    const drawer = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(drawer).getByRole("button", { name: "记录" }));
    fireEvent.change(within(drawer).getByLabelText("Name"), { target: { value: "Launch" } });
    fireEvent.change(within(drawer).getByLabelText("Score"), { target: { value: "12.5" } });
    fireEvent.click(within(drawer).getByLabelText("Complete"));
    fireEvent.change(within(drawer).getByLabelText("Status"), { target: { value: "done" } });
    selectValues(within(drawer).getByLabelText("Tags"), ["a", "b"]);
    fireEvent.change(within(drawer).getByLabelText("Due"), { target: { value: "2026-08-22" } });
    fireEvent.change(within(drawer).getByLabelText("Website"), { target: { value: "https://example.com" } });
    fireEvent.change(within(drawer).getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.change(within(drawer).getByLabelText("Assignee"), { target: { value: "user-2" } });
    fireEvent.change(within(drawer).getByLabelText("Related"), { target: { value: "record-2, record-3" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "创建记录" }));

    await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/databases/db-1/records",
      body: { note_id: null, values: {
        name: "Launch", score: 12.5, complete: true, status: "done", tags: ["a", "b"], due: "2026-08-22",
        website: "https://example.com", email: "user@example.com", assignee: "user-2", related: ["record-2", "record-3"],
      } },
    })));
  });

  it("coerces saved filters with property-specific controls for all ten types", async () => {
    const { DatabaseViewForm } = await import("../src/databases/DatabaseViewTemplateForms");
    const filters = typedProperties.map((property) => ({
      property_id: property.id,
      operator: "equals" as const,
      value: property.type === "checkbox" ? false : property.type === "multi_select" || (property.type === "relation" && property.config.allow_multiple) ? [] : "",
    }));
    const editingView = view("typed-view", "table", { ...config, visible_columns: typedProperties.map((property) => property.id), filters });
    const onUpdate = vi.fn();
    render(createElement(DatabaseViewForm, {
      name: "Typed", type: "table", properties: typedProperties, position: 0, disabled: false, editingView,
      onNameChange: vi.fn(), onTypeChange: vi.fn(), onSubmit: vi.fn(), onUpdate,
    }));

    expect(screen.getByLabelText("过滤值 2")).toHaveAttribute("type", "number");
    expect(screen.getByLabelText("过滤值 3")).toHaveAttribute("type", "checkbox");
    expect(screen.getByLabelText("过滤值 4").tagName).toBe("SELECT");
    expect(screen.getByLabelText("过滤值 5")).toHaveAttribute("multiple");
    expect(screen.getByLabelText("过滤值 6")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("过滤值 7")).toHaveAttribute("type", "url");
    expect(screen.getByLabelText("过滤值 8")).toHaveAttribute("type", "email");
    fireEvent.change(screen.getByLabelText("过滤值 1"), { target: { value: "Alpha" } });
    fireEvent.change(screen.getByLabelText("过滤值 2"), { target: { value: "42" } });
    fireEvent.click(screen.getByLabelText("过滤值 3"));
    fireEvent.change(screen.getByLabelText("过滤值 4"), { target: { value: "done" } });
    selectValues(screen.getByLabelText("过滤值 5"), ["a", "b"]);
    fireEvent.change(screen.getByLabelText("过滤值 6"), { target: { value: "2026-08-22" } });
    fireEvent.change(screen.getByLabelText("过滤值 7"), { target: { value: "https://example.com" } });
    fireEvent.change(screen.getByLabelText("过滤值 8"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("过滤值 9"), { target: { value: "user-2" } });
    fireEvent.change(screen.getByLabelText("过滤值 10"), { target: { value: "record-2, record-3" } });
    fireEvent.click(screen.getByRole("button", { name: "保存视图" }));

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ filters: [
      expect.objectContaining({ value: "Alpha" }), expect.objectContaining({ value: 42 }), expect.objectContaining({ value: true }),
      expect.objectContaining({ value: "done" }), expect.objectContaining({ value: ["a", "b"] }), expect.objectContaining({ value: "2026-08-22" }),
      expect.objectContaining({ value: "https://example.com" }), expect.objectContaining({ value: "user@example.com" }),
      expect.objectContaining({ value: "user-2" }), expect.objectContaining({ value: ["record-2", "record-3"] }),
    ] }) }));
  });

  it("edits synchronized template defaults for all ten types and offers cross-database relation targets", async () => {
    const { DatabaseWorkbench, DatabaseClient } = await web() as Record<string, any>;
    const defaults = {
      name: "Template", score: 7, complete: true, status: "todo", tags: ["a"], due: "2026-08-22",
      website: "https://example.com", email: "user@example.com", assignee: "user-2", related: ["record-2"],
    };
    const template = { id: "template-typed", workspace_id: "ws-1", database_id: "db-1", name: "Typed defaults", default_values: defaults, revision: 3, created_at: now, updated_at: now };
    const otherDatabase = { ...database, id: "db-2", name: "People" };
    const api = { request: vi.fn(async () => ({ template })) };
    render(createElement(DatabaseWorkbench, {
      database, databases: [database, otherDatabase], properties: typedProperties, records: [], templates: [template],
      views: [view("table", "table", { ...config, visible_columns: typedProperties.map((property) => property.id) })],
      client: new DatabaseClient(api, "ws-1", { createId: () => "template" }),
    }));
    fireEvent.click(screen.getByRole("button", { name: "数据库工具" }));
    const drawer = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(drawer).getByRole("button", { name: "模板" }));
    expect(within(drawer).getByLabelText("Name")).toHaveValue("Template");
    expect(within(drawer).getByLabelText("Score")).toHaveValue(7);
    expect(within(drawer).getByLabelText("Complete")).toBeChecked();
    expect(within(drawer).getByLabelText("Status")).toHaveValue("todo");
    expect(within(drawer).getByLabelText("Tags")).toHaveValue(["a"]);
    expect(within(drawer).getByLabelText("Due")).toHaveValue("2026-08-22");
    expect(within(drawer).getByLabelText("Website")).toHaveValue("https://example.com");
    expect(within(drawer).getByLabelText("Email")).toHaveValue("user@example.com");
    expect(within(drawer).getByLabelText("Assignee")).toHaveValue("user-2");
    expect(within(drawer).getByLabelText("Related")).toHaveValue("record-2");
    fireEvent.change(within(drawer).getByLabelText("Score"), { target: { value: "8" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "保存模板" }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/databases/db-1/templates/template-typed", body: expect.objectContaining({ base_revision: 3, default_values: { ...defaults, score: 8 } }),
    })));

    fireEvent.click(within(drawer).getByRole("button", { name: "属性" }));
    expect(within(drawer).getByLabelText("字段类型").querySelectorAll("option")).toHaveLength(10);
    fireEvent.change(within(drawer).getByLabelText("字段类型"), { target: { value: "relation" } });
    expect(within(drawer).getByRole("option", { name: "People" })).toHaveValue("db-2");
  });

  it("uses property-specific bulk controls and preserves a confirmed drag when the later bulk command fails", async () => {
    const { DatabaseWorkbench, DatabaseClient } = await web() as Record<string, any>;
    let rejectBulk!: (reason: Error) => void;
    const bulk = new Promise<never>((_, reject) => { rejectBulk = reject; });
    const api = { request: vi.fn(({ path }: { path: string }) => path.endsWith("/records/bulk") ? bulk : Promise.resolve({ items: [] })) };
    const move = vi.fn(async (input: any) => record(input.record_id, { name: "Race", status: input.option_id }, input.base_revision + 1));
    render(createElement(DatabaseWorkbench, {
      database, properties: typedProperties, records: [record("race", { name: "Race", status: "todo" })],
      views: [view("board", "board", { ...config, visible_columns: typedProperties.map((property) => property.id), grouping: { property_id: "status" }, settings: { segment_size: 10 } })],
      client: new DatabaseClient(api, "ws-1", { createId: () => "bulk" }), onBoardMove: move,
    }));
    fireEvent.dragStart(screen.getByTestId("board-card-race"));
    fireEvent.drop(screen.getByTestId("board-column-done"));
    await waitFor(() => expect(move).toHaveBeenCalledOnce());
    await waitFor(() => expect(within(screen.getByTestId("board-column-done")).getByTestId("board-card-race")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "数据库工具" }));
    const drawer = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(drawer).getByRole("button", { name: "批量" }));
    fireEvent.click(within(drawer).getByRole("checkbox"));
    const propertySelect = within(drawer).getByLabelText("字段");
    const expectedControls: Record<string, [string, string | null]> = {
      name: ["INPUT", "text"], score: ["INPUT", "number"], complete: ["INPUT", "checkbox"], status: ["SELECT", null], tags: ["SELECT", null],
      due: ["INPUT", "date"], website: ["INPUT", "url"], email: ["INPUT", "email"], assignee: ["INPUT", "text"], related: ["INPUT", "text"],
    };
    for (const [propertyId, [tag, type]] of Object.entries(expectedControls)) {
      fireEvent.change(propertySelect, { target: { value: propertyId } });
      const control = within(drawer).getByLabelText("新值");
      expect(control.tagName).toBe(tag);
      if (type) expect(control).toHaveAttribute("type", type);
    }
    fireEvent.change(propertySelect, { target: { value: "status" } });
    fireEvent.change(within(drawer).getByLabelText("新值"), { target: { value: "todo" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "预览并应用" }));
    rejectBulk(new Error("denied"));
    await waitFor(() => expect(within(screen.getByTestId("board-column-done")).getByTestId("board-card-race")).toBeInTheDocument());
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
    fireEvent.click(within(drawer).getByRole("button", { name: "记录" }));
    fireEvent.change(within(drawer).getByLabelText("Name"), { target: { value: "Mobile" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "创建记录" }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/databases/db-1/records", method: "POST" })));
    expect(document.querySelector('[data-mode="mobile"]')).toBeInTheDocument();
    expect(document.querySelector(".workbench-canvas")).toHaveAttribute("inert");
    expect(document.querySelectorAll('[data-scroll-owner="page"]')).toHaveLength(0);
    expect(document.querySelectorAll("[data-scroll-owner]")).toHaveLength(1);
    expect(drawer).toHaveAttribute("data-scroll-owner", "drawer");
    fireEvent.keyDown(drawer, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "数据库工具" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "数据库工具" })).toHaveFocus();
  });

  it("contains Tab focus in the tools drawer and returns focus after a view change", async () => {
    const { DatabaseWorkbench } = await web() as { DatabaseWorkbench: ComponentType<any> };
    render(createElement(DatabaseWorkbench, {
      database, properties: [name], records: [], views: [view("one", "table", config), view("two", "table", config)],
    }));
    const trigger = screen.getByRole("button", { name: "数据库工具" });
    fireEvent.click(trigger);
    const drawer = screen.getByRole("dialog", { name: "数据库工具" });
    const close = within(drawer).getByRole("button", { name: "关闭" });
    close.focus();
    fireEvent.keyDown(drawer, { key: "Tab", shiftKey: true });
    expect(document.activeElement).not.toBe(trigger);
    fireEvent.change(within(drawer).getByLabelText("视图"), { target: { value: "two" } });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "数据库工具" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
