import { request } from "@/api/client";
import type { Workspace, WorkspaceInvitePreview, WorkspaceInviteResult, WorkspaceMember } from "@/types/workspace";

export function getWorkspaces() {
  return request<Workspace[]>("/api/workspaces");
}

export function createWorkspace(name: string) {
  return request<Workspace>("/api/workspaces", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function switchWorkspace(workspaceId: string) {
  return request<Workspace>(`/api/workspaces/${workspaceId}/switch`, {
    method: "POST",
  });
}

export function getWorkspaceMembers(workspaceId: string) {
  return request<WorkspaceMember[]>(`/api/workspaces/${workspaceId}/members`);
}

export function inviteWorkspaceMember(workspaceId: string, payload: { email: string; role: "editor" | "viewer"; note_id?: string | null }) {
  return request<WorkspaceInviteResult>(
    `/api/workspaces/${workspaceId}/invites`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function acceptWorkspaceInvite(token: string) {
  return request<Workspace>("/api/workspaces/invites/accept", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function getWorkspaceInvitePreview(token: string) {
  return request<WorkspaceInvitePreview>(`/api/workspaces/invites/preview?token=${encodeURIComponent(token)}`);
}
