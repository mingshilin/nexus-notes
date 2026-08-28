import type { QueueJob } from "@nexus/contracts";
import { nextOutboxRetryAt } from "../operations/operations-outbox-dispatcher";

interface Repository {
  listPendingOutbox(now: string, limit: number): Promise<Array<{
    id: string;
    action_id: string;
    user_id: string;
    workspace_id: string;
    to_email: string;
    subject: string;
    body_text: string;
    attempt_count: number;
    dispatch_claim_token: string | null;
  }>>;
  claimForDispatch(outboxId: string, now: string): Promise<{
    id: string;
    action_id: string;
    user_id: string;
    workspace_id: string;
    to_email: string;
    subject: string;
    body_text: string;
    status: string;
    attempt_count: number;
    updated_at: string;
    dispatch_claim_token: string | null;
  } | null>;
  releaseDispatch(outboxId: string, claimToken: string, now: string, retryAt: string, errorCode?: string): Promise<boolean>;
}

interface Queue {
  send(message: QueueJob): Promise<unknown>;
}

export class AiEmailOutboxDispatcher {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: Repository,
    private readonly queue: Queue,
    options: { clock?: () => Date } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async dispatch() {
    const rows = await this.repository.listPendingOutbox(this.clock().toISOString(), 50);
    let dispatched = 0;
    let failed = 0;
    for (const row of rows) {
      const claimed = await this.repository.claimForDispatch(row.id, this.clock().toISOString());
      if (!claimed) continue;
      try {
        await this.queue.send({
          job_id: claimed.id,
          kind: "notification",
          idempotency_key: `ai-email:${claimed.action_id}`,
          attempt: claimed.attempt_count + 1,
          deadline: new Date(Date.parse(this.clock().toISOString()) + 15 * 60_000).toISOString(),
          payload: {
            outbox_id: claimed.id,
            action_id: claimed.action_id,
            to_email: claimed.to_email,
            dispatch_claim_token: claimed.dispatch_claim_token,
          },
        });
        dispatched += 1;
      } catch {
        const now = this.clock().toISOString();
        await this.repository.releaseDispatch(claimed.id, claimed.dispatch_claim_token ?? "", now, nextOutboxRetryAt(now, claimed.attempt_count), "AI_EMAIL_QUEUE_FAILED");
        failed += 1;
      }
    }
    return { dispatched, failed };
  }
}
