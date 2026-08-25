import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "./api-client";
import { createHttpSyncTransport } from "./http-sync-transport";
import { SyncEngine, type SyncChange, type SyncOperationResult, type SyncStore } from "./sync-engine";
import type { SyncOperation } from "@nexus/contracts";

export type WorkspaceSyncStatus = "idle" | "syncing" | "synced" | "error";

export interface WorkspaceSyncOptions {
  apiClient: ApiClient;
  store: unknown;
  workspaceId?: string;
  enabled?: boolean;
  applyChange?(change: SyncChange): Promise<void>;
  onConflict?(operation: SyncOperation, result: SyncOperationResult): void;
}

export interface WorkspaceSyncState {
  status: WorkspaceSyncStatus;
  error: unknown | null;
  lastResult: Awaited<ReturnType<SyncEngine["sync"]>> | null;
  retry(): void;
}

function syncStore(value: unknown): SyncStore | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SyncStore>;
  if (typeof candidate.listOperations !== "function"
    || typeof candidate.removeOperation !== "function"
    || typeof candidate.getSyncCursor !== "function"
    || typeof candidate.setSyncCursor !== "function") return null;
  return candidate as SyncStore;
}

export function useWorkspaceSync({
  apiClient,
  store,
  workspaceId,
  enabled = true,
  applyChange = async () => undefined,
  onConflict = () => undefined,
}: WorkspaceSyncOptions): WorkspaceSyncState {
  const [status, setStatus] = useState<WorkspaceSyncStatus>(workspaceId && enabled ? "syncing" : "idle");
  const [error, setError] = useState<unknown | null>(null);
  const [lastResult, setLastResult] = useState<WorkspaceSyncState["lastResult"]>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const runRef = useRef<(() => Promise<void>) | null>(null);

  const retry = useCallback(() => setRetryVersion((version) => version + 1), []);

  useEffect(() => {
    const availableStore = syncStore(store);
    if (!enabled || !workspaceId || !availableStore) {
      setStatus("idle");
      setError(null);
      setLastResult(null);
      runRef.current = null;
      return undefined;
    }

    let cancelled = false;
    let inFlight: Promise<void> | null = null;
    const engine = new SyncEngine({
      store: availableStore,
      transport: createHttpSyncTransport(apiClient),
      applyChange,
      onConflict,
    });
    const run = async () => {
      if (inFlight) return inFlight;
      setStatus("syncing");
      setError(null);
      inFlight = engine.sync(workspaceId).then((result) => {
        if (cancelled) return;
        setLastResult(result);
        setStatus("synced");
      }).catch((syncError: unknown) => {
        if (cancelled) return;
        setError(syncError);
        setStatus("error");
      }).finally(() => {
        inFlight = null;
      });
      return inFlight;
    };
    runRef.current = run;
    void run();
    const onOnline = () => { void run(); };
    window.addEventListener("online", onOnline);
    const interval = window.setInterval(() => { void run(); }, 30_000);
    return () => {
      cancelled = true;
      if (runRef.current === run) runRef.current = null;
      window.removeEventListener("online", onOnline);
      window.clearInterval(interval);
    };
  }, [apiClient, applyChange, enabled, onConflict, retryVersion, store, workspaceId]);

  return { status, error, lastResult, retry };
}
