import type { AccountSession, Profile, WorkspaceMembershipSummary } from "@nexus/contracts";
import type { ProfileClient } from "../data/profile-client";

export type ProfileClientLike = Pick<ProfileClient, "getProfile" | "updateProfile" | "uploadAvatar" | "deleteAvatar" | "requestEmailChange" | "confirmEmailChange" | "changePassword" | "listSessions" | "revokeSession">;
export type AccountTab = "profile" | "security" | "workspace" | "privacy";

export interface AccountCenterProps {
  client: ProfileClientLike;
  workspaces: WorkspaceMembershipSummary[];
  activeWorkspaceId: string | null;
  onWorkspaceChange(workspaceId: string): void;
  onDeleted(): void;
  onProfileChange?(profile: Profile): void;
  initialTab?: AccountTab;
}

export type { AccountSession, Profile };
export { AccountCenter } from "./AccountCenter";
export { ProfilePanel } from "./ProfilePanel";
export { SecurityPanel } from "./SecurityPanel";
