import type { SyncOperation } from "@nexus/contracts";
import type { BetaLocalStore } from "./local-store";

export interface SyncOperationResult {
  operation_id: string;
  status: "applied" | "duplicate" | "conflict" | "rejected";
  revision?: number;
  error?: string;
}

export interface SyncPushResult {
  operations: SyncOperationResult[];
  next_cursor: string | null;
}

export interface SyncChange {
  cursor: string;
  entity_type: string;
  entity_id: string;
  revision: number;
  kind: "create" | "update" | "delete";
  payload: Record<string, unknown>;
}

export interface SyncPullResult {
  changes: SyncChange[];
  next_cursor: string | null;
}

export interface SyncTransport {
  push(workspaceId: string, operations: SyncOperation[]): Promise<SyncPushResult>;
  pull(workspaceId: string, cursor: string | null): Promise<SyncPullResult>;
}

export interface SyncEngineOptions {
  store: Pick<BetaLocalStore, "listOperations" | "removeOperation" | "getSyncCursor" | "setSyncCursor">;
  transport: SyncTransport;
  applyChange(change: SyncChange): Promise<void>;
  onConflict(operation: SyncOperation, result: SyncOperationResult): void;
}

export class SyncEngine {
  private readonly options: SyncEngineOptions;

  constructor(options: SyncEngineOptions) {
    this.options = options;
  }

  async sync(workspaceId: string) {
    const operations = (await this.options.store.listOperations(workspaceId)).slice(0, 100);
    let applied = 0;
    let conflicts = 0;
    let pushCursor: string | null = null;

    if (operations.length > 0) {
      const push = await this.options.transport.push(workspaceId, operations);
      pushCursor = push.next_cursor;
      const byId = new Map(operations.map((operation) => [operation.operation_id, operation]));
      for (const result of push.operations) {
        const operation = byId.get(result.operation_id);
        if (!operation) continue;
        if (result.status === "applied" || result.status === "duplicate") {
          await this.options.store.removeOperation(result.operation_id);
          applied += 1;
        } else if (result.status === "conflict") {
          conflicts += 1;
          this.options.onConflict(operation, result);
        }
      }
    }

    const cursor = await this.options.store.getSyncCursor(workspaceId);
    const pull = await this.options.transport.pull(workspaceId, cursor);
    for (const change of pull.changes) {
      await this.options.applyChange(change);
    }
    const nextCursor = pull.next_cursor ?? pushCursor;
    if (nextCursor) await this.options.store.setSyncCursor(workspaceId, nextCursor);

    return {
      pushed: operations.length,
      applied,
      conflicts,
      pulled: pull.changes.length,
    };
  }
}
