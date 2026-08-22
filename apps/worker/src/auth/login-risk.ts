import { normalizeEmail } from "@nexus/domain";

interface TokenHasher {
  hash(value: string): Promise<string>;
}

export class D1LoginRiskService {
  constructor(
    private readonly db: D1Database,
    private readonly tokens: TokenHasher,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async requiresLoginChallenge(input: { email: string; ip: string }) {
    const bucket = await this.bucket(input);
    const row = await this.db.prepare(
      `SELECT count FROM rate_limits WHERE bucket_key = ? AND expires_at > ? LIMIT 1`,
    ).bind(bucket, this.clock().toISOString()).first<{ count: number }>();
    return Number(row?.count ?? 0) >= 3;
  }

  async recordFailure(input: { email: string; ip: string }) {
    const nowDate = this.clock();
    const now = nowDate.toISOString();
    const expiresAt = new Date(nowDate.getTime() + 30 * 60 * 1000).toISOString();
    await this.db.prepare(
      `INSERT INTO rate_limits (bucket_key, count, window_started_at, expires_at)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET
         count = CASE WHEN rate_limits.expires_at <= excluded.window_started_at THEN 1 ELSE rate_limits.count + 1 END,
         window_started_at = CASE WHEN rate_limits.expires_at <= excluded.window_started_at THEN excluded.window_started_at ELSE rate_limits.window_started_at END,
         expires_at = CASE WHEN rate_limits.expires_at <= excluded.window_started_at THEN excluded.expires_at ELSE rate_limits.expires_at END`,
    ).bind(await this.bucket(input), now, expiresAt).run();
  }

  async clearFailures(input: { email: string; ip: string }) {
    await this.db.prepare(`DELETE FROM rate_limits WHERE bucket_key = ?`).bind(await this.bucket(input)).run();
  }

  private bucket(input: { email: string; ip: string }) {
    return this.tokens.hash(`login-failure:${normalizeEmail(input.email)}:${input.ip}`);
  }
}
