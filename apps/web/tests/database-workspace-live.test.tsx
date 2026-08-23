import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "../src/app/App";

const now = "2026-08-21T00:00:00.000Z";
const database = { id: "db-1", workspace_id: "ws-1", name: "Projects", description: "Delivery", created_by: "user-1", revision: 1, created_at: now, updated_at: now };
const property = { id: "name", workspace_id: "ws-1", database_id: "db-1", name: "Name", type: "text", config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now };
const view = { id: "table", workspace_id: "ws-1", database_id: "db-1", name: "All", type: "table", config: { filters: [], sorts: [], grouping: null, visible_columns: ["name"], page_size: 50, settings: {} }, position: 0, revision: 1, created_at: now, updated_at: now };
const record = { id: "record-1", workspace_id: "ws-1", database_id: "db-1", note_id: null, values: { name: "Launch" }, created_by: "user-1", updated_by: "user-1", revision: 1, created_at: now, updated_at: now };
const authenticatedSession = {
  user: { id: "user-1", email: "user@example.com" },
  workspaces: [{ id: "ws-1", name: "Personal", slug: "personal", role: "owner" as const, revision: 1 }],
  active_workspace_id: "ws-1",
};

describe("live database workspace", () => {
  it("loads databases only after navigation and renders the workspace-bound first page", async () => {
    const authClient = { session: vi.fn(async () => authenticatedSession) };
    const apiClient = { request: vi.fn(async ({ path }: { path: string }) => {
      if (path === "/api/v2/databases") return { items: [database] };
      if (path === "/api/v2/databases/db-1") return { database, role: "owner", properties: [property], views: [view], templates: [] };
      if (path === "/api/v2/databases/db-1/records?view_id=table&limit=50") return { items: [record], next_cursor: null };
      return { items: [], next_cursor: null };
    }) };
    render(<App authClient={authClient as any} apiClient={apiClient as any} turnstileSiteKey="test" />);

    await screen.findByRole("heading", { name: "Public Beta 重写计划" });
    expect(apiClient.request.mock.calls.map(([options]) => options.path)).not.toContain("/api/v2/databases");
    fireEvent.click(screen.getByRole("button", { name: "数据库" }));

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByText("Launch")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开笔记列表" }));
    const createDatabaseButton = screen.getByRole("button", { name: "新建数据库" });
    expect(createDatabaseButton).toBeVisible();
    fireEvent.click(createDatabaseButton);
    expect(screen.getByRole("form", { name: "新建数据库表单" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "新建数据库名称" })).toBeInTheDocument();
    await waitFor(() => expect(apiClient.request.mock.calls.map(([options]) => options.path)).toEqual(expect.arrayContaining([
      "/api/v2/databases",
      "/api/v2/databases/db-1",
      "/api/v2/databases/db-1/records?view_id=table&limit=50",
    ])));
    expect(apiClient.request.mock.calls.filter(([options]) => options.path.startsWith("/api/v2/databases")).every(([options]) => options.headers["x-workspace-id"] === "ws-1")).toBe(true);
    expect(document.querySelectorAll('[data-scroll-owner="page"]')).toHaveLength(1);
  });

  it("creates the first database from the top-level empty workspace state", async () => {
    const authClient = { session: vi.fn(async () => authenticatedSession) };
    const created = { ...database, id: "db-new", name: "Roadmap" };
    const apiClient = { request: vi.fn(async ({ path, method }: { path: string; method?: string }) => {
      if (path === "/api/v2/databases" && method === "POST") return { database: created };
      if (path === "/api/v2/databases") return { items: [] };
      if (path === "/api/v2/databases/db-new") return { database: created, role: "owner", properties: [], views: [], templates: [] };
      if (path.startsWith("/api/v2/databases/db-new/records")) return { items: [], next_cursor: null };
      return { items: [] };
    }) };
    render(<App authClient={authClient as any} apiClient={apiClient as any} turnstileSiteKey="test" />);
    await screen.findByRole("heading", { name: "Public Beta 重写计划" });
    fireEvent.click(screen.getByRole("button", { name: "数据库" }));
    expect(await screen.findByRole("heading", { name: "创建第一个数据库" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("数据库名称"), { target: { value: "Roadmap" } });
    fireEvent.click(screen.getByRole("button", { name: "创建数据库" }));
    await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/databases", method: "POST", body: { name: "Roadmap", description: "" } })));
  });

  it("keeps child collection cursors local and propagates drawer modal state through App", async () => {
    const authClient = { session: vi.fn(async () => authenticatedSession) };
    const status = { ...property, id: "status", name: "Status", type: "select", position: 1, config: { options: [{ id: "todo", name: "Todo" }, { id: "done", name: "Done" }] } };
    const board = { ...view, id: "board", name: "Board", type: "board", config: { ...view.config, visible_columns: ["name", "status"], grouping: { property_id: "status" }, page_size: 1, settings: { segment_size: 10 } } };
    const first = { ...record, values: { name: "First", status: "todo" } };
    const later = { ...record, id: "record-2", values: { name: "Later", status: "done" } };
    const apiClient = { request: vi.fn(async ({ path }: { path: string }) => {
      if (path === "/api/v2/databases") return { items: [database] };
      if (path === "/api/v2/databases/db-1") return { database, role: "owner", properties: [property, status], views: [board], templates: [] };
      if (path === "/api/v2/databases/db-1/records?view_id=board&limit=1") return { items: [first], next_cursor: "board-next" };
      if (path === "/api/v2/databases/db-1/records?cursor=board-next&view_id=board&limit=100") return { items: [later], next_cursor: null };
      return { items: [], next_cursor: null };
    }) };
    render(<App authClient={authClient as any} apiClient={apiClient as any} turnstileSiteKey="test" />);
    await screen.findByRole("heading", { name: "Public Beta 重写计划" });
    fireEvent.click(screen.getByRole("button", { name: "数据库" }));
    await screen.findByTestId("board-card-record-1");

    fireEvent.click(screen.getByRole("button", { name: "加载更多记录" }));
    expect(await screen.findByTestId("board-card-record-2")).toBeInTheDocument();
    expect(screen.getByTestId("board-card-record-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "数据库工具" }));
    const drawer = await screen.findByRole("dialog", { name: "数据库工具" });
    expect(document.querySelector(".workbench-canvas")).toHaveAttribute("inert");
    expect(document.querySelectorAll('[data-scroll-owner="page"]')).toHaveLength(0);
    expect(drawer).toHaveAttribute("data-scroll-owner", "drawer");
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByTestId("board-card-record-2")).toBeInTheDocument();
    expect(screen.getByTestId("board-card-record-1")).toBeInTheDocument();
  });
});
