interface EntityRecord<T> {
  data: T;
  revision: number;
  fetchedAt: number;
}

export interface EntityWrite<T> {
  workspaceId: string;
  type: string;
  id: string;
  revision: number;
  data: T;
}

export interface EntityRead<T> {
  data: T;
  revision: number;
  stale: boolean;
}

export class NormalizedCache {
  private readonly clock: () => number;
  private readonly entities = new Map<string, EntityRecord<unknown>>();

  constructor(options: { clock?: () => number } = {}) {
    this.clock = options.clock ?? Date.now;
  }

  writeEntity<T>(input: EntityWrite<T>) {
    const key = this.key(input.workspaceId, input.type, input.id);
    const current = this.entities.get(key);
    if (current && current.revision > input.revision) return;
    this.entities.set(key, {
      data: input.data,
      revision: input.revision,
      fetchedAt: this.clock(),
    });
  }

  readEntity<T>(workspaceId: string, type: string, id: string, maxAgeMs: number): EntityRead<T> | null {
    const record = this.entities.get(this.key(workspaceId, type, id));
    if (!record) return null;
    return {
      data: record.data as T,
      revision: record.revision,
      stale: this.clock() - record.fetchedAt > maxAgeMs,
    };
  }

  removeEntity(workspaceId: string, type: string, id: string) {
    this.entities.delete(this.key(workspaceId, type, id));
  }

  clearWorkspace(workspaceId: string) {
    const prefix = `${workspaceId}:`;
    for (const key of this.entities.keys()) {
      if (key.startsWith(prefix)) this.entities.delete(key);
    }
  }

  private key(workspaceId: string, type: string, id: string) {
    return `${workspaceId}:${type}:${id}`;
  }
}
