import type { LocalDraft } from "../data/local-store";

export interface NoteDraftStore {
  saveDraft(draft: LocalDraft): Promise<void>;
  listDrafts(workspaceId: string): Promise<LocalDraft[]>;
  removeDraft(workspaceId: string, entityId: string): Promise<void>;
}

export interface NoteDraftControllerOptions {
  createId?: () => string;
  clock?: () => Date;
}

export class NoteDraftController {
  private readonly createId: () => string;
  private readonly clock: () => Date;
  private readonly pendingWrites = new Map<string, Promise<void>>();

  constructor(
    private readonly store: NoteDraftStore,
    options: NoteDraftControllerOptions = {},
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.clock = options.clock ?? (() => new Date());
  }

  async create(workspaceId: string): Promise<LocalDraft> {
    const draft: LocalDraft = {
      workspace_id: workspaceId,
      entity_id: this.createId(),
      title: "",
      content: "",
      updated_at: this.clock().toISOString(),
    };
    await this.saveDraft(draft);
    return draft;
  }

  async recover(workspaceId: string): Promise<LocalDraft | null> {
    await this.flush(workspaceId);
    const drafts = await this.store.listDrafts(workspaceId);
    return drafts[0] ?? null;
  }

  save(workspaceId: string, entityId: string, title: string, content: string) {
    return this.saveDraft({
      workspace_id: workspaceId,
      entity_id: entityId,
      title,
      content,
      updated_at: this.clock().toISOString(),
    });
  }

  async reconcile(workspaceId: string, entityId: string) {
    await this.flush(workspaceId, entityId);
    await this.store.removeDraft(workspaceId, entityId);
  }

  async flush(workspaceId?: string, entityId?: string) {
    const pending = [...this.pendingWrites.entries()]
      .filter(([key]) => !workspaceId || key === this.key(workspaceId, entityId) || key.startsWith(`${workspaceId}:`))
      .map(([, write]) => write);
    await Promise.all(pending);
  }

  private saveDraft(draft: LocalDraft) {
    const key = this.key(draft.workspace_id, draft.entity_id);
    const previous = this.pendingWrites.get(key);
    const write = previous
      ? previous.catch(() => undefined).then(() => this.store.saveDraft(draft))
      : this.store.saveDraft(draft);
    let tracked!: Promise<void>;
    tracked = write.finally(() => {
      if (this.pendingWrites.get(key) === tracked) this.pendingWrites.delete(key);
    });
    this.pendingWrites.set(key, tracked);
    return tracked.then(() => draft);
  }

  private key(workspaceId: string, entityId = "") {
    return `${workspaceId}:${entityId}`;
  }
}
