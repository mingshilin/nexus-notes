import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

const now = "2026-08-22T00:00:00.000Z";
const member = { user_id: "user-2", email: "lin@example.com", display_name: "Lin", role: "editor", revision: 2, joined_at: now, updated_at: now };
const invitation = { id: "invite-1", workspace_id: "ws-1", email: "invite@example.com", role: "viewer", status: "pending", revision: 1, expires_at: "2026-08-25T00:00:00.000Z", created_by: "user-1", created_at: now, updated_at: now };
const comment = { id: "comment-1", workspace_id: "ws-1", target_type: "note", target_id: "note-1", author_user_id: "user-1", author_display_name: "Ming", parent_id: null, body: "请查看这个段落", mention_user_ids: ["user-2"], revision: 1, created_at: now, updated_at: now };
const notification = { id: "notification-1", workspace_id: "ws-1", user_id: "user-1", type: "mention", deep_link: "/notes/note-1", payload: { target: "note" }, read_at: null, revision: 1, created_at: now };
const share = { id: "share-1", entity_type: "note", entity_id: "note-1", status: "active", password_required: true, expires_at: null, revision: 1, created_at: now, updated_at: now };

function collaboration(overrides: Record<string, unknown> = {}) {
  return {
    listMembers: vi.fn(async () => [member]),
    listInvitations: vi.fn(async () => [invitation]),
    createInvitation: vi.fn(async () => ({ invitation, token: "i".repeat(43) })),
    revokeInvitation: vi.fn(async () => ({ ...invitation, status: "revoked" })),
    updateMemberRole: vi.fn(async () => ({ ...member, role: "viewer", revision: 3 })),
    removeMember: vi.fn(async () => ({ removed: true })),
    transferOwnership: vi.fn(async () => ({ ...member, role: "owner" })),
    listComments: vi.fn(async () => [comment]),
    createComment: vi.fn(async (input) => ({ ...comment, body: input.body, mention_user_ids: input.mention_user_ids })),
    updateComment: vi.fn(async () => comment), deleteComment: vi.fn(async () => ({ deleted: true })),
    listNotifications: vi.fn(async () => ({ items: [notification], next_cursor: null })),
    getUnreadCount: vi.fn(async () => 1),
    readNotification: vi.fn(async () => ({ notification_ids: [notification.id], read_at: now })),
    readNotifications: vi.fn(async () => ({ notification_ids: [notification.id], read_at: now })),
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
      throw new Error(`Unexpected ${path}`);
    }) };
    render(createElement(App, { authClient, apiClient, turnstileSiteKey: "test" }));

    const notificationButton = await screen.findByRole("button", { name: "通知，1 条未读" });
    expect(notificationButton).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "协作" }));
    expect(await screen.findByRole("heading", { name: "协作中心" })).toBeInTheDocument();
    expect(screen.getByText("Lin")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Public Beta 重写计划" })).not.toBeInTheDocument();

    fireEvent.click(notificationButton);
    expect(await screen.findByRole("heading", { name: "通知中心" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "打开 mention" }));
    await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/notifications/notification-1/read", method: "POST", body: { base_revision: 1 } })));
  });

  it("supports member/invite roles and a comments composer with workspace mentions", async () => {
    const { CollaborationCenter } = await import("../src/index") as Record<string, any>;
    const client = collaboration();
    render(createElement(CollaborationCenter, { client, workspaceId: "ws-1", userId: "user-1", role: "owner" }));

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
    fireEvent.change(screen.getByLabelText("目标 ID"), { target: { value: "note-1" } });
    fireEvent.change(screen.getByLabelText("评论内容"), { target: { value: "请 Lin 复核" } });
    fireEvent.click(screen.getByLabelText("提及 Lin"));
    fireEvent.click(screen.getByRole("button", { name: "发表评论" }));
    await waitFor(() => expect(client.createComment).toHaveBeenCalledWith(expect.objectContaining({ target_type: "note", target_id: "note-1", body: "请 Lin 复核", mention_user_ids: ["user-2"] })));
  });

  it("creates and revokes protected shares, and renders activity/audit metadata defensively", async () => {
    const { CollaborationCenter } = await import("../src/index") as Record<string, any>;
    const client = collaboration();
    render(createElement(CollaborationCenter, { client, workspaceId: "ws-1", userId: "user-1", role: "owner" }));

    fireEvent.click(screen.getByRole("button", { name: "公开分享" }));
    await screen.findByText("note-1");
    fireEvent.change(screen.getByLabelText("分享对象 ID"), { target: { value: "note-2" } });
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
});
