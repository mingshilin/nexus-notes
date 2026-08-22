import type { AccountSession, Profile, WorkspaceMembershipSummary } from "@nexus/contracts";
import type { ProfileClient } from "../data/profile-client";
import type { CollaborationClient } from "../data/collaboration-client";
import type { OperationsClient } from "../data/operations-client";

export type ProfileClientLike = Pick<ProfileClient, "getProfile" | "updateProfile" | "uploadAvatar" | "deleteAvatar" | "requestEmailChange" | "confirmEmailChange" | "changePassword" | "listSessions" | "revokeSession" | "deleteAccount">;
export type CollaborationClientLike = Pick<CollaborationClient, "listMembers" | "updateMemberRole" | "removeMember" | "createInvitation">;
export type OperationsClientLike = Pick<OperationsClient, "getUsage" | "getStatus" | "createJob">;
export type AccountTab = "profile" | "security" | "workspace" | "privacy";

export interface AccountCenterProps {
  client: ProfileClientLike;
  collaboration?: CollaborationClientLike;
  operations?: OperationsClientLike;
  workspaces: WorkspaceMembershipSummary[];
  activeWorkspaceId: string | null;
  currentUserId?: string;
  onWorkspaceChange(workspaceId: string): void | Promise<void>;
  onPrepareDelete?(): Promise<void>;
  onDeleteFailed?(): void;
  onDeleted(): void;
  onProfileChange?(profile: Profile): void;
  initialTab?: AccountTab;
}

export type { AccountSession, Profile };
export { AccountCenter } from "./AccountCenter";
export { ProfilePanel } from "./ProfilePanel";
export { SecurityPanel } from "./SecurityPanel";
export { WorkspacePanel } from "./WorkspacePanel";
export { DataPrivacyPanel } from "./DataPrivacyPanel";
