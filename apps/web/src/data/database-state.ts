export interface DatabasePaginationState {
  page: number;
  pageSize: number;
  /** Cursor used to request each 1-based page. Page one always starts at null. */
  cursors: Record<number, string | null>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): unknown;
}

const PAGINATION_PREFIX = "nexus:database-pagination";

export class DatabasePaginationStore {
  constructor(private readonly storage: StorageLike = localStorage) {}

  read(workspaceId: string, databaseId: string, viewId: string): DatabasePaginationState | null {
    try {
      const value: unknown = JSON.parse(this.storage.getItem(this.key(workspaceId, databaseId, viewId)) ?? "null");
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
      return { page: state.page!, pageSize: state.pageSize!, cursors };
    } catch {
      return null;
    }
  }

  write(workspaceId: string, databaseId: string, viewId: string, state: DatabasePaginationState) {
    this.storage.setItem(this.key(workspaceId, databaseId, viewId), JSON.stringify(state));
  }

  private key(workspaceId: string, databaseId: string, viewId: string) {
    return `${PAGINATION_PREFIX}:${workspaceId}:${databaseId}:${viewId}`;
  }
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
