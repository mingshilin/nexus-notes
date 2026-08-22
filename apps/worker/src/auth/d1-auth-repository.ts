import type { AuthRepository, AuthUser, AuthWorkspaceMembership } from "./auth-service";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  email_verified_at: string | null;
  status: AuthUser["status"];
}

interface WorkspaceMembershipRow {
  id: string;
  name: string;
  slug: string;
  role: string;
  revision: number;
  workspace_type: string;
}

function isWorkspaceRole(role: string): role is AuthWorkspaceMembership["role"] {
  return role === "owner" || role === "editor" || role === "viewer";
}

function isWorkspaceType(type: string): type is AuthWorkspaceMembership["workspaceType"] {
  return type === "personal" || type === "team";
}

export class D1AuthRepository implements AuthRepository {
  constructor(
    private readonly db: D1Database,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  findUserByEmail(email: string) {
    return this.db.prepare(
      `SELECT id, email, password_hash, display_name, email_verified_at, status
       FROM users WHERE email = ? COLLATE NOCASE LIMIT 1`,
    ).bind(email).first<UserRow>();
  }

  getUserById(userId: string) {
    return this.db.prepare(
      `SELECT id, email, password_hash, display_name, email_verified_at, status
       FROM users WHERE id = ? LIMIT 1`,
    ).bind(userId).first<UserRow>();
  }

  async createPendingUser(input: { email: string; passwordHash: string; displayName: string; now: string }) {
    const id = this.createId();
    await this.db.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(id, input.email, input.passwordHash, input.displayName, input.now, input.now).run();
    return { id, email: input.email };
  }

  async createEmailCode(input: { userId: string; codeHash: string; purpose: "verify_email"; expiresAt: string; now: string }) {
    await this.db.prepare(
      `INSERT INTO email_codes (id, user_id, purpose, code_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(this.createId(), input.userId, input.purpose, input.codeHash, input.expiresAt, input.now).run();
  }

  async verifyEmailCodeAndEnsurePersonalWorkspace(codeHash: string, now: string) {
    const workspaceId = this.createId();
    const consumeCode = this.db.prepare(
      `UPDATE email_codes
       SET consumed_at = ?
       WHERE code_hash = ? AND purpose = 'verify_email' AND consumed_at IS NULL AND expires_at > ?
       RETURNING user_id`,
    ).bind(now, codeHash, now);
    const verifyUser = this.db.prepare(
      `UPDATE users
       SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ?
       WHERE id IN (
         SELECT user_id
         FROM email_codes
         WHERE code_hash = ? AND purpose = 'verify_email' AND consumed_at = ?
       )`,
    ).bind(now, now, codeHash, now);
    const createWorkspace = this.db.prepare(
      `INSERT INTO workspaces (
         id, owner_user_id, slug, name, workspace_type, revision, created_at, updated_at
       )
       SELECT ?, user_id, ?, 'Personal workspace', 'personal', 1, ?, ?
       FROM email_codes
       WHERE code_hash = ? AND purpose = 'verify_email' AND consumed_at = ?
       ON CONFLICT(owner_user_id) WHERE workspace_type = 'personal' DO NOTHING`,
    ).bind(workspaceId, `personal-${workspaceId}`, now, now, codeHash, now);
    const ensureOwnerMembership = this.db.prepare(
      `INSERT INTO workspace_members (
         workspace_id, user_id, role, revision, joined_at, updated_at
       )
       SELECT w.id, e.user_id, 'owner', 1, ?, ?
       FROM email_codes e
       JOIN workspaces w ON w.owner_user_id = e.user_id AND w.workspace_type = 'personal'
       WHERE e.code_hash = ? AND e.purpose = 'verify_email' AND e.consumed_at = ?
       ON CONFLICT(workspace_id, user_id) DO UPDATE SET
         role = 'owner',
         revision = workspace_members.revision + 1,
         updated_at = excluded.updated_at
       WHERE workspace_members.role <> 'owner'`,
    ).bind(now, now, codeHash, now);

    const results = await this.db.batch([consumeCode, verifyUser, createWorkspace, ensureOwnerMembership]);
    const row = results[0]?.results?.[0] as { user_id?: string } | undefined;
    return row?.user_id ? { userId: row.user_id } : null;
  }

  private personalWorkspaceStatements(userId: string, now: string) {
    const workspaceId = this.createId();
    const createWorkspace = this.db.prepare(
      `INSERT INTO workspaces (
         id, owner_user_id, slug, name, workspace_type, revision, created_at, updated_at
       ) VALUES (?, ?, ?, 'Personal workspace', 'personal', 1, ?, ?)
       ON CONFLICT(owner_user_id) WHERE workspace_type = 'personal' DO NOTHING`,
    ).bind(workspaceId, userId, `personal-${workspaceId}`, now, now);
    const ensureOwnerMembership = this.db.prepare(
      `INSERT INTO workspace_members (
         workspace_id, user_id, role, revision, joined_at, updated_at
       )
       SELECT id, owner_user_id, 'owner', 1, ?, ?
       FROM workspaces
       WHERE owner_user_id = ? AND workspace_type = 'personal'
       ON CONFLICT(workspace_id, user_id) DO UPDATE SET
         role = 'owner',
         revision = workspace_members.revision + 1,
         updated_at = excluded.updated_at
       WHERE workspace_members.role <> 'owner'`,
    ).bind(now, now, userId);
    return [createWorkspace, ensureOwnerMembership];
  }

  async ensurePersonalWorkspace(userId: string, now: string) {
    await this.db.batch(this.personalWorkspaceStatements(userId, now));
  }

  async listWorkspaceMemberships(userId: string): Promise<AuthWorkspaceMembership[]> {
    const rows = await this.db.prepare(
      `SELECT w.id, w.name, w.slug, wm.role, w.revision, w.workspace_type
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.user_id = ?
       ORDER BY
         CASE WHEN w.workspace_type = 'personal' THEN 0 ELSE 1 END,
         lower(w.name),
         w.slug,
         w.id`,
    ).bind(userId).all<WorkspaceMembershipRow>();

    return rows.results.map((row) => {
      if (!isWorkspaceRole(row.role) || !isWorkspaceType(row.workspace_type)) {
        throw new Error("Invalid workspace membership data");
      }
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        role: row.role,
        revision: row.revision,
        workspaceType: row.workspace_type,
      };
    });
  }

  async createSession(input: { userId: string; tokenHash: string; expiresAt: string; now: string; userAgent: string }) {
    await this.db.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, last_seen_at, created_at, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(this.createId(), input.userId, input.tokenHash, input.expiresAt, input.now, input.now, input.userAgent).run();
  }

  async createPasswordReset(input: { userId: string; tokenHash: string; expiresAt: string; now: string }) {
    await this.db.prepare(
      `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(this.createId(), input.userId, input.tokenHash, input.expiresAt, input.now).run();
  }

  async consumePasswordReset(tokenHash: string, now: string) {
    const row = await this.db.prepare(
      `UPDATE password_resets
       SET consumed_at = ?
       WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
       RETURNING user_id`,
    ).bind(now, tokenHash, now).first<{ user_id: string }>();
    return row ? { userId: row.user_id } : null;
  }

  async updatePasswordAndRevokeSessions(userId: string, passwordHash: string, now: string) {
    const updatePassword = this.db.prepare(
      `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
    ).bind(passwordHash, now, userId);
    const revokeSessions = this.db.prepare(
      `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
    ).bind(now, userId);
    await this.db.batch([updatePassword, revokeSessions]);
  }

  async revokeSession(sessionId: string, now: string) {
    await this.db.prepare(
      `UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
    ).bind(now, sessionId).run();
  }
}
