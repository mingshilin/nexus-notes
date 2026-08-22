import { describe, expect, it } from "vitest";

import {
  CreateCommentSchema,
  CreateInvitationSchema,
  CreatePublicShareSchema,
  NotificationReadSchema,
  PublicShareAccessSchema,
  SafeAuditMetadataSchema,
} from "../src";
import * as contracts from "../src";

interface RuntimeSchema {
  safeParse(value: unknown): { success: boolean };
}

function schema(name: string) {
  const value = (contracts as Record<string, unknown>)[name];
  expect(value, `${name} must be exported`).toBeDefined();
  return value as RuntimeSchema;
}

const timestamp = "2026-08-22T00:00:00.000Z";

describe("collaboration contracts", () => {
  it("accepts bounded invitations and rejects owner invitations", () => {
    expect(CreateInvitationSchema.safeParse({
      email: "member@example.test",
      role: "editor",
      expires_in_hours: 48,
    }).success).toBe(true);
    expect(CreateInvitationSchema.safeParse({
      email: "owner@example.test",
      role: "owner",
      expires_in_hours: 48,
    }).success).toBe(false);
    expect(CreateInvitationSchema.safeParse({
      email: "member@example.test",
      role: "viewer",
      expires_in_hours: 24 * 31,
    }).success).toBe(false);
  });

  it("requires explicit member mention IDs and a replay key for comments", () => {
    const valid = {
      target_type: "note",
      target_id: "note-1",
      body: "Please review @Two",
      mention_user_ids: ["user-2"],
      idempotency_key: "comment-op-1",
    };
    expect(CreateCommentSchema.safeParse(valid).success).toBe(true);
    expect(CreateCommentSchema.safeParse({ ...valid, mention_user_ids: ["user-2", "user-2"] }).success).toBe(false);
    expect(CreateCommentSchema.safeParse({ ...valid, idempotency_key: "" }).success).toBe(false);
  });

  it("validates notification revisions and bounded bulk ownership mutations", () => {
    expect(NotificationReadSchema.safeParse({ notification_ids: ["notification-1"], base_revisions: { "notification-1": 1 } }).success).toBe(true);
    expect(NotificationReadSchema.safeParse({ notification_ids: [], base_revisions: {} }).success).toBe(false);
    expect(NotificationReadSchema.safeParse({ notification_ids: Array.from({ length: 101 }, (_, index) => `n-${index}`), base_revisions: {} }).success).toBe(false);
    expect(NotificationReadSchema.safeParse({ notification_ids: ["notification-1"], base_revisions: {} }).success).toBe(false);
    expect(NotificationReadSchema.safeParse({ notification_ids: ["notification-1"], base_revisions: { "notification-1": 1, extra: 1 } }).success).toBe(false);
  });

  it("keeps share tokens and passwords in POST bodies and bounds expiry", () => {
    expect(CreatePublicShareSchema.safeParse({ entity_type: "note", entity_id: "note-1", password: "review-only", expires_in_hours: 72 }).success).toBe(true);
    expect(CreatePublicShareSchema.safeParse({ entity_type: "note", entity_id: "note-1", password: "short" }).success).toBe(false);
    expect(PublicShareAccessSchema.safeParse({ token: "a".repeat(43), password: "review-only" }).success).toBe(true);
    expect(PublicShareAccessSchema.safeParse({ token: "raw-token-in-query" }).success).toBe(false);
  });

  it("rejects sensitive audit metadata keys and nested content", () => {
    expect(SafeAuditMetadataSchema.safeParse({ role: "viewer", count: 2, enabled: true }).success).toBe(true);
    expect(SafeAuditMetadataSchema.safeParse({ token: "secret" }).success).toBe(false);
    expect(SafeAuditMetadataSchema.safeParse({ content: { title: "private" } }).success).toBe(false);
  });

  it("exports strict schemas for invitations, members, comments, and mentions", () => {
    const invitation = {
      id: "invitation-1", workspace_id: "ws-1", email: "member@example.test", role: "editor",
      status: "pending", revision: 1, expires_at: timestamp, created_by: "user-1",
      created_at: timestamp, updated_at: timestamp,
    };
    expect(schema("WorkspaceInvitationSchema").safeParse(invitation).success).toBe(true);
    expect(schema("WorkspaceInvitationSchema").safeParse({ ...invitation, token_hash: "private" }).success).toBe(false);
    expect(schema("InvitationPreviewSchema").safeParse({
      workspace_name: "One", inviter_display_name: "Owner", email: invitation.email,
      role: "viewer", expires_at: timestamp, status: "pending",
    }).success).toBe(true);
    expect(schema("WorkspaceMemberSchema").safeParse({
      user_id: "user-2", email: invitation.email, display_name: "Member", role: "owner",
      revision: 2, joined_at: timestamp, updated_at: timestamp,
    }).success).toBe(true);
    expect(schema("CollaborationCommentSchema").safeParse({
      id: "comment-1", workspace_id: "ws-1", target_type: "note", target_id: "note-1",
      author_user_id: "user-1", author_display_name: "Owner", parent_id: null, body: "Review",
      mention_user_ids: ["user-2"], revision: 1, created_at: timestamp, updated_at: timestamp,
    }).success).toBe(true);
    expect(schema("MentionSchema").safeParse({
      id: "mention-1", workspace_id: "ws-1", comment_id: "comment-1", note_id: "note-1",
      mentioned_user_id: "user-2", source_revision: 1, created_at: timestamp,
    }).success).toBe(true);
  });

  it("exports safe notification, activity, and immutable-audit cursor pages", () => {
    const notification = {
      id: "notification-1", workspace_id: "ws-1", user_id: "user-2", type: "mention",
      deep_link: "/notes/note-1?comment=comment-1", payload: { actor_user_id: "user-1" },
      read_at: null, revision: 1, created_at: timestamp,
    };
    expect(schema("NotificationCursorPageSchema").safeParse({ items: [notification], next_cursor: "cursor-1" }).success).toBe(true);
    expect(schema("NotificationCursorPageSchema").safeParse({ items: [{ ...notification, payload_json: "{}" }], next_cursor: null }).success).toBe(false);
    expect(schema("NotificationUnreadCountSchema").safeParse({ unread_count: 3 }).success).toBe(true);
    expect(schema("NotificationReadResultSchema").safeParse({ notification_ids: [notification.id], read_at: timestamp }).success).toBe(true);

    const activity = {
      id: "activity-1", workspace_id: "ws-1", actor_user_id: "user-1", request_id: "req-1",
      action: "member.role_changed", target_type: "workspace_member", target_id: "user-2",
      metadata: { role: "viewer" }, created_at: timestamp,
    };
    expect(schema("ActivityCursorPageSchema").safeParse({ items: [activity], next_cursor: null }).success).toBe(true);
    expect(schema("AuditCursorPageSchema").safeParse({ items: [{ ...activity, outcome: "success" }], next_cursor: null }).success).toBe(true);
    expect(schema("AuditEntrySchema").safeParse({ ...activity, outcome: "success", token_hash: "private" }).success).toBe(false);
    expect(schema("CollaborationCursorQuerySchema").safeParse({ cursor: "x".repeat(1025), limit: 10 }).success).toBe(false);
  });

  it("exports public-share, password-verification, status, revision, and Presence message schemas", () => {
    const share = {
      id: "share-1", entity_type: "note", entity_id: "note-1", status: "active",
      password_required: true, expires_at: null, revision: 1, created_at: timestamp, updated_at: timestamp,
    };
    expect(schema("PublicShareSchema").safeParse(share).success).toBe(true);
    expect(schema("PublicShareSchema").safeParse({ ...share, workspace_id: "ws-1", token_hash: "private" }).success).toBe(false);
    expect(schema("PublicSharedContentSchema").safeParse({
      share_id: "share-1", entity_type: "note", title: "Shared", content: "Allowed public body",
      revision: 3, updated_at: timestamp,
    }).success).toBe(true);
    expect(schema("PublicSharePasswordVerificationSchema").safeParse({ password: "review-only" }).success).toBe(true);
    expect(schema("PublicSharePasswordVerificationSchema").safeParse({ password: "review-only", token: "raw" }).success).toBe(false);
    expect(schema("InvitationStatusSchema").safeParse("accepted").success).toBe(true);
    expect(schema("PublicShareStatusSchema").safeParse("expired").success).toBe(true);
    expect(schema("CollaborationRevisionSchema").safeParse(0).success).toBe(false);

    expect(schema("PresenceClientMessageSchema").safeParse({
      type: "presence.update", state: "typing", target_id: "note-1",
    }).success).toBe(true);
    expect(schema("PresenceServerMessageSchema").safeParse({
      type: "entity.invalidated", entity_type: "note", entity_id: "note-1", revision: 4,
    }).success).toBe(true);
    expect(schema("PresenceServerMessageSchema").safeParse({
      type: "entity.invalidated", entity_type: "note", entity_id: "note-1", revision: 0,
    }).success).toBe(false);
  });
});
