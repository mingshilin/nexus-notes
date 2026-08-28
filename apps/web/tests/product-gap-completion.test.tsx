import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeSearchPanel } from "../src/knowledge/KnowledgeSearchPanel";
import { KnowledgeRecoveryPanel } from "../src/knowledge/KnowledgeRecoveryPanel";
import { DatabaseWorkbench } from "../src/databases/DatabaseWorkbench";
import { ReminderPanel } from "../src/reminders/ReminderPanel";
import { AccountCenter } from "../src/account/AccountCenter";

const now = "2026-08-28T00:00:00.000Z";

function searchClientWithPartialTaxonomy() {
  let folderAttempts = 0;
  return {
    search: vi.fn(async () => ({ items: [], next_cursor: null })),
    listSavedSearches: vi.fn(async () => []),
    listFolders: vi.fn(async () => {
      folderAttempts += 1;
      if (folderAttempts === 1) throw new Error("folder unavailable");
      return [{ id: "folder-1", workspace_id: "ws-1", name: "项目", parent_id: null, position: 0, revision: 1, created_at: now, updated_at: now }];
    }),
    listTags: vi.fn(async () => [{ id: "tag-1", workspace_id: "ws-1", name: "研究", color: "", revision: 1, created_at: now, updated_at: now }]),
    createSavedSearch: vi.fn(),
    deleteSavedSearch: vi.fn(),
  };
}

describe("product gap completion", () => {
  it("keeps the successful taxonomy half visible and retries only the failed half", async () => {
    const client = searchClientWithPartialTaxonomy();
    render(<KnowledgeSearchPanel client={client} />);

    expect(await screen.findByRole("checkbox", { name: "标签：研究" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("文件夹");
    fireEvent.click(screen.getByRole("button", { name: "重试分类加载" }));

    await waitFor(() => expect(client.listFolders).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("checkbox", { name: "文件夹：项目" })).toBeInTheDocument();
  });

  it("keeps search filters after a failed request and exposes a retry action", async () => {
    const client = {
      ...searchClientWithPartialTaxonomy(),
      search: vi.fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({ items: [{ entity_type: "note", entity_id: "note-1", title: "恢复结果", excerpt: "可见", hit_sources: ["content"], revision: 1, updated_at: now }], next_cursor: null }),
    };
    render(<KnowledgeSearchPanel client={client} />);
    const query = screen.getByRole("textbox", { name: "知识搜索" });
    fireEvent.change(query, { target: { value: "恢复" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    expect(await screen.findByText("搜索暂时无法完成", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试搜索" }));
    expect(await screen.findByRole("article", { name: "恢复结果" })).toBeInTheDocument();
    expect(query).toHaveValue("恢复");
  });

  it("explains permission limits instead of silently hiding recovery actions", () => {
    render(<KnowledgeRecoveryPanel
      attachments={[]}
      diagnostics={[{ kind: "orphan_note", entity_id: "note-1", title: "孤立笔记", count: 1 }]}
      filters={{ mimeType: "", ocrStatus: "" }}
      loading={false}
      refreshing={false}
      onRetry={vi.fn()}
      onBatchRetry={vi.fn()}
      onRecover={vi.fn()}
      onFiltersChange={vi.fn()}
      onLoadMoreAttachments={vi.fn()}
      onLoadMoreDiagnostics={vi.fn()}
      onIgnoreOrphans={vi.fn()}
    />);

    expect(screen.getByRole("status")).toHaveTextContent("权限");
    expect(screen.getByText("孤立笔记")).toBeInTheDocument();
  });

  it("retries a failed database overview without closing the management center", async () => {
    const getStats = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ record_count: 12, property_count: 1, view_count: 1, template_count: 0, comment_count: 0, updated_at: now, role: "owner", database_permission_count: 0, field_permission_count: 0 });
    render(<DatabaseWorkbench
      database={{ id: "db-1", workspace_id: "ws-1", name: "项目", description: "", created_by: "user-1", revision: 1, created_at: now, updated_at: now }}
      properties={[]}
      records={[]}
      views={[{ id: "view-1", workspace_id: "ws-1", database_id: "db-1", name: "表格", type: "table", config: { filters: [], sorts: [], grouping: null, visible_columns: [], page_size: 50, settings: {} }, position: 0, revision: 1, created_at: now, updated_at: now }]}
      client={{ getStats } as never}
    />);
    fireEvent.click(screen.getByRole("button", { name: "数据库工具" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("数据库概览");
    fireEvent.click(screen.getByRole("button", { name: "重试数据库概览" }));
    expect(await screen.findByText("12", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "数据库工具" })).toBeInTheDocument();
  });

  it("applies successful bulk reminder completions and keeps failed items retryable", async () => {
    const first = { id: "r-1", workspace_id: "ws-1", note_id: null, user_id: "u-1", remind_at: "2026-08-28T09:00:00.000Z", title: "成功提醒", timezone: "UTC", channels: ["in_app"], recurrence: null, recurrence_anchor_local: null, occurrence_count: 0, delivery_enabled_at: now, snoozed_until: null, last_delivered_at: null, status: "pending", revision: 1, created_at: now, updated_at: now } as const;
    const second = { ...first, id: "r-2", title: "失败提醒" };
    const updateReminder = vi.fn()
      .mockResolvedValueOnce({ ...first, status: "dismissed", revision: 2 })
      .mockRejectedValueOnce(new Error("offline"));
    const client = {
      listReminderPage: vi.fn(async () => ({ items: [first, second], next_cursor: null })),
      createReminder: vi.fn(), updateReminder, snoozeReminder: vi.fn(), deleteReminder: vi.fn(),
    };
    render(<ReminderPanel client={client as never} now={() => new Date("2026-08-28T08:00:00.000Z")} />);
    const firstItem = await screen.findByRole("listitem", { name: "成功提醒" });
    const secondItem = screen.getByRole("listitem", { name: "失败提醒" });
    fireEvent.click(within(firstItem).getByRole("checkbox", { name: "选择成功提醒" }));
    fireEvent.click(within(secondItem).getByRole("checkbox", { name: "选择失败提醒" }));
    fireEvent.click(screen.getByRole("button", { name: "完成所选" }));

    await waitFor(() => expect(updateReminder).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("listitem", { name: "成功提醒" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("1 条完成");
    expect(screen.getByRole("button", { name: "重试未完成提醒" })).toBeInTheDocument();
  });

  it("retries a failed account overview without losing the account shell", async () => {
    const getOverview = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ counts: { workspaces: 1, sessions: 1, notes: 2, databases: 1, upcoming_reminders: 0 }, profile_complete: true, ai_configured: false, recent_activity: [] });
    const profileClient = {
      getProfile: vi.fn(async () => ({ id: "u-1", email: "u@example.test", display_name: "U", biography: "", locale: "zh-CN", timezone: "UTC", avatar_url: null, updated_at: now })),
      listSessions: vi.fn(async () => []),
      updateProfile: vi.fn(), uploadAvatar: vi.fn(), deleteAvatar: vi.fn(), requestEmailChange: vi.fn(), confirmEmailChange: vi.fn(), changePassword: vi.fn(), revokeSession: vi.fn(), deleteAccount: vi.fn(),
      getOverview,
    };
    render(<AccountCenter client={profileClient as never} workspaces={[]} activeWorkspaceId={null} onWorkspaceChange={vi.fn()} onDeleted={vi.fn()} initialTab="overview" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("账户总览加载失败");
    fireEvent.click(screen.getByRole("button", { name: "重试账户总览" }));
    expect(await screen.findByText("2 条笔记")).toBeInTheDocument();
  });
});
