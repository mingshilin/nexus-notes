import type { PushSubscriptionInput, PushSubscriptionSummary, QueueJob } from "@nexus/contracts";

interface Repository {
  list(userId: string): Promise<PushSubscriptionSummary[]>;
  upsert(userId: string, input: PushSubscriptionInput, requestId: string): Promise<PushSubscriptionSummary>;
  disable(userId: string, subscriptionId: string, requestId: string): Promise<boolean>;
}

interface Queue {
  send(message: QueueJob): Promise<unknown>;
}

export class PushService {
  private readonly clock: () => Date;
  private readonly createId: () => string;

  constructor(
    private readonly repository: Repository,
    private readonly queue: Queue | undefined,
    private readonly vapidPublicKey: string,
    options: { clock?: () => Date; createId?: () => string } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  list(userId: string) {
    return this.repository.list(userId);
  }

  subscribe(userId: string, input: PushSubscriptionInput, requestId: string) {
    return this.repository.upsert(userId, input, requestId);
  }

  disable(userId: string, subscriptionId: string, requestId: string) {
    return this.repository.disable(userId, subscriptionId, requestId);
  }

  publicKey() {
    if (!this.vapidPublicKey) throw Object.assign(new Error("Web Push is not configured"), {
      code: "PUSH_NOT_CONFIGURED", status: 503, retryable: false,
    });
    return this.vapidPublicKey;
  }

  async sendTest(userId: string, requestId: string) {
    if (!this.queue) throw Object.assign(new Error("Notification queue is unavailable"), {
      code: "PUSH_QUEUE_UNAVAILABLE", status: 503, retryable: true,
    });
    const id = this.createId();
    const now = this.clock();
    await this.queue.send({
      job_id: id,
      kind: "notification",
      idempotency_key: `push-test:${userId}:${id}`,
      attempt: 1,
      deadline: new Date(now.getTime() + 15 * 60_000).toISOString(),
      payload: { test: true, user_id: userId, request_id: requestId },
    });
    return { queued: 1 };
  }
}
