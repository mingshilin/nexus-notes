import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { DatabaseToolsDrawer } from "../src/databases/DatabaseToolsDrawer";

const now = "2026-08-29T00:00:00.000Z";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeDatabase(id: string) {
  return {
    id,
    workspace_id: "workspace-1",
    name: id === "db-a" ? "数据库 A" : "数据库 B",
    description: "用于恢复测试",
    created_by: "owner-1",
    revision: 1,
    created_at: now,
    updated_at: now,
  };
}

function makeProperty(databaseId: string) {
  return {
    id: "name",
    workspace_id: "workspace-1",
    database_id: databaseId,
    name: "Name",
    type: "text",
    config: {},
    position: 0,
    hidden: false,
    read_only: false,
    revision: 1,
    created_at: now,
    updated_at: now,
  };
}

function makeRecord(databaseId: string) {
  return {
    id: "record-1",
    workspace_id: "workspace-1",
    database_id: databaseId,
    note_id: null,
    values: { name: "Launch" },
    created_by: "owner-1",
    updated_by: "owner-1",
    revision: 1,
    created_at: now,
    updated_at: now,
  };
}

function makeView(databaseId: string) {
  return {
    id: "table",
    workspace_id: "workspace-1",
    database_id: databaseId,
    name: "全部",
    type: "table",
    config: { filters: [], sorts: [], grouping: null, visible_columns: ["name"], page_size: 50, settings: {} },
    position: 0,
    revision: 1,
    created_at: now,
    updated_at: now,
  };
}

function makeStats() {
  return {
    record_count: 1,
    property_count: 1,
    view_count: 1,
    template_count: 0,
    comment_count: 0,
    updated_at: now,
    role: "owner" as const,
    database_permission_count: 0,
    field_permission_count: 0,
  };
}

function renderDrawer(databaseId: string, client: Record<string, unknown>, collaborationClient?: Record<string, unknown>) {
  const database = makeDatabase(databaseId);
  const view = makeView(databaseId);
  const element = (overrides: Record<string, unknown> = {}): ReactElement => (
    <DatabaseToolsDrawer
      open
      database={database}
      databaseId={databaseId}
      properties={[makeProperty(databaseId)]}
      records={[makeRecord(databaseId)]}
      views={[view]}
      activeViewId={view.id}
      client={client as never}
      collaborationClient={collaborationClient as never}
      onOpenChange={vi.fn()}
      onViewChange={vi.fn()}
      {...overrides}
    />
  );
  return { ...render(element()), element };
}

function statsClient(extra: Record<string, unknown> = {}) {
  return {
    getStats: vi.fn(async () => makeStats()),
    ...extra,
  };
}

