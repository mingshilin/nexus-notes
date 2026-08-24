import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

const now = "2026-08-21T00:00:00.000Z";
const database = {
  id: "db-1", workspace_id: "ws-1", name: "Projects", description: "Delivery",
  created_by: "user-1", revision: 1, created_at: now, updated_at: now,
};
const name = {
  id: "name", workspace_id: "ws-1", database_id: "db-1", name: "Name", type: "text",
  config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now,
};
const view = {
  id: "table", workspace_id: "ws-1", database_id: "db-1", name: "All", type: "table",
  config: { filters: [], sorts: [], grouping: null, visible_columns: ["name"], page_size: 50, settings: {} },
  position: 0, revision: 1, created_at: now, updated_at: now,
};

async function web() {
  return await import("../src/index") as Record<string, unknown>;
}

function openManagementCenter(DatabaseWorkbench: ComponentType<any>, client: Record<string, unknown>, collaborationClient?: Record<string, unknown>) {
  render(createElement(DatabaseWorkbench, {
    database,
    properties: [name],
    records: [{
      id: "record-1", workspace_id: "ws-1", database_id: "db-1", note_id: null,
      values: { name: "Launch" }, created_by: "user-1", updated_by: "user-1",
      revision: 1, created_at: now, updated_at: now,
    }],
    views: [view],
    client,
    collaborationClient,
  }));
  fireEvent.click(screen.getByRole("button", { name: "数据库工具" }));
  return screen.getByRole("dialog", { name: "数据库工具" });
}

describe("database management center", () => {
  it("opens on an overview backed by database stats", async () => {
    const { DatabaseWorkbench } = await web() as { DatabaseWorkbench: ComponentType<any> };
    const client = {
      getStats: vi.fn(async () => ({
        record_count: 12, property_count: 4, view_count: 3, template_count: 2,
        comment_count: 5, updated_at: now, role: "owner",
        database_permission_count: 2, field_permission_count: 1,
      })),
    };

    const drawer = openManagementCenter(DatabaseWorkbench, client);

    expect(within(drawer).getByRole("heading", { name: "数据库管理中心" })).toBeInTheDocument();
    expect(await within(drawer).findByText("12", { selector: "strong" })).toBeInTheDocument();
    const overview = within(drawer).getByRole("region", { name: "数据库概览" });
    expect(within(overview).getByText("记录")).toBeInTheDocument();
    expect(within(overview).getByText("属性")).toBeInTheDocument();
    expect(within(overview).getByText("所有者")).toBeInTheDocument();
    expect(client.getStats).toHaveBeenCalledOnce();
  });

  it("uses workspace members and explains inherited and effective permissions", async () => {
    const { DatabaseWorkbench } = await web() as { DatabaseWorkbench: ComponentType<any> };
    const client = {
      getStats: vi.fn(async () => ({
        record_count: 1, property_count: 1, view_count: 1, template_count: 0,
        comment_count: 0, updated_at: now, role: "owner",
        database_permission_count: 1, field_permission_count: 1,
      })),
      listDatabasePermissions: vi.fn(async () => [{
        id: "database-permission", workspace_id: "ws-1", database_id: "db-1",
        subject_type: "user", subject_id: "user-2", role: "viewer", revision: 1, updated_at: now,
      }]),
      listFieldPermissions: vi.fn(async () => [{
        id: "field-permission", workspace_id: "ws-1", database_id: "db-1", property_id: "name",
        subject_type: "user", subject_id: "user-2", can_read: true, can_write: false, revision: 1, updated_at: now,
      }]),
    };
    const collaborationClient = {
      listMembers: vi.fn(async () => [{
        user_id: "user-2", email: "lin@example.com", display_name: "Lin",
        role: "editor", revision: 1, joined_at: now, updated_at: now,
      }]),
    };
    const drawer = openManagementCenter(DatabaseWorkbench, client, collaborationClient);

    fireEvent.click(within(drawer).getByRole("button", { name: "权限" }));

    expect(await within(drawer).findByRole("option", { name: "Lin · lin@example.com" })).toHaveValue("user-2");
    expect(within(drawer).getByText("继承 editor")).toBeInTheDocument();
    expect(within(drawer).getByText("最终 viewer")).toBeInTheDocument();
    expect(within(drawer).getByRole("table", { name: "字段权限矩阵" })).toBeInTheDocument();
  });

  it("maps CSV headers, previews rows, and pinpoints type errors before import", async () => {
    const { DatabaseWorkbench } = await web() as { DatabaseWorkbench: ComponentType<any> };
    const client = {
      getStats: vi.fn(async () => ({
        record_count: 1, property_count: 1, view_count: 1, template_count: 0,
        comment_count: 0, updated_at: now, role: "owner",
        database_permission_count: 0, field_permission_count: 0,
      })),
      previewCsv: vi.fn(async () => ({
        headers: ["Name"],
        rows: [{ row_number: 2, values: { name: "Launch" } }],
        errors: [{ row_number: 3, code: "INVALID_FIELD_VALUE", message: "类型不匹配" }],
        total_rows: 2,
      })),
    };
    const drawer = openManagementCenter(DatabaseWorkbench, client);
    fireEvent.click(within(drawer).getByRole("button", { name: "导入导出" }));
    fireEvent.change(within(drawer).getByLabelText("CSV 内容"), {
      target: { value: "Name\r\nLaunch\r\nBroken" },
    });

    expect(within(drawer).getByLabelText("字段映射 Name")).toHaveValue("name");
    fireEvent.click(within(drawer).getByRole("button", { name: "预览 CSV" }));

    await waitFor(() => expect(client.previewCsv).toHaveBeenCalledWith("db-1", {
      csv: "Name\nLaunch\nBroken",
      header_property_ids: { Name: "name" },
    }));
    expect(await within(drawer).findByText("第 3 行 · INVALID_FIELD_VALUE · 类型不匹配")).toBeInTheDocument();
    expect(within(drawer).getByText("Launch")).toBeInTheDocument();
  });
});
