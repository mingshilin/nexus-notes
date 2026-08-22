import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../src/data/api-client";

const now = "2026-08-22T00:00:00.000Z";
const member = { user_id: "user-2", email: "lin@example.com", display_name: "Lin", role: "editor", revision: 2, joined_at: now, updated_at: now };
const invitation = { id: "invite-1", workspace_id: "ws-1", email: "invite@example.com", role: "viewer", status: "pending", revision: 1, expires_at: "2026-08-25T00:00:00.000Z", created_by: "user-1", created_at: now, updated_at: now };
const comment = { id: "comment-1", workspace_id: "ws-1", target_type: "note", target_id: "note-1", author_user_id: "user-1", author_display_name: "Ming", parent_id: null, body: "请查看这个段落", mention_user_ids: ["user-2"], revision: 1, created_at: now, updated_at: now };
const notification = { id: "notification-1", workspace_id: "ws-1", user_id: "user-1", type: "mention", deep_link: "/notes/note-1?comment=comment-1", payload: { target_type: "note", target_id: "note-1", comment_id: "comment-1" }, read_at: null, revision: 1, created_at: now };
const share = { id: "share-1", entity_type: "note", entity_id: "note-1", status: "active", password_required: true, expires_at: null, revision: 1, created_at: now, updated_at: now };
const currentDatabase = { id: "db-current", workspace_id: "ws-1", name: "Current database", description: "Currently loaded", created_by: "user-1", revision: 1, created_at: now, updated_at: now };
const targetDatabase = { ...currentDatabase, id: "db-target", name: "Target database", description: "Notification destination" };
const currentProperty = { id: "name", workspace_id: "ws-1", database_id: "db-current", name: "Name", type: "text", config: {}, position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now };
const targetProperty = { ...currentProperty, database_id: "db-target" };
const currentView = { id: "table-current", workspace_id: "ws-1", database_id: "db-current", name: "All", type: "table", config: { filters: [], sorts: [], grouping: null, visible_columns: ["name"], page_size: 50, settings: {} }, position: 0, revision: 1, created_at: now, updated_at: now };
const targetView = { ...currentView, id: "table-target", database_id: "db-target" };
const currentRecord = { id: "record-current", workspace_id: "ws-1", database_id: "db-current", note_id: null, values: { name: "Current record" }, created_by: "user-1", updated_by: "user-1", revision: 1, created_at: now, updated_at: now };
const targetRecord = { ...currentRecord, id: "record-target", database_id: "db-target", values: { name: "Target record" } };

function collaboration(overrides: Record<string, unknown> = {}) {
  return {
    listMembers: vi.fn(async () => [member]),
    listInvitations: vi.fn(async () => [invitation]),
    createInvitation: vi.fn(async () => ({ invitation, token: "i".repeat(43) })),
    revokeInvitation: vi.fn(async () => ({ ...invitation, status: "revoked" })),
    updateMemberRole: vi.fn(async () => ({ ...member, role: "viewer", revision: 3 })),
    removeMember: vi.fn(async () => ({ user_id: member.user_id })),
    transferOwnership: vi.fn(async () => ({ ...member, role: "owner" })),
    listComments: vi.fn(async () => [comment]),
    createComment: vi.fn(async (input) => ({ ...comment, body: input.body, mention_user_ids: input.mention_user_ids })),
    updateComment: vi.fn(async () => comment), deleteComment: vi.fn(async () => ({ id: comment.id })),
    listNotifications: vi.fn(async () => ({ items: [notification], next_cursor: null })),
    getUnreadCount: vi.fn(async () => 1),
    readNotification: vi.fn(async (notificationId = notification.id) => ({ notification_ids: [notificationId], read_at: now })),
    readNotifications: vi.fn(async (input = { notification_ids: [notification.id] }) => ({ notification_ids: input.notification_ids, read_at: now })),
    readAllNotifications: vi.fn(async () => ({ count: 1, read_at: now })),
    listActivity: vi.fn(async () => ({ items: [{ id: "activity-1", workspace_id: "ws-1", actor_user_id: "user-1", request_id: "request-1", action: "note.updated", target_type: "note", target_id: "note-1", metadata: { source: "editor", token: "raw-secret" }, created_at: now }], next_cursor: null })),
    listAudit: vi.fn(async () => ({ items: [{ id: "audit-1", workspace_id: "ws-1", actor_user_id: "user-1", request_id: "request-2", action: "member.role_updated", target_type: "member", target_id: "user-2", metadata: { role: "viewer", password: "raw-password" }, outcome: "success", created_at: now }], next_cursor: null })),
    listShares: vi.fn(async () => [share]),
    createShare: vi.fn(async () => ({ share, token: "s".repeat(43) })),
    revokeShare: vi.fn(async () => ({ ...share, status: "revoked", revision: 2 })),
    connectPresence: vi.fn(({ onStatus, onParticipants }) => { onStatus("unavailable"); onParticipants([]); return { sendPresence: vi.fn(), sendTyping: vi.fn(), disconnect: vi.fn() }; }),
    ...overrides,
  };
}

