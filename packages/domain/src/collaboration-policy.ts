import type { WorkspaceRole } from "./security-policy";

const sensitiveAuditKey = /(content|password|token|code|cookie|authorization|attachment.*bytes|body|secret)/iu;

export type CollaborationAction =
  | "manage_members"
  | "create_comment"
  | "edit_own_comment"
  | "edit_any_comment"
  | "read_activity"
  | "read_audit"
  | "create_share"
  | "manage_own_share"
  | "manage_any_share";

const collaborationActions: Record<WorkspaceRole, ReadonlySet<CollaborationAction>> = {
  owner: new Set([
    "manage_members", "create_comment", "edit_own_comment", "edit_any_comment", "read_activity",
    "read_audit", "create_share", "manage_own_share", "manage_any_share",
  ]),
  editor: new Set(["create_comment", "edit_own_comment", "read_activity", "create_share", "manage_own_share"]),
  viewer: new Set(["read_activity"]),
};

export function canPerformCollaborationAction(role: WorkspaceRole, action: CollaborationAction) {
  return collaborationActions[role].has(action);
}

export function canManageWorkspaceMember(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
  nextRole: WorkspaceRole | null,
  ownerCount = 1,
) {
  if (actorRole !== "owner") return false;
  return targetRole !== "owner" || nextRole === "owner" || ownerCount > 1;
}

export function canMutateComment(role: WorkspaceRole, isAuthor: boolean) {
  if (role === "viewer") return false;
  return role === "owner" || isAuthor;
}

export function areMentionTargetsCurrentMembers(targets: readonly string[], members: ReadonlySet<string>) {
  return new Set(targets).size === targets.length && targets.every((target) => members.has(target));
}

const publicShareFields = ["share_id", "entity_type", "title", "content", "revision", "updated_at"] as const;

export function filterPublicShareContent(input: Record<string, unknown>) {
  return Object.fromEntries(publicShareFields.filter((key) => key in input).map((key) => [key, input[key]]));
}

export function canTransitionInvitationStatus(from: string, to: string) {
  return from === "pending" && (to === "accepted" || to === "revoked" || to === "expired");
}

export function canTransitionPublicShareStatus(from: string, to: string) {
  return from === "active" && (to === "revoked" || to === "expired");
}

export function redactAuditMetadata(input: Record<string, unknown>) {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (sensitiveAuditKey.test(key)) continue;
    if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      safe[key] = typeof value === "string" ? value.slice(0, 256) : value;
    }
  }
  return safe;
}
