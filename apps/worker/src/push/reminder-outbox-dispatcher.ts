import type { QueueJob } from "@nexus/contracts";
import { nextOutboxRetryAt } from "../operations/operations-outbox-dispatcher";

interface Repository {
  listPendingOutbox(now: string, limit: number): Promise<Array<{ id: string; message: QueueJob; attempt?: number }>>;
  markOutboxDispatched(outboxId: string, now: string): Promise<void>;
  recordOutboxFailure(outboxId: string, now: string, retryAt: string): Promise<void>;
}

interface Queue {
  send(message: QueueJob): Promise<unknown>;
}

export class ReminderOutboxDispatcher {
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
      try {
        await this.queue.send(row.message);
        await this.repository.markOutboxDispatched(row.id, this.clock().toISOString());
        dispatched += 1;
      } catch {
        const now = this.clock().toISOString();
        await this.repository.recordOutboxFailure(row.id, now, nextOutboxRetryAt(now, row.attempt ?? 0));
        failed += 1;
      }
    }
    return { dispatched, failed };
  }
}
