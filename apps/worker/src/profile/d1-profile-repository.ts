import type { AccountSession, UpdateProfileInput } from "@nexus/contracts";

import { ProfileServiceError } from "./profile-model";
import type { ProfileRepository, StoredProfile } from "./profile-model";

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
    return row ? { ...row, avatar_url: row.avatar_key } : null;
  }

  findActiveUserByEmail(email: string): Promise<{ id: string } | null> {
    return this.db.prepare(
      "SELECT id FROM users WHERE email = ? COLLATE NOCASE AND status = 'active' LIMIT 1",
    ).bind(email).first<{ id: string }>();
  }

  async updateProfile(userId: string, patch: UpdateProfileInput, now: string): Promise<void> {
    const fields: Array<[keyof UpdateProfileInput, string]> = [
      ["display_name", "display_name"],
      ["biography", "biography"],
      ["locale", "locale"],
      ["timezone", "timezone"],
    ];
    const updates = fields.filter(([key]) => patch[key] !== undefined);
    if (updates.length === 0) return;

    const assignments = updates.map(([, column]) => `${column} = ?`);
    const values = updates.map(([key]) => patch[key]);
    await this.db.prepare(
      `UPDATE users SET ${assignments.join(", ")}, updated_at = ? WHERE id = ?`,
    ).bind(...values, now, userId).run();
  }

  async replaceAvatar(userId: string, avatarKey: string | null, now: string): Promise<string | null> {
    const results = await this.db.batch<{ avatar_key: string | null }>([
      this.db.prepare("SELECT avatar_key FROM users WHERE id = ? LIMIT 1").bind(userId),
      this.db.prepare("UPDATE users SET avatar_key = ?, updated_at = ? WHERE id = ?").bind(avatarKey, now, userId),
    ]);
    return results[0]?.results?.[0]?.avatar_key ?? null;
  }

  async listSessions(userId: string, currentSessionId: string, now: string): Promise<AccountSession[]> {
    const rows = await this.db.prepare(
      `SELECT id, user_agent, created_at, last_seen_at, expires_at
       FROM sessions
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
       ORDER BY last_seen_at DESC, id DESC`,
    ).bind(userId, now).all<SessionRow>();
    return rows.results.map((row) => ({ ...row, current: row.id === currentSessionId }));
  }

  async listOwnedTeamWorkspaces(userId: string): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.db.prepare(
      `SELECT id, name FROM workspaces
       WHERE owner_user_id = ? AND workspace_type = 'team'
       ORDER BY lower(name), id`,
    ).bind(userId).all<{ id: string; name: string }>();
    return rows.results;
  }

  async revokeOwnedSession(userId: string, sessionId: string, currentSessionId: string, now: string): Promise<boolean> {
    const row = await this.db.prepare(
      `UPDATE sessions SET revoked_at = ?
       WHERE id = ? AND user_id = ? AND id <> ? AND revoked_at IS NULL
       RETURNING id`,
    ).bind(now, sessionId, userId, currentSessionId).first<{ id: string }>();
    return Boolean(row);
  }

  async createEmailChange(userId: string, email: string, codeHash: string, expiresAt: string, now: string): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        "UPDATE email_change_requests SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL",
      ).bind(now, userId),
      this.db.prepare(
        `INSERT INTO email_change_requests (id, user_id, new_email, code_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(this.createId(), userId, email, codeHash, expiresAt, now),
    ]);
  }

  async consumeEmailChange(userId: string, email: string, codeHash: string, now: string): Promise<boolean> {
    const update = this.db.prepare(
      `UPDATE users SET email = ?, email_verified_at = ?, updated_at = ?
       WHERE id = ? AND EXISTS (
         SELECT 1 FROM email_change_requests
         WHERE user_id = ? AND new_email = ? COLLATE NOCASE AND code_hash = ?
           AND consumed_at IS NULL AND expires_at > ?
       )`,
    ).bind(email, now, now, userId, userId, email, codeHash, now);
    const consume = this.db.prepare(
      `UPDATE email_change_requests SET consumed_at = ?
       WHERE user_id = ? AND new_email = ? COLLATE NOCASE AND code_hash = ?
         AND consumed_at IS NULL AND expires_at > ?
       RETURNING id`,
    ).bind(now, userId, email, codeHash, now);
    const result = await this.db.batch([update, consume]);
    return Boolean(result[1]?.results?.length);
  }

  async changePasswordAndRevokeOthers(userId: string, currentSessionId: string, passwordHash: string, now: string): Promise<void> {
    await this.db.batch([
      this.db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(passwordHash, now, userId),
      this.db.prepare(
        "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL",
      ).bind(now, userId, currentSessionId),
    ]);
  }

  async deleteAccount(userId: string, anonymizedEmail: string, passwordHash: string, now: string): Promise<string | null> {
    const noOwnedTeamWorkspace = `NOT EXISTS (
      SELECT 1 FROM workspaces WHERE owner_user_id = ? AND workspace_type = 'team'
    )`;
    const results = await this.db.batch([
      this.db.prepare(
        `SELECT id, name FROM workspaces
         WHERE owner_user_id = ? AND workspace_type = 'team'
         ORDER BY lower(name), id`,
      ).bind(userId),
      this.db.prepare(
        `SELECT avatar_key FROM users WHERE id = ? AND ${noOwnedTeamWorkspace} LIMIT 1`,
      ).bind(userId, userId),
      this.db.prepare(
        `DELETE FROM workspaces
         WHERE owner_user_id = ? AND workspace_type = 'personal' AND ${noOwnedTeamWorkspace}`,
      ).bind(userId, userId),
      this.db.prepare(`DELETE FROM workspace_members WHERE user_id = ? AND ${noOwnedTeamWorkspace}`).bind(userId, userId),
      this.db.prepare(`DELETE FROM email_codes WHERE user_id = ? AND ${noOwnedTeamWorkspace}`).bind(userId, userId),
      this.db.prepare(`DELETE FROM password_resets WHERE user_id = ? AND ${noOwnedTeamWorkspace}`).bind(userId, userId),
      this.db.prepare(`DELETE FROM email_change_requests WHERE user_id = ? AND ${noOwnedTeamWorkspace}`).bind(userId, userId),
      this.db.prepare(
        `UPDATE sessions SET revoked_at = ?
         WHERE user_id = ? AND revoked_at IS NULL AND ${noOwnedTeamWorkspace}`,
      ).bind(now, userId, userId),
      this.db.prepare(
        `UPDATE users
         SET email = ?, password_hash = ?, display_name = '已删除用户', biography = '', avatar_key = NULL,
           status = 'deleted', deletion_requested_at = ?, updated_at = ?
         WHERE id = ? AND ${noOwnedTeamWorkspace}`,
      ).bind(anonymizedEmail, passwordHash, now, now, userId, userId),
    ]);
    const ownedWorkspaces = results[0]?.results as Array<{ id: string; name: string }> | undefined;
    if (ownedWorkspaces?.length) {
      throw new ProfileServiceError("OWNERSHIP_TRANSFER_REQUIRED", "Transfer owned team workspaces before deleting the account", 409);
    }
    const avatar = results[1]?.results?.[0] as { avatar_key: string | null } | undefined;
    return avatar?.avatar_key ?? null;
  }

  async appendAudit(userId: string, event: string, requestId: string, now: string): Promise<void> {
    await this.db.prepare(
      `INSERT INTO account_audit_logs (id, user_id, event, request_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(this.createId(), userId, event, requestId, now).run();
  }
}
