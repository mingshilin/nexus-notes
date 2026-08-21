import { describe, expect, it } from "vitest";

import {
  canManageWorkspaceMember,
  canMutateComment,
  redactAuditMetadata,
} from "../src";
import * as domain from "../src";

function policy<T>(name: string) {
  const value = (domain as Record<string, unknown>)[name];
  expect(value, `${name} must be exported`).toBeTypeOf("function");
  return value as T;
}

describe("collaboration policy", () => {
  it("enforces owner-only member management", () => {
    expect(canManageWorkspaceMember("owner", "editor", "viewer")).toBe(true);
    expect(canManageWorkspaceMember("owner", "viewer", "editor")).toBe(true);
    expect(canManageWorkspaceMember("editor", "viewer", "editor")).toBe(false);
    expect(canManageWorkspaceMember("owner", "owner", "viewer")).toBe(false);
    expect(canManageWorkspaceMember("owner", "editor", "owner")).toBe(true);
  });

  it("allows ownership transfer but atomically protects the last owner", () => {
    expect(canManageWorkspaceMember("owner", "editor", "owner", 1)).toBe(true);
    expect(canManageWorkspaceMember("owner", "owner", "viewer", 1)).toBe(false);
    expect(canManageWorkspaceMember("owner", "owner", "viewer", 2)).toBe(true);
    expect(canManageWorkspaceMember("owner", "owner", null, 2)).toBe(true);
  });

  it("allows editors to create comments and only authors or owners to edit them", () => {
    expect(canMutateComment("owner", false)).toBe(true);
    expect(canMutateComment("editor", true)).toBe(true);
    expect(canMutateComment("editor", false)).toBe(false);
    expect(canMutateComment("viewer", true)).toBe(false);
  });

  it("redacts dangerous audit keys and never retains nested content", () => {
    expect(redactAuditMetadata({
      role: "viewer",
      token: "raw-token",
      password: "secret",
      cookie: "session=value",
      content: "private note",
      attachment_bytes: new Uint8Array([1, 2]),
      request: { code: "123456" },
      count: 2,
    })).toEqual({ role: "viewer", count: 2 });
  });

  it("enforces the owner/editor/viewer collaboration action matrix", () => {
    const canPerform = policy<(role: "owner" | "editor" | "viewer", action: string) => boolean>("canPerformCollaborationAction");
    expect(canPerform("owner", "manage_members")).toBe(true);
    expect(canPerform("editor", "manage_members")).toBe(false);
    expect(canPerform("editor", "create_comment")).toBe(true);
    expect(canPerform("editor", "edit_any_comment")).toBe(false);
    expect(canPerform("viewer", "create_comment")).toBe(false);
    expect(canPerform("viewer", "read_activity")).toBe(true);
    expect(canPerform("viewer", "read_audit")).toBe(false);
    expect(canPerform("editor", "create_share")).toBe(true);
    expect(canPerform("editor", "manage_any_share")).toBe(false);
  });

  it("requires every unique mention target to be a current member", () => {
    const validMentions = policy<(targets: readonly string[], members: ReadonlySet<string>) => boolean>("areMentionTargetsCurrentMembers");
    const members = new Set(["user-1", "user-2"]);
    expect(validMentions(["user-1", "user-2"], members)).toBe(true);
    expect(validMentions(["user-1", "missing"], members)).toBe(false);
    expect(validMentions(["user-1", "user-1"], members)).toBe(false);
  });

  it("exposes only public-share fields and permits only forward terminal transitions", () => {
    const filterPublic = policy<(input: Record<string, unknown>) => Record<string, unknown>>("filterPublicShareContent");
    const invitationTransition = policy<(from: string, to: string) => boolean>("canTransitionInvitationStatus");
    const shareTransition = policy<(from: string, to: string) => boolean>("canTransitionPublicShareStatus");
    expect(filterPublic({
      share_id: "share-1", entity_type: "note", title: "Shared", content: "Public body", revision: 2,
      updated_at: "2026-08-22T00:00:00.000Z", workspace_id: "ws-1", token_hash: "private", comments: [],
    })).toEqual({
      share_id: "share-1", entity_type: "note", title: "Shared", content: "Public body", revision: 2,
      updated_at: "2026-08-22T00:00:00.000Z",
    });
    expect(invitationTransition("pending", "accepted")).toBe(true);
    expect(invitationTransition("accepted", "pending")).toBe(false);
    expect(shareTransition("active", "revoked")).toBe(true);
    expect(shareTransition("revoked", "active")).toBe(false);
  });
});
