export interface DatabasePaginationState {
  page: number;
  pageSize: number;
  /** Cursor used to request each 1-based page. Page one always starts at null. */
  cursors: Record<number, string | null>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): unknown;
  removeItem?(key: string): unknown;
}

const PAGINATION_PREFIX = "nexus:database-pagination";

export class DatabasePaginationStore {
  constructor(private readonly storage: StorageLike = localStorage) {}

  read(workspaceId: string, databaseId: string, viewId: string, pageSize?: number): DatabasePaginationState | null {
    try {
      const baseKey = this.key(workspaceId, databaseId, viewId);
      const key = pageSize ? `${baseKey}:${pageSize}` : baseKey;
      const value: unknown = JSON.parse(this.storage.getItem(key) ?? "null");
      if (!value || typeof value !== "object") return null;
      const state = value as Partial<DatabasePaginationState>;
      if (!Number.isInteger(state.page) || state.page! < 1 || !Number.isInteger(state.pageSize) || state.pageSize! < 1) return null;
      const rawCursors = state.cursors;
      if (!rawCursors || typeof rawCursors !== "object") {
        // Read the short-lived pre-beta format without trusting its page-three cursor.
        const legacy = state as Partial<DatabasePaginationState> & { cursor?: unknown };
        if (legacy.cursor !== null && legacy.cursor !== undefined && typeof legacy.cursor !== "string") return null;
        return { page: state.page!, pageSize: state.pageSize!, cursors: { 1: null, [state.page!]: legacy.cursor ?? null } };
      }
      const cursors: Record<number, string | null> = {};
      for (const [page, cursor] of Object.entries(rawCursors)) {
        if (!Number.isInteger(Number(page)) || Number(page) < 1 || (cursor !== null && typeof cursor !== "string")) return null;
        cursors[Number(page)] = cursor as string | null;
      }
      if (cursors[1] !== null || !(state.page! in cursors)) return null;
      return pageSize && state.pageSize !== pageSize ? null : { page: state.page!, pageSize: state.pageSize!, cursors };
    } catch {
      return null;
    }
  }

  write(workspaceId: string, databaseId: string, viewId: string, state: DatabasePaginationState) {
    const baseKey = this.key(workspaceId, databaseId, viewId);
    const indexKey = `${baseKey}:sizes`;
    const previous = JSON.parse(this.storage.getItem(indexKey) ?? "[]") as unknown;
    const sizes = Array.isArray(previous) ? previous.filter((value): value is number => Number.isInteger(value) && value > 0) : [];
    for (const size of sizes) {
      if (size !== state.pageSize) this.storage.removeItem?.(`${baseKey}:${size}`);
    }
    this.storage.setItem(`${baseKey}:${state.pageSize}`, JSON.stringify(state));
    // Keep a compatibility pointer for callers that have not yet resolved a view page size.
    this.storage.setItem(baseKey, JSON.stringify(state));
    this.storage.setItem(indexKey, JSON.stringify([state.pageSize]));
  }

  private key(workspaceId: string, databaseId: string, viewId: string) {
    return `${PAGINATION_PREFIX}:${workspaceId}:${databaseId}:${viewId}`;
  }
}

/** Coordinates optimistic record updates so stale failures cannot undo newer local state. */
export class RecordMutationCoordinator<T extends { id: string }> {
  private readonly tokens = new Map<string, string>();
  private readonly snapshots = new Map<string, T>();
  private current: T[] = [];

  constructor(private readonly publish: (records: T[]) => void) {}

  preview(records: readonly T[], changes: readonly { id: string; next: T }[]) {
    const token = crypto.randomUUID();
    const nextById = new Map(changes.map((change) => [change.id, change.next]));
    for (const change of changes) {
      const current = records.find((record) => record.id === change.id);
      if (current) this.snapshots.set(`${token}:${change.id}`, current);
      this.tokens.set(change.id, token);
    }
    this.current = records.map((record) => nextById.get(record.id) ?? record);
    this.publish(this.current);
    return token;
  }

  rollback(token: string) {
    const restored = [...this.current];
    for (const [key, snapshot] of this.snapshots) {
      if (!key.startsWith(`${token}:`)) continue;
      const id = snapshot.id;
      this.snapshots.delete(key);
      if (this.tokens.get(id) !== token) continue;
      this.tokens.delete(id);
      const index = restored.findIndex((record) => record.id === id);
      if (index >= 0) restored[index] = snapshot;
    }
    this.current = restored;
    this.publish(restored);
    return restored;
  }

  complete(token: string) {
    for (const [key, snapshot] of this.snapshots) {
      if (!key.startsWith(`${token}:`)) continue;
      this.snapshots.delete(key);
      if (this.tokens.get(snapshot.id) === token) this.tokens.delete(snapshot.id);
    }
  }

  pendingCount() { return this.tokens.size; }
}

export async function runOptimisticMutation<TSnapshot, TResult>(options: {
  snapshot(): TSnapshot;
  apply(): void;
  command(): Promise<TResult>;
  restore(snapshot: TSnapshot): void;
  commit?(result: TResult): void;
}) {
  const snapshot = options.snapshot();
  options.apply();
  try {
    const result = await options.command();
    options.commit?.(result);
    return result;
  } catch (error) {
    options.restore(snapshot);
    throw error;
  }
}
