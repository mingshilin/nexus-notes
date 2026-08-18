export interface Workspace {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
  role?: "owner" | "editor" | "viewer";
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: "owner" | "editor" | "viewer";
  created_at: string;
  updated_at: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface WorkspaceInviteResult {
  invite_url: string;
  token: string;
  email: string;
  role: "editor" | "viewer";
  note_id?: string | null;
}

export interface WorkspaceInvitePreview {
  workspace_id: string;
  workspace_name: string;
  invited_email_masked: string;
  role: "editor" | "viewer";
  expires_at: string;
  inviter_display: string;
  note_id?: string | null;
  note_title?: string | null;
}