describe("collaboration center", () => {
  it("replaces the notes placeholder, opens notifications from the unread button, and marks a deep link read", async () => {
    const { App } = await import("../src/index") as Record<string, any>;
    const authClient = { session: vi.fn(async () => ({ user: { id: "user-1", email: "ming@example.com", displayName: "Ming" }, workspaces: [{ id: "ws-1", name: "Nexus", slug: "nexus", role: "owner", revision: 1 }], active_workspace_id: "ws-1" })) };
    const apiClient = { request: vi.fn(async ({ path, method }: { path: string; method?: string }) => {
      if (path.startsWith("/api/v2/attachments")) return { items: [], next_cursor: null };
      if (path.startsWith("/api/v2/knowledge/diagnostics")) return { items: [], next_cursor: null };
      if (path === "/api/v2/notifications/unread") return { unread_count: 1 };
      if (path === "/api/v2/notifications?limit=25") return { items: [notification], next_cursor: null };
      if (path === "/api/v2/notifications/notification-1/read" && method === "POST") return { notification_ids: [notification.id], read_at: now };
      if (path === "/api/v2/members") return { items: [member] };
      if (path === "/api/v2/invitations") return { items: [invitation] };
      if (path === "/api/v2/comments/note/note-1") return { items: [comment] };
      throw new Error(`Unexpected ${path}`);
    }) };
    render(createElement(App, { authClient, apiClient, turnstileSiteKey: "test" }));

    const [notificationButton, editorNotificationButton] = await screen.findAllByRole("button", { name: "通知，1 条未读" });
    expect(notificationButton).toHaveTextContent("1");
    fireEvent.click(editorNotificationButton!);
    expect(await screen.findByRole("dialog", { name: "通知中心" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭通知中心" }));
    fireEvent.click(screen.getByRole("button", { name: "协作" }));
    expect(await screen.findByRole("heading", { name: "协作中心" })).toBeInTheDocument();
    expect(screen.getByText("Lin")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Public Beta 重写计划" })).not.toBeInTheDocument();

    fireEvent.click(notificationButton);
    expect(await screen.findByRole("dialog", { name: "通知中心" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "打开 mention" }));
    await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/notifications/notification-1/read", method: "POST", body: { base_revision: 1 } })));
    fireEvent.click(screen.getByRole("button", { name: "协作" }));
    fireEvent.click(await screen.findByRole("button", { name: "评论与提及" }));
    expect(await screen.findByLabelText("评论目标")).toHaveValue("note:note-1");
    expect((await screen.findByText("请查看这个段落")).closest("article")).toHaveAttribute("aria-current", "true");
  });

  it("resolves an unloaded database notification to its database, record, and selected comment destination", async () => {
    const { App } = await import("../src/index") as Record<string, any>;
    const targetNotification = {
      ...notification,
      id: "notification-target",
      deep_link: "/databases/records/record-target?comment=comment-target",
      payload: { target_type: "database_record", target_id: "record-target", comment_id: "comment-target" },
    };
    const targetComment = {
      ...comment,
      id: "comment-target",
      target_type: "database_record",
      target_id: "record-target",
      body: "Open this exact comment",
    };
    const authClient = { session: vi.fn(async () => ({ user: { id: "user-1", email: "ming@example.com", displayName: "Ming" }, workspaces: [{ id: "ws-1", name: "Nexus", slug: "nexus", role: "owner", revision: 1 }], active_workspace_id: "ws-1" })) };
    const apiClient = { request: vi.fn(async ({ path, method }: { path: string; method?: string }) => {
      if (path.startsWith("/api/v2/attachments")) return { items: [], next_cursor: null };
      if (path.startsWith("/api/v2/knowledge/diagnostics")) return { items: [], next_cursor: null };
      if (path === "/api/v2/notifications/unread") return { unread_count: 1 };
      if (path === "/api/v2/notifications?limit=25") return { items: [targetNotification], next_cursor: null };
      if (path === "/api/v2/notifications/notification-target/read" && method === "POST") return { notification_ids: [targetNotification.id], read_at: now };
      if (path === "/api/v2/databases") return { items: [currentDatabase, targetDatabase] };
      if (path === "/api/v2/databases/db-current/records/record-target") throw new ApiClientError({ code: "RECORD_NOT_FOUND", message: "Database record not found", retryable: false }, 404);
      if (path === "/api/v2/databases/db-target/records/record-target") return { record: targetRecord };
      if (path === "/api/v2/databases/db-current") return { database: currentDatabase, role: "owner", properties: [currentProperty], views: [currentView], templates: [] };
      if (path === "/api/v2/databases/db-current/records?view_id=table-current&limit=50") return { items: [currentRecord], next_cursor: null };
      if (path === "/api/v2/databases/db-target") return { database: targetDatabase, role: "owner", properties: [targetProperty], views: [targetView], templates: [] };
      if (path === "/api/v2/databases/db-target/records?view_id=table-target&limit=50") return { items: [], next_cursor: null };
      if (path === "/api/v2/members") return { items: [member] };
      if (path === "/api/v2/invitations") return { items: [invitation] };
      if (path === "/api/v2/comments/database_record/record-target") return { items: [targetComment] };
      throw new Error(`Unexpected ${path}`);
    }) };
    render(createElement(App, { authClient, apiClient, turnstileSiteKey: "test" }));

    const [notificationButton] = await screen.findAllByRole("button", { name: "通知，1 条未读" });
    fireEvent.click(notificationButton!);
    fireEvent.click(await screen.findByRole("link", { name: "打开 mention" }));

    const targetSelector = await screen.findByLabelText("评论目标");
    expect(targetSelector).toHaveValue("database_record:record-target");
    expect(targetSelector).toHaveDisplayValue("Target database / Target record");
    expect((await screen.findByText("Open this exact comment")).closest("article")).toHaveAttribute("aria-current", "true");
  });

  it("keeps global read-all available when the loaded page is already read", async () => {
    const { AdaptiveWorkbench, NotificationCenter } = await import("../src/index") as Record<string, any>;
    const client = collaboration({ listNotifications: vi.fn(async () => ({ items: [{ ...notification, read_at: now }], next_cursor: null })) });
    render(createElement(AdaptiveWorkbench, { mode: "desktop", navigation: "", inspectorOpen: false, onInspectorClose: vi.fn() },
      createElement(NotificationCenter, { client, open: true, unreadCount: 2, onClose: vi.fn() })));

    const readAll = await screen.findByRole("button", { name: "全部标为已读" });
    expect(readAll).toBeEnabled();
    fireEvent.click(readAll);
    await waitFor(() => expect(client.readAllNotifications).toHaveBeenCalledTimes(1));
  });

  it("gives the editor and rail notification controls the same unread-count label", async () => {
    const { App } = await import("../src/index") as Record<string, any>;
    const authClient = { session: vi.fn(async () => ({ user: { id: "user-1", email: "ming@example.com", displayName: "Ming" }, workspaces: [{ id: "ws-1", name: "Nexus", slug: "nexus", role: "owner", revision: 1 }], active_workspace_id: "ws-1" })) };
    const apiClient = { request: vi.fn(async ({ path }: { path: string }) => {
      if (path.startsWith("/api/v2/attachments") || path.startsWith("/api/v2/knowledge/diagnostics")) return { items: [], next_cursor: null };
      if (path === "/api/v2/notifications/unread") return { unread_count: 2 };
      throw new Error(`Unexpected ${path}`);
    }) };
    render(createElement(App, { authClient, apiClient, turnstileSiteKey: "test" }));

    expect(await screen.findAllByRole("button", { name: "通知，2 条未读" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "通知" })).not.toBeInTheDocument();
  });

  it("supports member/invite roles and a comments composer with workspace mentions", async () => {
    const { CollaborationCenter } = await import("../src/index") as Record<string, any>;
    const client = collaboration();
    render(createElement(CollaborationCenter, {
      client, workspaceId: "ws-1", userId: "user-1", role: "owner",
      commentTargets: [{ type: "note", id: "note-1", label: "Public Beta 重写计划" }],
    }));

    expect(await screen.findByText("Lin")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Lin 的角色"), { target: { value: "viewer" } });
    await waitFor(() => expect(client.updateMemberRole).toHaveBeenCalledWith("user-2", { role: "viewer", base_revision: 2 }));
    fireEvent.change(screen.getByLabelText("邀请邮箱"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("邀请角色"), { target: { value: "editor" } });
    fireEvent.click(screen.getByRole("button", { name: "发送邀请" }));
    await waitFor(() => expect(client.createInvitation).toHaveBeenCalledWith({ email: "new@example.com", role: "editor", expires_in_hours: 72 }));
    expect(await screen.findByRole("dialog", { name: "一次性邀请链接" })).toHaveTextContent("此链接仅显示一次");
    fireEvent.click(within(screen.getByRole("dialog", { name: "一次性邀请链接" })).getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "评论与提及" }));
    await screen.findByText("请查看这个段落");
    expect(screen.getByLabelText("评论目标")).toHaveValue("note:note-1");
    fireEvent.change(screen.getByLabelText("评论内容"), { target: { value: "请 Lin 复核" } });
    fireEvent.click(screen.getByLabelText("提及 Lin"));
    fireEvent.click(screen.getByRole("button", { name: "发表评论" }));
    await waitFor(() => expect(client.createComment).toHaveBeenCalledWith(expect.objectContaining({ target_type: "note", target_id: "note-1", body: "请 Lin 复核", mention_user_ids: ["user-2"] })));
  });

  it("creates and revokes protected shares, and renders activity/audit metadata defensively", async () => {
    const { CollaborationCenter } = await import("../src/index") as Record<string, any>;
    const client = collaboration();
    render(createElement(CollaborationCenter, {
      client, workspaceId: "ws-1", userId: "user-1", role: "owner",
      shareTargets: [
        { type: "note", id: "note-1", label: "Public Beta 重写计划" },
        { type: "note", id: "note-2", label: "每日产品复盘" },
      ],
    }));

    fireEvent.click(screen.getByRole("button", { name: "公开分享" }));
    await screen.findByText("note-1");
    fireEvent.change(screen.getByLabelText("分享对象"), { target: { value: "note:note-2" } });
    fireEvent.change(screen.getByLabelText("分享密码"), { target: { value: "password-123" } });
    fireEvent.change(screen.getByLabelText("有效小时"), { target: { value: "48" } });
    fireEvent.click(screen.getByRole("button", { name: "创建分享" }));
    await waitFor(() => expect(client.createShare).toHaveBeenCalledWith({ entity_type: "note", entity_id: "note-2", password: "password-123", expires_in_hours: 48 }));
    expect(await screen.findByRole("dialog", { name: "一次性分享链接" })).toHaveTextContent("此链接仅显示一次");
    fireEvent.click(within(screen.getByRole("dialog", { name: "一次性分享链接" })).getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销分享 note-1" }));
    await waitFor(() => expect(client.revokeShare).toHaveBeenCalledWith("share-1", 1));

    fireEvent.click(screen.getByRole("button", { name: "活动与审计" }));
    expect(await screen.findByText("note.updated")).toBeInTheDocument();
    expect(screen.getByText("member.role_updated")).toBeInTheDocument();
    expect(screen.getAllByText("[已隐藏]").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("raw-secret")).not.toBeInTheDocument();
    expect(screen.queryByText("raw-password")).not.toBeInTheDocument();
  });

  it("exposes loading/empty/permission/conflict/rate-limit/network and Presence-unavailable states", async () => {
    const { CollaborationCenter, collaborationErrorMessage } = await import("../src/index") as Record<string, any>;
    let resolveMembers!: (value: unknown[]) => void;
    const members = new Promise<unknown[]>((resolve) => { resolveMembers = resolve; });
    const client = collaboration({ listMembers: vi.fn(() => members), listInvitations: vi.fn(async () => []) });
    render(createElement(CollaborationCenter, { client, workspaceId: "ws-1", userId: "user-1", role: "viewer" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在加载协作数据");
    resolveMembers([]);
    expect(await screen.findByText("当前工作区还没有其他成员。" )).toBeInTheDocument();
    expect(screen.getByText("实时协作暂不可用，编辑不受影响。" )).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发送邀请" })).not.toBeInTheDocument();

    expect(collaborationErrorMessage({ status: 403, code: "FORBIDDEN" })).toMatch("权限");
    expect(collaborationErrorMessage({ status: 409, code: "REVISION_CONFLICT" })).toMatch("冲突");
    expect(collaborationErrorMessage({ status: 429, code: "RATE_LIMITED" })).toMatch("频繁");
    expect(collaborationErrorMessage({ code: "NETWORK_ERROR" })).toMatch("网络");
  });

  it("retains notification cursors and supports selected, single, all-read, and exact deep targets", async () => {
    const { AdaptiveWorkbench, NotificationCenter } = await import("../src/index") as Record<string, any>;
    const recordNotification = { ...notification, id: "notification-2", deep_link: "/databases/records/record-9?comment=comment-9", payload: { target_type: "database_record", target_id: "record-9", comment_id: "comment-9" } };
    const client = collaboration({
      listNotifications: vi.fn(async ({ cursor }: { cursor?: string }) => cursor
        ? { items: [recordNotification], next_cursor: null }
        : { items: [notification], next_cursor: "cursor-2" }),
    });
    const onDeepLink = vi.fn();
    render(createElement(AdaptiveWorkbench, { mode: "desktop", navigation: "", inspectorOpen: false, onInspectorClose: vi.fn() },
      createElement(NotificationCenter, { client, open: true, unreadCount: 2, onClose: vi.fn(), onDeepLink })));

    await screen.findByText("mention");
    fireEvent.click(screen.getByRole("button", { name: "加载更多通知" }));
    await waitFor(() => expect(client.listNotifications).toHaveBeenCalledWith(expect.objectContaining({ cursor: "cursor-2", limit: 25 })));
    expect(screen.getAllByText("mention")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("选择通知 notification-1"));
    fireEvent.click(screen.getByRole("button", { name: "将所选通知标为已读" }));
    await waitFor(() => expect(client.readNotifications).toHaveBeenCalledWith({ notification_ids: ["notification-1"], base_revisions: { "notification-1": 1 } }));
    fireEvent.click(screen.getByRole("button", { name: "标记通知 notification-2 已读" }));
    await waitFor(() => expect(client.readNotification).toHaveBeenCalledWith("notification-2", 1));
    fireEvent.click(screen.getByRole("button", { name: "全部标为已读" }));
    await waitFor(() => expect(client.readAllNotifications).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole("link", { name: "打开 mention" })[1]!);
    expect(onDeepLink).toHaveBeenCalledWith({ targetType: "database_record", targetId: "record-9", commentId: "comment-9" });
  });

  it("enforces the viewer request matrix while keeping readable comments and activity", async () => {
    const { CollaborationCenter } = await import("../src/index") as Record<string, any>;
    const client = collaboration();
    render(createElement(CollaborationCenter, {
      client, workspaceId: "ws-1", userId: "user-1", role: "viewer",
      commentTargets: [{ type: "note", id: "note-1", label: "Public Beta 重写计划" }],
    }));

    await screen.findByText("Lin");
    expect(client.listInvitations).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Lin 的角色")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /移交所有权|移除 Lin|发送邀请/u })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "评论与提及" }));
    expect(await screen.findByText("请查看这个段落")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发表评论" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "公开分享" }));
    expect(await screen.findByText("查看者无法访问公开分享管理。" )).toBeInTheDocument();
    expect(client.listShares).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "活动记录" }));
    expect(await screen.findByText("note.updated")).toBeInTheDocument();
    expect(client.listActivity).toHaveBeenCalled();
    expect(client.listAudit).not.toHaveBeenCalled();
  });

  it("uses selectable context targets, reloads on target changes, and lets owners moderate comments", async () => {
    const { CollaborationCenter } = await import("../src/index") as Record<string, any>;
    const otherComment = { ...comment, author_user_id: "user-2", author_display_name: "Lin" };
    const client = collaboration({ listComments: vi.fn(async () => [otherComment]) });
    render(createElement(CollaborationCenter, {
      client, workspaceId: "ws-1", userId: "user-1", role: "owner", initialSection: "comments",
      activeTarget: { type: "database_record", id: "record-2" }, selectedCommentId: "comment-1",
      commentTargets: [
        { type: "note", id: "note-1", label: "Public Beta 重写计划" },
        { type: "database_record", id: "record-2", label: "Roadmap row" },
      ],
      shareTargets: [
        { type: "note", id: "note-1", label: "Public Beta 重写计划" },
        { type: "database_view", id: "view-1", label: "Roadmap / Table" },
      ],
    }));

    await waitFor(() => expect(client.listComments).toHaveBeenCalledWith("database_record", "record-2", expect.any(AbortSignal)));
    expect(screen.queryByLabelText("目标 ID")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("评论目标"), { target: { value: "note:note-1" } });
    await waitFor(() => expect(client.listComments).toHaveBeenCalledWith("note", "note-1", expect.any(AbortSignal)));
    expect((await screen.findByText("请查看这个段落")).closest("article")).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "删除评论" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "公开分享" }));
    expect(await screen.findByLabelText("分享对象")).toHaveDisplayValue("Public Beta 重写计划");
    expect(screen.queryByLabelText("分享对象 ID")).not.toBeInTheDocument();
  });
});
