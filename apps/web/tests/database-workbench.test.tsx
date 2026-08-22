import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

async function loadWeb() {
  return await import("../src/index") as Record<string, any>;
}

const now = "2026-08-21T00:00:00.000Z";
const database = { id: "db-1", workspace_id: "ws-1", name: "Projects", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now };
const textProperty = { id: "name", workspace_id: "ws-1", database_id: "db-1", name: "Name", type: "text", config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now };
const statusProperty = { id: "status", workspace_id: "ws-1", database_id: "db-1", name: "Status", type: "select", config: { options: [{ id: "todo", name: "Todo", color: "blue" }, { id: "done", name: "Done", color: "green" }] }, position: 1, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now };
const dateProperty = { id: "due", workspace_id: "ws-1", database_id: "db-1", name: "Due", type: "date", config: {}, position: 2, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now };

function record(index: number, values: Record<string, unknown>) {
  return { id: `record-${index}`, workspace_id: "ws-1", database_id: "db-1", note_id: null, values, created_by: "user-1", updated_by: "user-1", revision: 1, created_at: now, updated_at: now };
}

function view(id: string, type: "table" | "board" | "calendar", config: Record<string, unknown>) {
  return { id, workspace_id: "ws-1", database_id: "db-1", name: type, type, config, position: 0, revision: 1, created_at: now, updated_at: now };
}

const baseConfig = { filters: [], sorts: [], grouping: null, visible_columns: ["name", "status", "due"], page_size: 50, settings: {} };

