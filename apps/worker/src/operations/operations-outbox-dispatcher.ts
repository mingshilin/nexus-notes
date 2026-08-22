import type { QueueJob } from "@nexus/contracts";

export interface OperationsOutboxRepository {
  listPendingOutbox(now: string, limit: number): Promise<Array<{ id: string; message: QueueJob }>>;
  markOutboxDispatched(outboxId: string, now: string): Promise<void>;
  recordOutboxFailure(outboxId: string, now: string): Promise<void>;
}

interface OperationsQueue {
  send(message: QueueJob): Promise<unknown>;
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
        await this.repository.recordOutboxFailure(row.id, this.clock().toISOString());
        failed += 1;
        continue;
      }
      await this.repository.markOutboxDispatched(row.id, this.clock().toISOString());
      dispatched += 1;
    }
    return { dispatched, failed };
  }
}
