import { describe, expect, it, vi } from "vitest";

const now = "2026-08-22T00:00:00.000Z";
const member = { user_id: "user-2", email: "member@example.com", display_name: "Lin", role: "editor", revision: 2, joined_at: now, updated_at: now };
const invitation = { id: "invite-1", workspace_id: "ws-1", email: "invite@example.com", role: "viewer", status: "pending", revision: 1, expires_at: now, created_by: "user-1", created_at: now, updated_at: now };
const comment = { id: "comment-1", workspace_id: "ws-1", target_type: "note", target_id: "note-1", author_user_id: "user-1", author_display_name: "Ming", parent_id: null, body: "@Lin please review", mention_user_ids: ["user-2"], revision: 1, created_at: now, updated_at: now };
const notification = { id: "notification-1", workspace_id: "ws-1", user_id: "user-1", type: "mention", deep_link: "/notes/note-1", payload: { target: "note" }, read_at: null, revision: 1, created_at: now };
const activity = { id: "activity-1", workspace_id: "ws-1", actor_user_id: "user-1", request_id: "request-1", action: "note.updated", target_type: "note", target_id: "note-1", metadata: { source: "editor" }, created_at: now };
const audit = { ...activity, id: "audit-1", outcome: "success" };
const share = { id: "share-1", entity_type: "note", entity_id: "note-1", status: "active", password_required: true, expires_at: null, revision: 1, created_at: now, updated_at: now };
const sharedContent = { share_id: "share-1", entity_type: "note", title: "Shared note", content: "Visible content", revision: 1, updated_at: now };

describe("CollaborationClient", () => {
  it("maps every approved collaboration route with workspace-scoped typed requests", async () => {
    const { CollaborationClient } = await import("../src/index") as Record<string, any>;
    expect(CollaborationClient).toBeTypeOf("function");
    const api = { request: vi.fn(async ({ path, method }: { path: string; method?: string }) => {
      if (path === "/api/v2/invitations" && method === "POST") return { invitation, token: "i".repeat(43) };
      if (path === "/api/v2/invitations") return { items: [invitation] };
      if (path.endsWith("/preview")) return { invitation: { workspace_name: "Nexus", inviter_display_name: "Ming", email: invitation.email, role: "viewer", expires_at: now, status: "pending" } };
      if (path.endsWith("/accept")) return { member };
      if (path.startsWith("/api/v2/invitations/")) return { invitation: { ...invitation, status: "revoked", revision: 2 } };
      if (path === "/api/v2/members") return { items: [member] };
      if (path.endsWith("/ownership") || (path.startsWith("/api/v2/members/") && method === "PATCH")) return { member };
      if (path.startsWith("/api/v2/members/") && method === "DELETE") return { user_id: member.user_id };
      if (path === "/api/v2/comments" && method === "POST") return { comment };
      if (path.startsWith("/api/v2/comments/note/")) return { items: [comment] };
      if (path.startsWith("/api/v2/comments/") && method === "PATCH") return { comment };
      if (path.startsWith("/api/v2/comments/") && method === "DELETE") return { id: comment.id };
      if (path === "/api/v2/notifications/unread") return { unread_count: 1 };
      if (path === "/api/v2/notifications?limit=25") return { items: [notification], next_cursor: null };
      if (path.includes("/notifications/") || path === "/api/v2/notifications/read") return { notification_ids: [notification.id], read_at: now };
      if (path.endsWith("/read-all")) return { count: 1, read_at: now };
      if (path === "/api/v2/activity?limit=25") return { items: [activity], next_cursor: null };
      if (path === "/api/v2/audit?limit=25") return { items: [audit], next_cursor: null };
      if (path === "/api/v2/shares" && method === "POST") return { share, token: "s".repeat(43) };
      if (path === "/api/v2/shares?entity_type=note&entity_id=note-1") return { items: [share] };
      if (path.startsWith("/api/v2/shares/") && method === "DELETE") return { share: { ...share, status: "revoked", revision: 2 } };
      if (path.startsWith("/api/v2/public/shares/")) return sharedContent;
      throw new Error(`Unexpected ${method ?? "GET"} ${path}`);
    }) };
    const client = new CollaborationClient(api, "ws-1", { createId: () => "operation-1" });
    const signal = new AbortController().signal;

    await client.createInvitation({ email: invitation.email, role: "viewer", expires_in_hours: 72 });
    await client.listInvitations(signal);
    await client.previewInvitation("i".repeat(43), signal);
    await client.acceptInvitation("i".repeat(43));
    await client.revokeInvitation(invitation.id, invitation.revision);
    await client.listMembers(signal);
    await client.updateMemberRole(member.user_id, { role: "viewer", base_revision: member.revision });
    await expect(client.removeMember(member.user_id, member.revision)).resolves.toEqual({ user_id: member.user_id });
    await client.transferOwnership(member.user_id, member.revision);
    await client.createComment({ target_type: "note", target_id: "note-1", body: comment.body, parent_id: null, mention_user_ids: [member.user_id], idempotency_key: "comment-op" });
    await client.listComments("note", "note-1", signal);
    await client.updateComment(comment.id, { body: "updated", mention_user_ids: [], base_revision: 1 });
    await expect(client.deleteComment(comment.id, 1)).resolves.toEqual({ id: comment.id });
    await client.listNotifications({ limit: 25, signal });
    await client.getUnreadCount(signal);
    await client.readNotification(notification.id, notification.revision);
    await client.readNotifications({ notification_ids: [notification.id], base_revisions: { [notification.id]: 1 } });
    await client.readAllNotifications();
    await client.listActivity({ limit: 25, signal });
    await client.listAudit({ limit: 25, signal });
    await client.createShare({ entity_type: "note", entity_id: "note-1", password: "password-123" });
    await client.listShares({ entity_type: "note", entity_id: "note-1", signal });
    await client.revokeShare(share.id, share.revision);
    await client.getPublicShare("s".repeat(43), signal);
    await client.accessPublicShare("s".repeat(43), { password: "password-123" }, signal);

    expect(api.request.mock.calls.every(([request]) => request.path.startsWith("/api/v2/public/") || request.path.includes("/invitations/preview") || request.path.includes("/invitations/accept") || request.headers?.["x-workspace-id"] === "ws-1")).toBe(true);
    expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
      path: `/api/v2/public/shares/${"s".repeat(43)}`,
      method: "POST",
      body: { password: "password-123" },
      headers: undefined,
    }));
    expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/members/user-2/ownership", method: "POST", body: { base_revision: 2 } }));
  });

  it("treats Presence construction and transport failure as a non-blocking unavailable state", async () => {
    const { CollaborationClient } = await import("../src/index") as Record<string, any>;
    const onStatus = vi.fn();
    const client = new CollaborationClient({ request: vi.fn() }, "ws-1", {
      webSocketFactory: () => { throw new Error("Durable Object unavailable"); },
    });

    const connection = client.connectPresence({ onStatus });

    expect(onStatus).toHaveBeenCalledWith("unavailable");
    expect(() => connection.sendTyping("note", "note-1", true)).not.toThrow();
    expect(() => connection.disconnect()).not.toThrow();
  });
});
