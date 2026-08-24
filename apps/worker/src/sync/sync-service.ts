import type {
  SyncOperation,
  SyncOperationResult,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  WorkspaceContext,
} from "@nexus/contracts";

export interface SyncRepository {
  getProcessed(workspaceId: string, operationId: string): Promise<SyncOperationResult | null>;
  apply(context: WorkspaceContext, operation: SyncOperation): Promise<SyncOperationResult>;
  recordProcessed(workspaceId: string, operation: SyncOperation, result: SyncOperationResult): Promise<void>;
  latestCursor(workspaceId: string): Promise<string | null>;
  pull(context: WorkspaceContext, cursor: string | null): Promise<SyncPullResponse>;
}

export class SyncService {
  constructor(private readonly repository: SyncRepository) {}

  async push(context: WorkspaceContext, request: SyncPushRequest): Promise<SyncPushResponse> {
    const results: SyncOperationResult[] = [];
    for (const operation of request.operations) {
      if (operation.workspace_id !== context.workspaceId) {
        results.push({
          operation_id: operation.operation_id,
          status: "rejected",
          error: "WORKSPACE_MISMATCH",
        });
        continue;
      }

      const processed = await this.repository.getProcessed(context.workspaceId, operation.operation_id);
      if (processed) {
        results.push({ ...processed, status: "duplicate" });
        continue;
      }

      const result = await this.repository.apply(context, operation);
      if (result.status !== "conflict") {
        await this.repository.recordProcessed(context.workspaceId, operation, result);
      }
      results.push(result);
    }
    return { operations: results, next_cursor: await this.repository.latestCursor(context.workspaceId) };
  }

  pull(context: WorkspaceContext, cursor: string | null) {
    return this.repository.pull(context, cursor);
  }
}