describe("DatabaseWorkbench", () => {
  it("bounds 5,000 table records to the persisted page size without adding a vertical scroll owner", async () => {
    const web = await loadWeb();
    expect(web.DatabaseWorkbench).toBeTypeOf("function");
    const Workbench = web.DatabaseWorkbench as ComponentType<any>;
    const records = Array.from({ length: 5_000 }, (_, index) => record(index, { name: `Project ${index}` }));
    const { container } = render(createElement(Workbench, {
      database, properties: [textProperty], records,
      views: [view("table", "table", { ...baseConfig, visible_columns: ["name"], page_size: 50 })],
      activeViewId: "table",
    }));

    expect(container.querySelectorAll(".database-record-row")).toHaveLength(50);
    expect(container.querySelectorAll("[data-scroll-owner]")).toHaveLength(0);
    expect(screen.getByText("1–50 / 5000")).toBeInTheDocument();
  });

  it("loads the next stable cursor page and persists its request cursor", async () => {
    const web = await loadWeb();
    const Workbench = web.DatabaseWorkbench as ComponentType<any>;
    const pageStorage = new Map<string, string>();
    const pageStore = new web.DatabasePaginationStore({
      getItem: (key: string) => pageStorage.get(key) ?? null,
      setItem: (key: string, value: string) => pageStorage.set(key, value),
    });
    const onRecordsPageRequest = vi.fn(async ({ cursor }: { cursor: string | null }) => ({
      items: [record(2, { name: "Project 2" }), record(3, { name: "Project 3" })],
      next_cursor: cursor === "cursor-1" ? "cursor-2" : null,
    }));

    render(createElement(Workbench, {
      database, properties: [textProperty], records: [record(0, { name: "Project 0" }), record(1, { name: "Project 1" })],
      recordsNextCursor: "cursor-1", paginationStore: pageStore,
      views: [view("table", "table", { ...baseConfig, page_size: 2 })], activeViewId: "table",
      onRecordsPageRequest,
    }));

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(onRecordsPageRequest).toHaveBeenCalledWith(expect.objectContaining({ cursor: "cursor-1", limit: 2, viewId: "table" })));
    expect(await screen.findByText("3–4 / 4+")).toBeInTheDocument();
    expect(pageStore.read("ws-1", "db-1", "table")).toEqual({ page: 2, pageSize: 2, cursors: { 1: null, 2: "cursor-1", 3: "cursor-2" } });
  });

  it("segments board columns and restores the dragged record when the command fails", async () => {
    const web = await loadWeb();
    const Workbench = web.DatabaseWorkbench as ComponentType<any>;
    const onBoardMove = vi.fn(async () => { throw new Error("denied"); });
    const records = Array.from({ length: 500 }, (_, index) => record(index, { name: `Project ${index}`, status: index % 2 ? "todo" : "done" }));
    const { container } = render(createElement(Workbench, {
      database, properties: [textProperty, statusProperty], records,
      views: [view("board", "board", { ...baseConfig, grouping: { property_id: "status" }, settings: { segment_size: 40, card_properties: ["name"] } })],
      activeViewId: "board", onBoardMove,
    }));

    expect(container.querySelectorAll(".database-board-card").length).toBeLessThanOrEqual(80);
    const card = screen.getByTestId("board-card-record-1");
    fireEvent.dragStart(card);
    fireEvent.dragOver(screen.getByTestId("board-column-done"));
    fireEvent.drop(screen.getByTestId("board-column-done"));
    expect(within(screen.getByTestId("board-column-done")).getByTestId("board-card-record-1")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("移动失败");
    await waitFor(() => expect(within(screen.getByTestId("board-column-todo")).getByTestId("board-card-record-1")).toBeInTheDocument());
  });

  it("assigns undated records and records dragged from the calendar more panel", async () => {
    const web = await loadWeb();
    const Workbench = web.DatabaseWorkbench as ComponentType<any>;
    const onCalendarAssign = vi.fn(async (input: any) => ({ ...record(99, {}), id: input.record_id, revision: input.base_revision + 1, values: { due: input.date } }));
    const records = [
      ...Array.from({ length: 5 }, (_, index) => record(index, { name: `Dated ${index}`, due: "2026-08-21" })),
      record(10, { name: "Undated", due: null }),
    ];
    render(createElement(Workbench, {
      database, properties: [textProperty, dateProperty], records,
      views: [view("calendar", "calendar", { ...baseConfig, settings: { date_property_id: "due", show_undated: true } })],
      activeViewId: "calendar", onCalendarAssign,
    }));

    expect(screen.getByTestId("calendar-undated")).toHaveTextContent("Undated");
    fireEvent.click(screen.getByRole("button", { name: "2026-08-21 更多 2 条" }));
    const panel = screen.getByRole("dialog", { name: "2026-08-21 更多记录" });
    const overflowCard = within(panel).getByTestId("calendar-card-record-3");
    fireEvent.dragStart(overflowCard);
    fireEvent.dragOver(screen.getByTestId("calendar-day-2026-08-22"));
    fireEvent.drop(screen.getByTestId("calendar-day-2026-08-22"));

    await waitFor(() => expect(onCalendarAssign).toHaveBeenCalledWith({ record_id: "record-3", property_id: "due", date: "2026-08-22", base_revision: 1 }));
    fireEvent.dragStart(screen.getByTestId("calendar-undated-record-10"));
    fireEvent.drop(screen.getByTestId("calendar-day-2026-08-22"));
    await waitFor(() => expect(onCalendarAssign).toHaveBeenCalledTimes(2));
  });

  it("segments every undated calendar record instead of truncating after sixty", async () => {
    const web = await loadWeb();
    const Workbench = web.DatabaseWorkbench as ComponentType<any>;
    const records = Array.from({ length: 125 }, (_, index) => record(index, { name: `Undated ${index}`, due: null }));
    render(createElement(Workbench, {
      database, properties: [textProperty, dateProperty], records,
      views: [view("calendar", "calendar", { ...baseConfig, settings: { date_property_id: "due", show_undated: true, segment_size: 50 } })],
      activeViewId: "calendar",
    }));

    expect(document.querySelectorAll(".database-calendar-undated .database-calendar-card")).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "加载更多未安排 75" }));
    fireEvent.click(screen.getByRole("button", { name: "加载更多未安排 25" }));
    expect(document.querySelectorAll(".database-calendar-undated .database-calendar-card")).toHaveLength(125);
  });

  it("opens a compact mobile database tools drawer", async () => {
    const web = await loadWeb();
    const Workbench = web.DatabaseWorkbench as ComponentType<any>;
    const { container } = render(createElement(Workbench, {
      database, properties: [textProperty], records: [],
      views: [view("table", "table", { ...baseConfig, visible_columns: ["name"] })], activeViewId: "table",
    }));
    fireEvent.click(screen.getByRole("button", { name: "数据库工具" }));
    expect(screen.getByRole("dialog", { name: "数据库工具" })).toHaveAttribute("data-scroll-owner", "drawer");
    expect(container.querySelector(".database-workbench")).toHaveAttribute("inert");
  });
});
