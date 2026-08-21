import type { AuthRepository, AuthUser } from "./auth-service";

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  email_verified_at: string | null;
  status: AuthUser["status"];
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

  async consumeEmailCode(codeHash: string, now: string) {
    const row = await this.db.prepare(
      `UPDATE email_codes
       SET consumed_at = ?
       WHERE code_hash = ? AND purpose = 'verify_email' AND consumed_at IS NULL AND expires_at > ?
       RETURNING user_id`,
    ).bind(now, codeHash, now).first<{ user_id: string }>();
    return row ? { userId: row.user_id } : null;
  }

  async markEmailVerified(userId: string, now: string) {
    await this.db.prepare(
      `UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`,
    ).bind(now, now, userId).run();
  }

  async createSession(input: { userId: string; tokenHash: string; expiresAt: string; now: string }) {
    await this.db.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(this.createId(), input.userId, input.tokenHash, input.expiresAt, input.now, input.now).run();
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
