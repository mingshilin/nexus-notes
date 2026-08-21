export interface DatabasePaginationState {
  page: number;
  pageSize: number;
  cursor: string | null;
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
      if (state.cursor !== null && typeof state.cursor !== "string") return null;
      return { page: state.page!, pageSize: state.pageSize!, cursor: state.cursor ?? null };
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
