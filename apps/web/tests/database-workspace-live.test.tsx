import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "../src/app/App";

const now = "2026-08-21T00:00:00.000Z";
const database = { id: "db-1", workspace_id: "ws-1", name: "Projects", description: "Delivery", created_by: "user-1", revision: 1, created_at: now, updated_at: now };
const property = { id: "name", workspace_id: "ws-1", database_id: "db-1", name: "Name", type: "text", config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now };
const view = { id: "table", workspace_id: "ws-1", database_id: "db-1", name: "All", type: "table", config: { filters: [], sorts: [], grouping: null, visible_columns: ["name"], page_size: 50, settings: {} }, position: 0, revision: 1, created_at: now, updated_at: now };
const record = { id: "record-1", workspace_id: "ws-1", database_id: "db-1", note_id: null, values: { name: "Launch" }, created_by: "user-1", updated_by: "user-1", revision: 1, created_at: now, updated_at: now };

describe("live database workspace", () => {
  it("loads databases only after navigation and renders the workspace-bound first page", async () => {
    const authClient = { session: vi.fn(async () => ({ user: { id: "user-1", email: "user@example.com" }, active_workspace_id: "ws-1" })) };
    const apiClient = { request: vi.fn(async ({ path }: { path: string }) => {
      if (path === "/api/v2/databases") return { items: [database] };
      if (path === "/api/v2/databases/db-1") return { database, role: "owner", properties: [property], views: [view], templates: [] };
      if (path === "/api/v2/databases/db-1/records?limit=50") return { items: [record], next_cursor: null };
      return { items: [], next_cursor: null };
    }) };
    render(<App authClient={authClient as any} apiClient={apiClient as any} turnstileSiteKey="test" />);

    await screen.findByRole("heading", { name: "Public Beta 重写计划" });
    expect(apiClient.request.mock.calls.map(([options]) => options.path)).not.toContain("/api/v2/databases");
    fireEvent.click(screen.getByRole("button", { name: "数据库" }));

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByText("Launch")).toBeInTheDocument();
    await waitFor(() => expect(apiClient.request.mock.calls.map(([options]) => options.path)).toEqual(expect.arrayContaining([
      "/api/v2/databases",
      "/api/v2/databases/db-1",
      "/api/v2/databases/db-1/records?limit=50",
    ])));
    expect(apiClient.request.mock.calls.filter(([options]) => options.path.startsWith("/api/v2/databases")).every(([options]) => options.headers["x-workspace-id"] === "ws-1")).toBe(true);
    expect(document.querySelectorAll('[data-scroll-owner="page"]')).toHaveLength(1);
  });
});
