import { assertQuotaAvailable, DEFAULT_BETA_QUOTAS, type BetaQuotaKey } from "@nexus/domain";

export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED";
  readonly status = 403;
  readonly retryable = false;

  constructor(readonly quota: BetaQuotaKey) {
    super(`Workspace quota exceeded: ${quota}`);
    this.name = "QuotaExceededError";
  }
}

function isQuotaKey(value: string): value is BetaQuotaKey {
  return Object.hasOwn(DEFAULT_BETA_QUOTAS, value);
}

export class D1QuotaService {
  constructor(private readonly db: D1Database) {}

  async assertAvailable(workspaceId: string, key: string, delta: number) {
    if (!isQuotaKey(key)) throw new Error(`UNKNOWN_QUOTA:${key}`);
    const override = await this.db.prepare(
      `SELECT limit_value FROM workspace_quotas WHERE workspace_id = ? AND quota_key = ? LIMIT 1`,
    ).bind(workspaceId, key).first<{ limit_value: number }>();
    const usage = await this.db.prepare(
      `SELECT COALESCE(SUM(value), 0) AS value
       FROM usage_counters WHERE workspace_id = ? AND counter_key = ?`,
    ).bind(workspaceId, key).first<{ value: number }>();

    try {
      assertQuotaAvailable(key, Number(usage?.value ?? 0), delta, override?.limit_value);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("QUOTA_EXCEEDED:")) {
        throw new QuotaExceededError(key);
      }
      throw error;
    }
  }
}
