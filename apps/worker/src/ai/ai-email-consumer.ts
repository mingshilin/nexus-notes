import { QueueJobSchema, type QueueJob } from "@nexus/contracts";
import type { AiEmailOutboxRepository } from "./ai-email-outbox-repository";

interface EmailSender {
  send(input: { to: string; subject: string; text: string }): Promise<void>;
}

const MAX_EMAIL_DELIVERY_ATTEMPTS = 5;

export interface AiEmailConsumerOutcome {
  outcome: "ack";
}

type RetryAiEmailConsumerOutcome = {
  outcome: "retry";
  delaySeconds: number;
};

function bodyOf(message: unknown) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return message;
  return "body" in message ? (message as { body: unknown }).body : message;
}

function retryDelaySeconds(attempt: number) {
  return Math.min(900, 30 * 2 ** Math.max(0, attempt - 1));
}

function statusCodeOf(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const status = /status (\d{3})/iu.exec(message)?.[1];
  return status ? Number(status) : null;
}

function classifyFailure(error: unknown): { retryable: boolean; code: string } {
  const message = error instanceof Error ? error.message : "";
  if (/not configured|invalid/i.test(message)) {
    return { retryable: false, code: "AI_EMAIL_CONFIGURATION_INVALID" };
  }
  const status = statusCodeOf(error);
  if (status === 408 || status === 429 || (status !== null && status >= 500)) {
    return { retryable: true, code: "AI_EMAIL_RETRYABLE_FAILURE" };
  }
  if (status !== null) {
    return { retryable: false, code: "AI_EMAIL_PERMANENT_FAILURE" };
  }
  return { retryable: true, code: "AI_EMAIL_RETRYABLE_FAILURE" };
}

export class AiEmailConsumer {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: Pick<AiEmailOutboxRepository, "getById" | "claimForDelivery" | "markSent" | "markFailed">,
    private readonly sender: EmailSender,
    options: { clock?: () => Date } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async consume(message: unknown): Promise<AiEmailConsumerOutcome | RetryAiEmailConsumerOutcome> {
    const parsed = QueueJobSchema.safeParse(bodyOf(message));
    if (!parsed.success || parsed.data.kind !== "notification") return { outcome: "ack" };
    const payload = parsed.data.payload as Record<string, unknown>;
    const outboxId = typeof payload.outbox_id === "string" ? payload.outbox_id : null;
    const toEmail = typeof payload.to_email === "string" ? payload.to_email : null;
    const dispatchClaimToken = typeof payload.dispatch_claim_token === "string"
      ? payload.dispatch_claim_token
      : undefined;
    if (!outboxId) return { outcome: "ack" };

    const now = this.clock().toISOString();
    const row = await this.repository.claimForDelivery(outboxId, now, dispatchClaimToken);
    if (!row || row.status === "sent" || row.status === "cancelled") return { outcome: "ack" };
    const claimToken = row.delivery_claim_token ?? row.updated_at;
    if (toEmail && toEmail !== row.to_email) {
      await this.repository.markFailed(outboxId, claimToken, now, now, "AI_EMAIL_RECIPIENT_MISMATCH");
      return { outcome: "ack" };
    }

    try {
      await this.sender.send({
        to: row.to_email,
        subject: row.subject,
        text: row.body_text,
      });
      await this.repository.markSent(row.id, claimToken, now);
      return { outcome: "ack" };
    } catch (error) {
      const failure = classifyFailure(error);
      const delaySeconds = retryDelaySeconds(row.attempt_count);
      const exhausted = row.attempt_count >= MAX_EMAIL_DELIVERY_ATTEMPTS;
      const retryableFailure = failure.retryable && !exhausted;
      await this.repository.markFailed(
        row.id,
        claimToken,
        now,
        retryableFailure ? new Date(Date.parse(now) + delaySeconds * 1000).toISOString() : now,
        exhausted ? "AI_EMAIL_RETRY_LIMIT_REACHED" : failure.code,
      );
      return retryableFailure ? { outcome: "retry", delaySeconds } : { outcome: "ack" };
    }
  }
}
