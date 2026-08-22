export type WorkspaceRole = "owner" | "editor" | "viewer";

export interface WorkspaceContext {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  capabilities: ReadonlySet<string>;
}
