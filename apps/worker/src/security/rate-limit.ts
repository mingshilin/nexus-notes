interface TokenHasher {
  hash(value: string): Promise<string>;
}

export class RateLimitError extends Error {
  readonly code = "RATE_LIMITED";
  readonly status = 429;
  readonly retryable = true;

  constructor(readonly retryAfterSeconds: number) {
    super("Too many requests");
    this.name = "RateLimitError";
  }
}

export class D1RateLimiter {
  constructor(
    private readonly db: D1Database,
    private readonly tokens: TokenHasher,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async consume(input: { key: string; limit: number; windowSeconds: number }) {
    const bucketKey = await this.tokens.hash(input.key);
    const nowDate = this.clock();
    const now = nowDate.toISOString();
    const expiresAt = new Date(nowDate.getTime() + input.windowSeconds * 1000).toISOString();
    const result = await this.db.prepare(
      `INSERT INTO rate_limits (bucket_key, count, window_started_at, expires_at)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET
         count = CASE WHEN rate_limits.expires_at <= excluded.window_started_at THEN 1 ELSE rate_limits.count + 1 END,
         window_started_at = CASE WHEN rate_limits.expires_at <= excluded.window_started_at THEN excluded.window_started_at ELSE rate_limits.window_started_at END,
         expires_at = CASE WHEN rate_limits.expires_at <= excluded.window_started_at THEN excluded.expires_at ELSE rate_limits.expires_at END
       RETURNING count, expires_at`,
    ).bind(bucketKey, now, expiresAt).first<{ count: number; expires_at: string }>();
    if (!result) throw new Error("RATE_LIMIT_COUNTER_FAILED");
    if (result.count > input.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(result.expires_at) - nowDate.getTime()) / 1000));
      throw new RateLimitError(retryAfterSeconds);
    }
  }
}
