import type { QueueJob } from "@nexus/contracts";

export interface OperationsOutboxRepository {
  listPendingOutbox(now: string, limit: number): Promise<Array<{ id: string; message: QueueJob; attempt?: number }>>;
  markOutboxDispatched(outboxId: string, now: string): Promise<void>;
  recordOutboxFailure(outboxId: string, now: string, retryAt: string): Promise<void>;
}

interface OperationsQueue {
  send(message: QueueJob): Promise<unknown>;
}

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 300_000, 900_000] as const;

export function nextOutboxRetryAt(now: string, attempt: number) {
  const delay = RETRY_DELAYS_MS[Math.min(Math.max(Math.floor(attempt), 0), RETRY_DELAYS_MS.length - 1)]!;
  return new Date(Date.parse(now) + delay).toISOString();
}

export class OperationsOutboxDispatcher {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: OperationsOutboxRepository,
    private readonly queue: OperationsQueue,
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
      } catch {
        const now = this.clock().toISOString();
        await this.repository.recordOutboxFailure(row.id, now, nextOutboxRetryAt(now, row.attempt ?? 0));
        failed += 1;
        continue;
      }
      await this.repository.markOutboxDispatched(row.id, this.clock().toISOString());
      dispatched += 1;
    }
    return { dispatched, failed };
  }
}
