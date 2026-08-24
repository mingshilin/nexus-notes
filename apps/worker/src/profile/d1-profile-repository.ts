import type { AccountSession, UpdateProfileInput } from "@nexus/contracts";

import { assertAccountAuditEvent, ProfileServiceError, type ProfileMutationAudit, type ProfileRepository, type StoredProfile } from "./profile-model";

interface ProfileRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  biography: string;
  locale: string;
  timezone: string;
  avatar_key: string | null;
  updated_at: string;
}

interface SessionRow {
  id: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export class D1ProfileRepository implements ProfileRepository {
  constructor(
    private readonly db: D1Database,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async getProfile(userId: string): Promise<StoredProfile | null> {
    const row = await this.db.prepare(
      `SELECT id, email, password_hash, display_name, biography, locale, timezone, avatar_key, updated_at
       FROM users WHERE id = ? LIMIT 1`,
    ).bind(userId).first<ProfileRow>();
    return row ? { ...row, avatar_url: row.avatar_key ? "/api/v2/profile/avatar" : null } : null;
  }

  findActiveUserByEmail(email: string): Promise<{ id: string } | null> {
    return this.db.prepare(
      "SELECT id FROM users WHERE email = ? COLLATE NOCASE AND status = 'active' LIMIT 1",
    ).bind(email).first<{ id: string }>();
  }

  async updateProfile(userId: string, patch: UpdateProfileInput, audit: ProfileMutationAudit): Promise<void> {
    const fields: Array<[keyof UpdateProfileInput, string]> = [
      ["display_name", "display_name"], ["biography", "biography"], ["locale", "locale"], ["timezone", "timezone"],
    ];
    const updates = fields.filter(([key]) => patch[key] !== undefined);
    if (updates.length === 0) return;
    const assignments = updates.map(([, column]) => `${column} = ?`);
    const values = updates.map(([key]) => patch[key]);
    await this.db.batch([
      this.db.prepare(`UPDATE users SET ${assignments.join(", ")}, updated_at = ? WHERE id = ?`).bind(...values, audit.now, userId),
      this.auditStatement(userId, audit),
    ]);
  }

  async replaceAvatar(userId: string, avatarKey: string | null, audit: ProfileMutationAudit): Promise<string | null> {
    const results = await this.db.batch<{ avatar_key: string | null }>([
      this.db.prepare("SELECT avatar_key FROM users WHERE id = ? LIMIT 1").bind(userId),
      this.db.prepare("UPDATE users SET avatar_key = ?, updated_at = ? WHERE id = ?").bind(avatarKey, audit.now, userId),
      this.auditStatement(userId, audit),
    ]);
    return results[0]?.results?.[0]?.avatar_key ?? null;
  }

  async listSessions(userId: string, currentSessionId: string, now: string): Promise<AccountSession[]> {
    const rows = await this.db.prepare(
      `SELECT id, user_agent, created_at, last_seen_at, expires_at FROM sessions
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC, id DESC`,
    ).bind(userId, now).all<SessionRow>();
    return rows.results.map((row) => ({ ...row, current: row.id === currentSessionId }));
  }

  async listOwnedTeamWorkspaces(userId: string) {
    const rows = await this.db.prepare(
      `SELECT id, name FROM workspaces WHERE owner_user_id = ? AND workspace_type = 'team' ORDER BY lower(name), id`,
    ).bind(userId).all<{ id: string; name: string }>();
    return rows.results;
  }

  async revokeOwnedSession(userId: string, sessionId: string, currentSessionId: string, audit: ProfileMutationAudit): Promise<boolean> {
    const results = await this.db.batch<{ id: string }>([
      this.db.prepare(
        `INSERT INTO account_audit_logs (id, user_id, event, request_id, created_at)
         SELECT ?, ?, ?, ?, ? WHERE EXISTS (
           SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND id <> ? AND revoked_at IS NULL
         )`,
      ).bind(this.auditId(audit), userId, audit.event, audit.requestId, audit.now, sessionId, userId, currentSessionId),
      this.db.prepare(
        "UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND id <> ? AND revoked_at IS NULL RETURNING id",
      ).bind(audit.now, sessionId, userId, currentSessionId),
    ]);
    return Boolean(results[1]?.results?.length);
  }

  async createEmailChange(userId: string, email: string, codeHash: string, expiresAt: string, audit: ProfileMutationAudit): Promise<void> {
    await this.db.batch([
      this.db.prepare("UPDATE email_change_requests SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL").bind(audit.now, userId),
      this.db.prepare(
        "INSERT INTO email_change_requests (id, user_id, new_email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(this.createId(), userId, email, codeHash, expiresAt, audit.now),
      this.auditStatement(userId, audit),
    ]);
  }

  async consumeEmailChange(userId: string, email: string, codeHash: string, audit: ProfileMutationAudit): Promise<boolean> {
    try {
      const results = await this.db.batch<{ id: string }>([
        this.db.prepare(
          `UPDATE users SET email = ?, email_verified_at = ?, updated_at = ? WHERE id = ? AND EXISTS (
             SELECT 1 FROM email_change_requests WHERE user_id = ? AND new_email = ? COLLATE NOCASE
             AND code_hash = ? AND consumed_at IS NULL AND expires_at > ?
           )`,
        ).bind(email, audit.now, audit.now, userId, userId, email, codeHash, audit.now),
        this.db.prepare(
          `INSERT INTO account_audit_logs (id, user_id, event, request_id, created_at)
           SELECT ?, ?, ?, ?, ? WHERE EXISTS (
             SELECT 1 FROM email_change_requests WHERE user_id = ? AND new_email = ? COLLATE NOCASE
             AND code_hash = ? AND consumed_at IS NULL AND expires_at > ?
           )`,
        ).bind(this.auditId(audit), userId, audit.event, audit.requestId, audit.now, userId, email, codeHash, audit.now),
        this.db.prepare(
          `UPDATE email_change_requests SET consumed_at = ? WHERE user_id = ? AND new_email = ? COLLATE NOCASE
           AND code_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING id`,
        ).bind(audit.now, userId, email, codeHash, audit.now),
      ]);
      return Boolean(results[2]?.results?.length);
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed: users\.email/iu.test(error.message)) {
        throw new ProfileServiceError("EMAIL_EXISTS", "This email is already registered", 409);
      }
      throw error;
    }
  }

  async changePasswordAndRevokeOthers(userId: string, currentSessionId: string, passwordHash: string, audit: ProfileMutationAudit): Promise<void> {
    await this.db.batch([
      this.db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(passwordHash, audit.now, userId),
      this.db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL").bind(audit.now, userId, currentSessionId),
      this.auditStatement(userId, audit),
    ]);
  }

  async deleteAccount(userId: string, anonymizedEmail: string, passwordHash: string, audit: ProfileMutationAudit): Promise<string | null> {
    const noOwnedTeamWorkspace = "NOT EXISTS (SELECT 1 FROM workspaces WHERE owner_user_id = ? AND workspace_type = 'team')";
    const results = await this.db.batch<{ avatar_key: string | null } | { id: string; name: string }>([
      this.db.prepare("SELECT id, name FROM workspaces WHERE owner_user_id = ? AND workspace_type = 'team' ORDER BY lower(name), id").bind(userId),
      this.db.prepare(`SELECT avatar_key FROM users WHERE id = ? AND ${noOwnedTeamWorkspace} LIMIT 1`).bind(userId, userId),
      // Immutable workspace audit rows prevent a cascading workspace delete. In that
      // case archive the personal workspace after removing membership instead of
      // failing the account deletion transaction.
      this.db.prepare(`DELETE FROM workspaces WHERE owner_user_id = ? AND workspace_type = 'personal' AND NOT EXISTS (
        SELECT 1 FROM audit_logs WHERE audit_logs.workspace_id = workspaces.id
      ) AND ${noOwnedTeamWorkspace}`).bind(userId, userId),
      this.db.prepare(`UPDATE workspaces SET name = '已删除账户空间', slug = 'deleted-' || id, updated_at = ?
        WHERE owner_user_id = ? AND workspace_type = 'personal'
          AND EXISTS (SELECT 1 FROM audit_logs WHERE audit_logs.workspace_id = workspaces.id)
          AND ${noOwnedTeamWorkspace}`).bind(audit.now, userId, userId),
      this.db.prepare(`DELETE FROM workspace_members WHERE user_id = ? AND ${noOwnedTeamWorkspace}`).bind(userId, userId),
      this.db.prepare(`DELETE FROM email_codes WHERE user_id = ? AND ${noOwnedTeamWorkspace}`).bind(userId, userId),
      this.db.prepare(`DELETE FROM password_resets WHERE user_id = ? AND ${noOwnedTeamWorkspace}`).bind(userId, userId),
      this.db.prepare(`DELETE FROM email_change_requests WHERE user_id = ? AND ${noOwnedTeamWorkspace}`).bind(userId, userId),
      this.db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND ${noOwnedTeamWorkspace}`).bind(audit.now, userId, userId),
      this.db.prepare(
        `UPDATE users SET email = ?, password_hash = ?, display_name = '已删除用户', biography = '', avatar_key = NULL,
         status = 'deleted', deletion_requested_at = ?, updated_at = ? WHERE id = ? AND ${noOwnedTeamWorkspace}`,
      ).bind(anonymizedEmail, passwordHash, audit.now, audit.now, userId, userId),
      this.db.prepare(
        `INSERT INTO account_audit_logs (id, user_id, event, request_id, created_at)
         SELECT ?, ?, ?, ?, ? WHERE ${noOwnedTeamWorkspace}`,
      ).bind(this.auditId(audit), userId, audit.event, audit.requestId, audit.now, userId),
    ]);
    const ownedWorkspaces = results[0]?.results as Array<{ id: string; name: string }> | undefined;
    if (ownedWorkspaces?.length) {
      throw new ProfileServiceError(
        "OWNERSHIP_TRANSFER_REQUIRED",
        `Transfer owned team workspaces before deleting the account: ${ownedWorkspaces.map(({ name }) => name).join(", ")}`,
        409,
      );
    }
    const avatar = results[1]?.results?.[0] as { avatar_key: string | null } | undefined;
    return avatar?.avatar_key ?? null;
  }

  private auditStatement(userId: string, audit: ProfileMutationAudit) {
    return this.db.prepare(
      "INSERT INTO account_audit_logs (id, user_id, event, request_id, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(this.auditId(audit), userId, audit.event, audit.requestId, audit.now);
  }

  private auditId(audit: ProfileMutationAudit) {
    assertAccountAuditEvent(audit.event);
    return this.createId();
  }
}
