export type WorkspaceRole = "owner" | "editor" | "viewer";

const roleRank: Record<WorkspaceRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export function hasWorkspaceRole(actual: WorkspaceRole, minimum: WorkspaceRole) {
  return roleRank[actual] >= roleRank[minimum];
}

export function canWorkspaceWrite(role: WorkspaceRole) {
  return hasWorkspaceRole(role, "editor");
}

export const DEFAULT_BETA_QUOTAS = {
  workspaces_per_user: 2,
  members: 10,
  notes: 10_000,
  databases: 100,
  records_per_database: 50_000,
  attachment_bytes: 1024 * 1024 * 1024,
  attachment_file_bytes: 25 * 1024 * 1024,
} as const;

export type BetaQuotaKey = keyof typeof DEFAULT_BETA_QUOTAS;

export function assertQuotaAvailable(
  key: BetaQuotaKey,
  current: number,
  delta: number,
  override?: number,
) {
  const limit = override ?? DEFAULT_BETA_QUOTAS[key];
  if (current + delta > limit) throw new Error(`QUOTA_EXCEEDED:${key}`);
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function assertPasswordPolicy(password: string) {
  if (password.length < 10) throw new Error("PASSWORD_TOO_SHORT");
  if (password.length > 128) throw new Error("PASSWORD_TOO_LONG");
}
