import type { Note, UpdateNoteInput } from "@nexus/contracts";
import type { LocalDraft } from "../data/local-store";

export interface NoteDraftStore {
  saveDraft(draft: LocalDraft): Promise<void>;
  getDraft(workspaceId: string, entityId: string): Promise<LocalDraft | null>;
  listDrafts(workspaceId: string): Promise<LocalDraft[]>;
  removeDraft(workspaceId: string, entityId: string): Promise<void>;
}

export interface DraftServerClient {
  create(input: { title: string; content: string }, options?: { idempotencyKey?: string }): Promise<Note>;
  update(noteId: string, input: UpdateNoteInput, options?: { idempotencyKey?: string }): Promise<Note>;
}

export interface NoteDraftControllerOptions {
  createId?: () => string;
  clock?: () => Date;
}

interface DraftLifecycle {
  queue: Promise<void>;
  idle: boolean;
  generation: number;
  tombstoned: boolean;
  reconcilePromise?: Promise<void>;
  reconcileFailed: boolean;
  syncPromise?: Promise<Note>;
}

export class NoteDraftController {
  private readonly createId: () => string;
  private readonly clock: () => Date;
  private readonly lifecycles = new Map<string, DraftLifecycle>();

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
    const saved = await this.saveDraft(draft);
    if (!saved) throw new Error("Draft was tombstoned before creation completed");
    return saved;
  }

  async recover(workspaceId: string): Promise<LocalDraft | null> {
    await this.flush(workspaceId);
    const drafts = await this.store.listDrafts(workspaceId);
    return drafts[0] ?? null;
  }

  save(workspaceId: string, entityId: string, title: string, content: string) {
    const key = this.key(workspaceId, entityId);
    const lifecycle = this.lifecycle(key);
    if (lifecycle.tombstoned) return Promise.resolve(null);
    lifecycle.generation += 1;
    return this.enqueue(key, async () => {
      const current = await this.store.getDraft(workspaceId, entityId);
      const draft: LocalDraft = {
        ...(current ?? { workspace_id: workspaceId, entity_id: entityId }),
        workspace_id: workspaceId,
        entity_id: entityId,
        title,
        content,
        updated_at: this.clock().toISOString(),
      };
      await this.store.saveDraft(draft);
      return draft;
    });
  }

  async sync(workspaceId: string, entityId: string, client: DraftServerClient): Promise<Note> {
    const key = this.key(workspaceId, entityId);
    const lifecycle = this.lifecycle(key);
    if (lifecycle.syncPromise) return lifecycle.syncPromise;
    const promise = this.syncDraft(workspaceId, entityId, client).finally(() => {
      if (lifecycle.syncPromise === promise) lifecycle.syncPromise = undefined;
    });
    lifecycle.syncPromise = promise;
    return promise;
  }

  async reconcile(workspaceId: string, entityId: string): Promise<void> {
    const key = this.key(workspaceId, entityId);
    const lifecycle = this.lifecycle(key);
    if (lifecycle.reconcilePromise && !lifecycle.reconcileFailed) return lifecycle.reconcilePromise;
    lifecycle.tombstoned = true;
    const prior = lifecycle.queue;
    const removal = prior.then(() => this.store.removeDraft(workspaceId, entityId));
    lifecycle.reconcilePromise = removal.then(() => undefined, (error) => {
      lifecycle.reconcileFailed = true;
      throw error;
    });
    lifecycle.reconcileFailed = false;
    lifecycle.queue = lifecycle.reconcilePromise.then(() => undefined, () => undefined);
    return lifecycle.reconcilePromise;
  }

  async flush(workspaceId?: string, entityId?: string) {
    const entries = [...this.lifecycles.entries()]
      .filter(([key]) => !workspaceId
        || (entityId !== undefined ? key === this.key(workspaceId, entityId) : key.startsWith(`${workspaceId}:`)));
    await Promise.all(entries.map(([, lifecycle]) => lifecycle.queue));
  }

  private async syncDraft(workspaceId: string, entityId: string, client: DraftServerClient): Promise<Note> {
    const lifecycle = this.lifecycle(this.key(workspaceId, entityId));
    let draft = await this.store.getDraft(workspaceId, entityId);
    if (!draft) throw new Error("Draft was not found");

    if (lifecycle.tombstoned) {
      await this.reconcile(workspaceId, entityId);
      return this.noteFromDraft(draft);
    }

    let serverNote: Note;
    if (draft.server_note_id) {
      serverNote = this.noteFromDraft(draft);
    } else {
      if (draft.server_create_title === undefined || draft.server_create_content === undefined) {
        await this.persistServerState(workspaceId, entityId, {
          server_create_title: draft.title,
          server_create_content: draft.content,
        });
        draft = await this.store.getDraft(workspaceId, entityId);
        if (!draft) throw new Error("Draft disappeared before server creation");
      }
      serverNote = await client.create(
        { title: draft.server_create_title ?? draft.title, content: draft.server_create_content ?? draft.content },
        { idempotencyKey: entityId },
      );
      await this.persistServerState(workspaceId, entityId, {
        server_note_id: serverNote.id,
        server_revision: serverNote.revision,
        server_updated_at: serverNote.updated_at,
        server_create_title: undefined,
        server_create_content: undefined,
      });
      draft = await this.store.getDraft(workspaceId, entityId);
      if (!draft) throw new Error("Draft disappeared after server creation");
    }

    for (;;) {
      await this.flush(workspaceId, entityId);
      draft = await this.store.getDraft(workspaceId, entityId);
      if (!draft) throw new Error("Draft disappeared during server sync");

      if (serverNote.title !== draft.title || serverNote.content !== draft.content || draft.server_update_key) {
        const generation = lifecycle.generation;
        const idempotencyKey = draft.server_update_key ?? `${entityId}:update:${generation}`;
        const updateTitle = draft.server_update_title ?? draft.title;
        const updateContent = draft.server_update_content ?? draft.content;
        const baseRevision = draft.server_update_base_revision ?? serverNote.revision;
        if (!draft.server_update_key) {
          await this.persistServerState(workspaceId, entityId, {
            server_update_key: idempotencyKey,
            server_update_generation: generation,
            server_update_title: updateTitle,
            server_update_content: updateContent,
            server_update_base_revision: baseRevision,
          });
        }
        serverNote = await client.update(
          serverNote.id,
          {
            base_revision: baseRevision,
            title: updateTitle,
            content: updateContent,
            source: "manual",
          },
          { idempotencyKey },
        );
        await this.persistServerState(workspaceId, entityId, {
          server_note_id: serverNote.id,
          server_revision: serverNote.revision,
          server_updated_at: serverNote.updated_at,
          server_update_key: undefined,
          server_update_generation: undefined,
          server_update_title: undefined,
          server_update_content: undefined,
          server_update_base_revision: undefined,
        });
        continue;
      }

      const generation = lifecycle.generation;
      if (generation !== lifecycle.generation || lifecycle.tombstoned) continue;
      await this.reconcile(workspaceId, entityId);
      return serverNote;
    }
  }

  private async persistServerState(workspaceId: string, entityId: string, patch: Partial<LocalDraft>) {
    return this.enqueue(this.key(workspaceId, entityId), async () => {
      const current = await this.store.getDraft(workspaceId, entityId);
      if (!current) throw new Error("Draft disappeared before server state persistence");
      const next = { ...current, ...patch };
      await this.store.saveDraft(next);
      return next;
    });
  }

  private saveDraft(draft: LocalDraft) {
    const key = this.key(draft.workspace_id, draft.entity_id);
    const lifecycle = this.lifecycle(key);
    if (lifecycle.tombstoned) return Promise.resolve(null);
    return this.enqueue(key, async () => {
      await this.store.saveDraft(draft);
      return draft;
    });
  }

  private enqueue<T>(key: string, operation: () => Promise<T>) {
    const lifecycle = this.lifecycle(key);
    if (lifecycle.tombstoned) return Promise.resolve(null as T | null);
    const wasIdle = lifecycle.idle;
    lifecycle.idle = false;
    const run = wasIdle ? operation() : lifecycle.queue.then(() => {
      if (lifecycle.tombstoned) return null as T | null;
      return operation();
    });
    lifecycle.queue = Promise.resolve(run).then(() => { lifecycle.idle = true; }, () => { lifecycle.idle = true; });
    return run;
  }

  private lifecycle(key: string) {
    const existing = this.lifecycles.get(key);
    if (existing) return existing;
    const lifecycle: DraftLifecycle = {
      queue: Promise.resolve(),
      idle: true,
      generation: 0,
      tombstoned: false,
      reconcileFailed: false,
    };
    this.lifecycles.set(key, lifecycle);
    return lifecycle;
  }

  private noteFromDraft(draft: LocalDraft): Note {
    return {
      id: draft.server_note_id ?? "",
      workspace_id: draft.workspace_id,
      folder_id: null,
      database_id: null,
      created_by: "",
      updated_by: "",
      title: draft.title,
      content: draft.content,
      status: "active",
      is_favorite: false,
      is_pinned: false,
      daily_date: null,
      revision: draft.server_revision ?? 0,
      created_at: draft.updated_at,
      updated_at: draft.server_updated_at ?? draft.updated_at,
    };
  }

  private key(workspaceId: string, entityId: string) {
    return `${workspaceId}:${entityId}`;
  }
}