describe("database management recovery", () => {
  it("preserves CSV input and mappings, then retries a failed preview", async () => {
    const preview = {
      headers: ["Name"],
      rows: [{ row_number: 2, values: { name: "Launch" } }],
      errors: [],
      total_rows: 1,
    };
    const client = statsClient({
      previewCsv: vi.fn()
        .mockRejectedValueOnce(new Error("temporary preview failure"))
        .mockResolvedValueOnce(preview),
    });
    const drawer = renderDrawer("db-a", client);

    fireEvent.click(within(screen.getByRole("dialog", { name: "数据库工具" })).getByRole("button", { name: "导入导出" }));
    const management = screen.getByRole("dialog", { name: "数据库工具" });
    const csvText = "Name\nLaunch";
    fireEvent.change(within(management).getByLabelText("CSV 内容"), { target: { value: csvText } });
    await waitFor(() => expect(within(management).getByLabelText("字段映射 Name")).toHaveValue("name"));

    fireEvent.click(within(management).getByRole("button", { name: "预览 CSV" }));
    await waitFor(() => expect(client.previewCsv).toHaveBeenCalledTimes(1));

    expect(within(management).getByLabelText("CSV 内容")).toHaveValue(csvText);
    expect(within(management).getByLabelText("字段映射 Name")).toHaveValue("name");
    expect(await within(management).findByRole("alert")).toHaveTextContent("CSV 预览失败");

    fireEvent.click(within(management).getByRole("button", { name: "重试 CSV 预览" }));
    await waitFor(() => expect(client.previewCsv).toHaveBeenCalledTimes(2));
    expect(await within(management).findByRole("region", { name: "CSV 预览" })).toBeInTheDocument();
    expect(within(management).queryByRole("alert")).not.toBeInTheDocument();
    expect(client.previewCsv).toHaveBeenNthCalledWith(2, "db-a", {
      csv: csvText,
      header_property_ids: { Name: "name" },
    }, expect.any(AbortSignal));
    void drawer;
  });

  it("does not show a late comment response from the previous database", async () => {
    const commentsA = deferred<Array<{ id: string; body: string }>>();
    const commentsB = deferred<Array<{ id: string; body: string }>>();
    const client = statsClient({
      listComments: vi.fn((databaseId: string) => databaseId === "db-a" ? commentsA.promise : commentsB.promise),
    });
    const rendered = renderDrawer("db-a", client);
    let management = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(management).getByRole("button", { name: "评论" }));
    await waitFor(() => expect(client.listComments).toHaveBeenCalledWith("db-a", "record-1", expect.any(AbortSignal)));

    rendered.rerender(rendered.element({
      database: makeDatabase("db-b"),
      databaseId: "db-b",
      properties: [makeProperty("db-b")],
      records: [makeRecord("db-b")],
      views: [makeView("db-b")],
    }));
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "数据库工具" })).getByRole("button", { name: "概览" })).toBeInTheDocument());
    management = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(management).getByRole("button", { name: "评论" }));
    await waitFor(() => expect(client.listComments).toHaveBeenCalledWith("db-b", "record-1", expect.any(AbortSignal)));

    await act(async () => {
      commentsA.resolve([{ id: "comment-a", body: "来自数据库 A" }]);
      await Promise.resolve();
    });
    expect(screen.queryByText("来自数据库 A")).not.toBeInTheDocument();

    await act(async () => {
      commentsB.resolve([{ id: "comment-b", body: "来自数据库 B" }]);
      await Promise.resolve();
    });
    expect(await screen.findByText("来自数据库 B")).toBeInTheDocument();
  });

  it("does not show late database or field permissions from the previous database", async () => {
    const permissionsA = deferred<Array<Record<string, unknown>>>();
    const permissionsB = deferred<Array<Record<string, unknown>>>();
    const fieldsA = deferred<Array<Record<string, unknown>>>();
    const fieldsB = deferred<Array<Record<string, unknown>>>();
    const client = statsClient({
      listDatabasePermissions: vi.fn((databaseId: string) => databaseId === "db-a" ? permissionsA.promise : permissionsB.promise),
      listFieldPermissions: vi.fn((databaseId: string) => databaseId === "db-a" ? fieldsA.promise : fieldsB.promise),
    });
    const collaborationClient = { listMembers: vi.fn(async () => []) };
    const rendered = renderDrawer("db-a", client, collaborationClient);
    let management = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(management).getByRole("button", { name: "权限" }));
    await waitFor(() => expect(client.listDatabasePermissions).toHaveBeenCalledWith("db-a", expect.any(AbortSignal)));

    rendered.rerender(rendered.element({
      database: makeDatabase("db-b"),
      databaseId: "db-b",
      properties: [makeProperty("db-b")],
      records: [makeRecord("db-b")],
      views: [makeView("db-b")],
    }));
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "数据库工具" })).getByRole("button", { name: "概览" })).toBeInTheDocument());
    management = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(management).getByRole("button", { name: "权限" }));
    await waitFor(() => expect(client.listDatabasePermissions).toHaveBeenCalledWith("db-b", expect.any(AbortSignal)));

    await act(async () => {
      permissionsA.resolve([{ id: "permission-a", subject_id: "user-a", subject_type: "user", role: "viewer", revision: 1 }]);
      fieldsA.resolve([{ id: "field-a", property_id: "name", subject_id: "user-a", subject_type: "user", can_read: false, can_write: false, revision: 1 }]);
      await Promise.resolve();
    });
    expect(screen.queryAllByText(/user-a/)).toHaveLength(0);

    await act(async () => {
      permissionsB.resolve([{ id: "permission-b", subject_id: "user-b", subject_type: "user", role: "editor", revision: 1 }]);
      fieldsB.resolve([{ id: "field-b", property_id: "name", subject_id: "user-b", subject_type: "user", can_read: true, can_write: true, revision: 1 }]);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryAllByText(/user-b/).length).toBeGreaterThan(0));
  });

  it("keeps the readable member selector when an old member response arrives late", async () => {
    const membersA = deferred<Array<Record<string, unknown>>>();
    const memberB = { user_id: "user-b", display_name: "Lin B", email: "b@example.com", role: "editor", revision: 1, joined_at: now, updated_at: now };
    const memberA = { user_id: "user-a", display_name: "Lin A", email: "a@example.com", role: "viewer", revision: 1, joined_at: now, updated_at: now };
    const client = statsClient({
      listDatabasePermissions: vi.fn(async () => []),
      listFieldPermissions: vi.fn(async () => []),
    });
    const collaborationA = { listMembers: vi.fn(() => membersA.promise) };
    const collaborationB = { listMembers: vi.fn(async () => [memberB]) };
    const rendered = renderDrawer("db-a", client, collaborationA);
    let management = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(management).getByRole("button", { name: "权限" }));
    await waitFor(() => expect(collaborationA.listMembers).toHaveBeenCalledOnce());

    rendered.rerender(rendered.element({
      database: makeDatabase("db-b"),
      databaseId: "db-b",
      properties: [makeProperty("db-b")],
      records: [makeRecord("db-b")],
      views: [makeView("db-b")],
      collaborationClient: collaborationB,
    }));
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "数据库工具" })).getByRole("button", { name: "概览" })).toBeInTheDocument());
    management = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(management).getByRole("button", { name: "权限" }));
    expect(await within(management).findByRole("option", { name: "Lin B · b@example.com" })).toHaveValue("user-b");

    await act(async () => {
      membersA.resolve([memberA]);
      await Promise.resolve();
    });
    expect(within(management).getByRole("option", { name: "Lin B · b@example.com" })).toBeInTheDocument();
    expect(within(management).queryByRole("option", { name: "Lin A · a@example.com" })).not.toBeInTheDocument();
    expect(within(management).queryByLabelText("成员 ID")).not.toBeInTheDocument();
  });

  it("ignores a delayed database-permission refresh after switching databases", async () => {
    const refreshA = deferred<Array<Record<string, unknown>>>();
    let databaseAListCalls = 0;
    const permissionA = { id: "permission-a", subject_id: "user-a", subject_type: "user", role: "viewer", revision: 2 };
    const permissionB = { id: "permission-b", subject_id: "user-b", subject_type: "user", role: "editor", revision: 1 };
    const client = statsClient({
      setDatabasePermission: vi.fn(async () => ({})),
      listDatabasePermissions: vi.fn((databaseId: string) => {
        if (databaseId === "db-a") {
          databaseAListCalls += 1;
          return databaseAListCalls === 1 ? Promise.resolve([]) : refreshA.promise;
        }
        return Promise.resolve([permissionB]);
      }),
      listFieldPermissions: vi.fn(async () => []),
    });
    const rendered = renderDrawer("db-a", client);
    let management = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(management).getByRole("button", { name: "权限" }));
    await waitFor(() => expect(client.listDatabasePermissions).toHaveBeenCalledWith("db-a", expect.any(AbortSignal)));

    fireEvent.change(within(management).getByLabelText("成员 ID"), { target: { value: "user-a" } });
    fireEvent.click(within(management).getByRole("button", { name: "保存权限" }));
    await waitFor(() => {
      expect(client.setDatabasePermission).toHaveBeenCalledWith("db-a", expect.objectContaining({ subject_id: "user-a" }));
      expect(client.listDatabasePermissions).toHaveBeenCalledTimes(2);
    });
    expect(client.listDatabasePermissions).toHaveBeenNthCalledWith(2, "db-a", expect.any(AbortSignal));

    rendered.rerender(rendered.element({
      database: makeDatabase("db-b"),
      databaseId: "db-b",
      properties: [makeProperty("db-b")],
      records: [makeRecord("db-b")],
      views: [makeView("db-b")],
    }));
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "数据库工具" })).getByRole("button", { name: "概览" })).toBeInTheDocument());
    management = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(management).getByRole("button", { name: "权限" }));
    await waitFor(() => expect(client.listDatabasePermissions).toHaveBeenCalledWith("db-b", expect.any(AbortSignal)));
    await waitFor(() => expect(screen.queryAllByText(/user-b/).length).toBeGreaterThan(0));

    await act(async () => {
      refreshA.resolve([permissionA]);
      await Promise.resolve();
    });
    expect(screen.queryAllByText(/user-a/)).toHaveLength(0);
    expect(screen.queryAllByText(/user-b/).length).toBeGreaterThan(0);
  });

  it("ignores a delayed field-permission refresh after switching databases", async () => {
    const refreshA = deferred<Array<Record<string, unknown>>>();
    let fieldAListCalls = 0;
    const permissionA = { id: "field-a", property_id: "name", subject_id: "user-a", subject_type: "user", can_read: true, can_write: false, revision: 2 };
    const permissionB = { id: "field-b", property_id: "name", subject_id: "user-b", subject_type: "user", can_read: true, can_write: true, revision: 1 };
    const client = statsClient({
      setFieldPermission: vi.fn(async () => ({})),
      listDatabasePermissions: vi.fn(async () => []),
      listFieldPermissions: vi.fn((databaseId: string) => {
        if (databaseId === "db-a") {
          fieldAListCalls += 1;
          return fieldAListCalls === 1 ? Promise.resolve([]) : refreshA.promise;
        }
        return Promise.resolve([permissionB]);
      }),
    });
    const rendered = renderDrawer("db-a", client);
    let management = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(management).getByRole("button", { name: "权限" }));
    await waitFor(() => expect(client.listFieldPermissions).toHaveBeenCalledWith("db-a", "name", expect.any(AbortSignal)));

    fireEvent.change(within(management).getByLabelText("成员 ID"), { target: { value: "user-a" } });
    fireEvent.click(within(management).getByRole("button", { name: "保存字段权限" }));
    await waitFor(() => {
      expect(client.setFieldPermission).toHaveBeenCalledWith("db-a", "name", expect.objectContaining({ subject_id: "user-a" }));
      expect(client.listFieldPermissions).toHaveBeenCalledTimes(2);
    });
    expect(client.listFieldPermissions).toHaveBeenNthCalledWith(2, "db-a", "name", expect.any(AbortSignal));

    rendered.rerender(rendered.element({
      database: makeDatabase("db-b"),
      databaseId: "db-b",
      properties: [makeProperty("db-b")],
      records: [makeRecord("db-b")],
      views: [makeView("db-b")],
    }));
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "数据库工具" })).getByRole("button", { name: "概览" })).toBeInTheDocument());
    management = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(management).getByRole("button", { name: "权限" }));
    await waitFor(() => expect(client.listFieldPermissions).toHaveBeenCalledWith("db-b", "name", expect.any(AbortSignal)));
    await waitFor(() => expect(screen.queryAllByText(/user-b/).length).toBeGreaterThan(0));

    await act(async () => {
      refreshA.resolve([permissionA]);
      await Promise.resolve();
    });
    expect(screen.queryAllByText(/user-a/)).toHaveLength(0);
    expect(screen.queryAllByText(/user-b/).length).toBeGreaterThan(0);
  });

  it("keeps panel permission loading ownership separate from a post-save refresh", async () => {
    const initialLoad = deferred<Array<Record<string, unknown>>>();
    const saveRefresh = deferred<Array<Record<string, unknown>>>();
    let listCalls = 0;
    const client = statsClient({
      setDatabasePermission: vi.fn(async () => ({})),
      listDatabasePermissions: vi.fn((_databaseId: string, _signal?: AbortSignal) => {
        listCalls += 1;
        return listCalls === 1 ? initialLoad.promise : saveRefresh.promise;
      }),
      listFieldPermissions: vi.fn(async () => []),
    });
    renderDrawer("db-a", client);
    const management = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(management).getByRole("button", { name: "权限" }));
    await waitFor(() => expect(client.listDatabasePermissions).toHaveBeenCalledTimes(1));
    const initialSignal = client.listDatabasePermissions.mock.calls[0]?.[1] as AbortSignal;

    fireEvent.change(within(management).getByLabelText("成员 ID"), { target: { value: "user-a" } });
    fireEvent.click(within(management).getByRole("button", { name: "保存权限" }));
    await waitFor(() => expect(client.listDatabasePermissions).toHaveBeenCalledTimes(2));

    expect(initialSignal.aborted).toBe(false);
    await act(async () => {
      initialLoad.resolve([{ id: "stale-load", subject_id: "stale-user", subject_type: "user", role: "viewer", revision: 1 }]);
      await Promise.resolve();
    });
    expect(screen.queryByText(/stale-user/)).not.toBeInTheDocument();

    await act(async () => {
      saveRefresh.resolve([{ id: "saved", subject_id: "user-a", subject_type: "user", role: "viewer", revision: 2 }]);
      await Promise.resolve();
    });
    expect(await screen.findByText(/user-a/)).toBeInTheDocument();
  });

  it("silently discards a superseded post-save refresh in the same database panel", async () => {
    const saveRefresh = deferred<Array<Record<string, unknown>>>();
    let listCalls = 0;
    const originalClient = statsClient({
      setDatabasePermission: vi.fn(async () => ({})),
      listDatabasePermissions: vi.fn(() => {
        listCalls += 1;
        return listCalls === 1 ? Promise.resolve([]) : saveRefresh.promise;
      }),
      listFieldPermissions: vi.fn(async () => []),
    });
    const replacementClient = statsClient({
      setDatabasePermission: vi.fn(async () => ({})),
      listDatabasePermissions: vi.fn(async () => [{ id: "current", subject_id: "current-user", subject_type: "user", role: "editor", revision: 1 }]),
      listFieldPermissions: vi.fn(async () => []),
    });
    const rendered = renderDrawer("db-a", originalClient);
    let management = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(management).getByRole("button", { name: "权限" }));
    await waitFor(() => expect(originalClient.listDatabasePermissions).toHaveBeenCalledTimes(1));
    fireEvent.change(within(management).getByLabelText("成员 ID"), { target: { value: "user-a" } });
    fireEvent.click(within(management).getByRole("button", { name: "保存权限" }));
    await waitFor(() => expect(originalClient.listDatabasePermissions).toHaveBeenCalledTimes(2));

    rendered.rerender(rendered.element({ client: replacementClient }));
    management = screen.getByRole("dialog", { name: "数据库工具" });
    await waitFor(() => expect(replacementClient.listDatabasePermissions).toHaveBeenCalledWith("db-a", expect.any(AbortSignal)));
    await waitFor(() => expect(screen.queryAllByText(/current-user/).length).toBeGreaterThan(0));

    await act(async () => {
      saveRefresh.reject(new DOMException("Superseded", "AbortError"));
      await Promise.resolve();
    });
    expect(screen.queryByText("操作失败，未保存本地更改。")).not.toBeInTheDocument();
    expect(screen.queryAllByText(/current-user/).length).toBeGreaterThan(0);
    expect(within(management).getByRole("button", { name: "保存权限" })).toBeEnabled();
  });

  it("keeps existing CSV text and reports a recoverable file-read failure", async () => {
    const client = statsClient({ previewCsv: vi.fn(async () => ({ headers: [], rows: [], errors: [], total_rows: 0 })) });
    renderDrawer("db-a", client);
    const management = screen.getByRole("dialog", { name: "数据库工具" });
    fireEvent.click(within(management).getByRole("button", { name: "导入导出" }));
    const csvText = "Name\nLaunch";
    fireEvent.change(within(management).getByLabelText("CSV 内容"), { target: { value: csvText } });
    const file = new File(["ignored"], "broken.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { configurable: true, value: vi.fn().mockRejectedValue(new Error("read failed")) });

    fireEvent.change(within(management).getByLabelText("选择 CSV 文件"), { target: { files: [file] } });

    expect(await within(management).findByRole("alert")).toHaveTextContent("CSV 文件读取失败");
    expect(within(management).getByLabelText("CSV 内容")).toHaveValue(csvText);
  });
});
