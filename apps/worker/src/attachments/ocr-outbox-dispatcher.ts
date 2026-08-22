import type { QueueJob } from "@nexus/contracts";

export interface OcrOutboxRepository {
  listPendingOcrOutbox(now: string, limit: number, ids?: string[]): Promise<Array<{ id: string; message: QueueJob }>>;
  markOcrOutboxDispatched(outboxId: string, now: string): Promise<void>;
  recordOcrOutboxFailure(outboxId: string, now: string): Promise<void>;
}

interface OcrQueue {
  send(message: QueueJob): Promise<unknown>;
}

export class OcrOutboxDispatcher {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: OcrOutboxRepository,
    private readonly queue: OcrQueue,
    options: { clock?: () => Date } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async dispatch(ids?: string[]) {
    if (ids?.length === 0) return { dispatched: 0, failed: 0 };
    const rows = await this.repository.listPendingOcrOutbox(this.clock().toISOString(), 50, ids);
    let dispatched = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await this.queue.send(row.message);
      } catch {
        await this.repository.recordOcrOutboxFailure(row.id, this.clock().toISOString());
        failed += 1;
        continue;
      }
      await this.repository.markOcrOutboxDispatched(row.id, this.clock().toISOString());
      dispatched += 1;
    }
    return { dispatched, failed };
  }
}
