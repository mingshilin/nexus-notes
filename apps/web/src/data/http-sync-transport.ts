import type { SyncOperation } from "@nexus/contracts";
import type { ApiClient } from "./api-client";
import type { SyncPullResult, SyncPushResult, SyncTransport } from "./sync-engine";

export function createHttpSyncTransport(client: ApiClient): SyncTransport {
  return {
    push(workspaceId: string, operations: SyncOperation[]) {
      return client.request<SyncPushResult>({
        path: "/api/v2/sync/push",
        method: "POST",
        body: { operations },
        headers: { "x-workspace-id": workspaceId },
        requestClass: "idempotent-command",
        policy: {
          timeoutMs: 15_000,
          retry: 1,
          idempotencyKey: operations.map((operation) => operation.operation_id).join(":"),
        },
      });
    },
    pull(workspaceId: string, cursor: string | null) {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      return client.request<SyncPullResult>({
        path: `/api/v2/sync/pull${query}`,
        headers: { "x-workspace-id": workspaceId },
        requestClass: "query",
        policy: {
          timeoutMs: 10_000,
          retry: 2,
          dedupeKey: `sync-pull:${workspaceId}:${cursor ?? "initial"}`,
        },
      });
    },
  };
}
