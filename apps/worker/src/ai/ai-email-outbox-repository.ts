export interface AiEmailOutboxRow {
  id: string;
  action_id: string;
  user_id: string;
  workspace_id: string;
  to_email: string;
  subject: string;
  body_text: string;
  status: "pending" | "sending" | "sent" | "failed" | "cancelled";
  attempt_count: number;
  available_at: string;
  sent_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
  dispatch_lease_until: string | null;
  dispatch_claim_token: string | null;
  delivery_lease_until: string | null;
  delivery_claim_token: string | null;
}

const EMAIL_CLAIM_TTL_MS = 5 * 60 * 1000;

export class AiEmailOutboxRepository {
  private readonly createId: () => string;
  private readonly clock: () => Date;

  constructor(
    private readonly db: D1Database,
    options: { createId?: () => string; clock?: () => Date } = {},
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.clock = options.clock ?? (() => new Date());
  }

  async enqueue(input: {
    actionId: string;
    userId: string;
    workspaceId: string;
    toEmail: string;
    subject: string;
    bodyText: string;
    now: string;
  }) {
    const id = `ai-email:${input.actionId}`;
    await this.db.prepare(
      `INSERT INTO ai_email_outbox (
         id, action_id, user_id, workspace_id, to_email, subject, body_text,
         status, attempt_count, available_at, sent_at, last_error_code, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      id,
      input.actionId,
      input.userId,
      input.workspaceId,
      input.toEmail,
      input.subject,
      input.bodyText,
      input.now,
      input.now,
      input.now,
    ).run();
    const row = await this.getById(id);
    if (!row) throw new Error("AI_EMAIL_OUTBOX_INSERT_FAILED");
    return row;
  }

  async listPendingOutbox(now: string, limit: number) {
    const rows = await this.db.prepare(
      `SELECT id, action_id, user_id, workspace_id, to_email, subject, body_text,
          status, attempt_count, available_at, sent_at, last_error_code, created_at, updated_at,
          dispatch_lease_until, dispatch_claim_token, delivery_lease_until, delivery_claim_token
       FROM ai_email_outbox
       WHERE ((status IN ('pending', 'failed') AND available_at <= ?)
          OR (status = 'sending' AND dispatch_claim_token IS NOT NULL AND dispatch_lease_until <= ?)
          OR (status = 'sending' AND delivery_claim_token IS NOT NULL AND delivery_lease_until <= ?))
       ORDER BY available_at, created_at, id
       LIMIT ?`,
    ).bind(now, now, now, Math.min(Math.max(limit, 1), 100)).all<AiEmailOutboxRow>();
    return rows.results ?? [];
  }

  async claimForDispatch(outboxId: string, now: string, leaseMs = EMAIL_CLAIM_TTL_MS) {
    const leaseUntil = new Date(Date.parse(now) + leaseMs).toISOString();
    const claimToken = this.createId();
    return this.db.prepare(
      `UPDATE ai_email_outbox
       SET status = 'sending', dispatch_lease_until = ?, dispatch_claim_token = ?,
           delivery_lease_until = NULL, delivery_claim_token = NULL, updated_at = ?
       WHERE id = ? AND (
         (status IN ('pending', 'failed') AND available_at <= ?)
         OR (status = 'sending' AND dispatch_claim_token IS NOT NULL AND dispatch_lease_until <= ?)
         OR (status = 'sending' AND delivery_claim_token IS NOT NULL AND delivery_lease_until <= ?)
       )
       RETURNING id, action_id, user_id, workspace_id, to_email, subject, body_text,
                 status, attempt_count, available_at, sent_at, last_error_code, created_at, updated_at,
                 dispatch_lease_until, dispatch_claim_token, delivery_lease_until, delivery_claim_token`,
    ).bind(leaseUntil, claimToken, now, outboxId, now, now, now).first<AiEmailOutboxRow>();
  }

  async releaseDispatch(outboxId: string, claimToken: string, now: string, retryAt: string, errorCode = "AI_EMAIL_QUEUE_FAILED") {
    const result = await this.db.prepare(
      `UPDATE ai_email_outbox
       SET status = 'failed', available_at = ?, updated_at = ?, last_error_code = ?,
           dispatch_lease_until = NULL, dispatch_claim_token = NULL,
           delivery_lease_until = NULL, delivery_claim_token = NULL
       WHERE id = ? AND status = 'sending' AND dispatch_claim_token = ?`,
    ).bind(retryAt, now, errorCode.slice(0, 128), outboxId, claimToken).run();
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async markOutboxDispatched(outboxId: string, now: string) {
    const result = await this.db.prepare(
      `UPDATE ai_email_outbox
       SET status = 'sending', updated_at = ?, dispatch_lease_until = ?, dispatch_claim_token = ?,
           delivery_lease_until = NULL, delivery_claim_token = NULL
       WHERE id = ? AND status IN ('pending', 'failed')`,
    ).bind(now, new Date(Date.parse(now) + EMAIL_CLAIM_TTL_MS).toISOString(), `legacy:${outboxId}:${now}`, outboxId).run();
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async recordOutboxFailure(outboxId: string, now: string, retryAt: string, errorCode = "AI_EMAIL_QUEUE_FAILED") {
    const result = await this.db.prepare(
      `UPDATE ai_email_outbox
       SET status = 'failed', available_at = ?, updated_at = ?, last_error_code = ?,
           dispatch_lease_until = NULL, dispatch_claim_token = NULL,
           delivery_lease_until = NULL, delivery_claim_token = NULL
       WHERE id = ? AND status IN ('pending', 'failed')`,
    ).bind(retryAt, now, errorCode.slice(0, 128), outboxId).run();
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async getById(outboxId: string) {
    return this.db.prepare(
      `SELECT id, action_id, user_id, workspace_id, to_email, subject, body_text,
          status, attempt_count, available_at, sent_at, last_error_code, created_at, updated_at,
          dispatch_lease_until, dispatch_claim_token, delivery_lease_until, delivery_claim_token
       FROM ai_email_outbox
       WHERE id = ? LIMIT 1`,
    ).bind(outboxId).first<AiEmailOutboxRow>();
  }

  async claimForDelivery(outboxId: string, now: string, expectedDispatchClaimToken?: string) {
    const claimExpiresAt = new Date(Date.parse(now) + EMAIL_CLAIM_TTL_MS).toISOString();
    const claimToken = this.createId();
    const dispatchTokenCondition = expectedDispatchClaimToken
      ? "AND dispatch_claim_token = ?"
      : "AND dispatch_claim_token LIKE 'legacy:%'";
    const row = await this.db.prepare(
      `UPDATE ai_email_outbox
       SET status = 'sending', updated_at = ?, attempt_count = attempt_count + 1, sent_at = NULL,
           last_error_code = NULL, dispatch_lease_until = NULL, dispatch_claim_token = NULL,
           delivery_lease_until = ?, delivery_claim_token = ?
       WHERE id = ? AND status = 'sending' AND dispatch_claim_token IS NOT NULL
         ${dispatchTokenCondition} AND dispatch_lease_until > ? AND delivery_claim_token IS NULL
       RETURNING id, action_id, user_id, workspace_id, to_email, subject, body_text,
                 status, attempt_count, available_at, sent_at, last_error_code, created_at, updated_at,
                 dispatch_lease_until, dispatch_claim_token, delivery_lease_until, delivery_claim_token`,
    ).bind(
      now,
      claimExpiresAt,
      claimToken,
      outboxId,
      ...(expectedDispatchClaimToken ? [expectedDispatchClaimToken] : []),
      now,
    ).first<AiEmailOutboxRow>();
    return row;
  }

  async markSent(outboxId: string, claimExpiresAt: string, now: string) {
    const result = await this.db.prepare(
      `UPDATE ai_email_outbox
       SET status = 'sent', sent_at = ?, updated_at = ?, last_error_code = NULL,
           dispatch_lease_until = NULL, dispatch_claim_token = NULL,
           delivery_lease_until = NULL, delivery_claim_token = NULL
       WHERE id = ? AND status = 'sending' AND delivery_claim_token = ?`,
    ).bind(now, now, outboxId, claimExpiresAt).run();
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async markFailed(outboxId: string, claimExpiresAt: string, now: string, retryAt: string, errorCode: string) {
    const result = await this.db.prepare(
      `UPDATE ai_email_outbox
       SET status = 'failed', available_at = ?, updated_at = ?, last_error_code = ?,
           dispatch_lease_until = NULL, dispatch_claim_token = NULL,
           delivery_lease_until = NULL, delivery_claim_token = NULL
       WHERE id = ? AND status = 'sending' AND delivery_claim_token = ?`,
    ).bind(retryAt, now, errorCode.slice(0, 128), outboxId, claimExpiresAt).run();
    return Number(result.meta?.changes ?? 0) > 0;
  }
}
