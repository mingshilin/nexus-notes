import type { Note, UpdateNoteInput } from "@nexus/contracts";
import type { LocalDraft, PendingPatch } from "../data/local-store";

export interface NoteDraftStore {
  saveDraft(draft: LocalDraft): Promise<void>;
  getDraft(workspaceId: string, entityId: string): Promise<LocalDraft | null>;
  listDrafts(workspaceId: string): Promise<LocalDraft[]>;
  removeDraft(workspaceId: string, entityId: string): Promise<void>;
}

export interface DraftServerClient {
  create(input: { title: string; content: string }, options?: { idempotencyKey?: string }): Promise<Note>;
  get?(noteId: string): Promise<Note>;
  update(noteId: string, input: UpdateNoteInput, options?: { idempotencyKey?: string }): Promise<Note>;
}

export interface NoteDraftControllerOptions {
  createId?: () => string;
  clock?: () => Date;
}

export interface DraftSyncResult extends Note {
  note: Note;
  draft: LocalDraft;
  localDraft: LocalDraft;
  generation: number;
  localGeneration: number;
}

export interface DraftReconcileExpectation {
  generation: number;
  serverNoteId?: string;
  serverRevision?: number;
}

interface DraftLifecycle {
  tail: Promise<void>;
  tombstoned: boolean;
  reconcilePromise?: Promise<boolean>;
  syncPromise?: Promise<DraftSyncResult>;
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
      draft_generation: 0,
      next_patch_generation: 1,
    };
    const saved = await this.enqueue(this.key(workspaceId, draft.entity_id), () => this.store.saveDraft(draft).then(() => draft));
    if (!saved) throw new Error("Draft was tombstoned before creation completed");
    return saved;
  }

  async recover(workspaceId: string): Promise<LocalDraft | null> {
    await this.flush(workspaceId);
    const drafts = await this.store.listDrafts(workspaceId);
    return drafts[0] ?? null;
  }

  save(workspaceId: string, entityId: string, title: string, content: string) {
    return this.enqueue(this.key(workspaceId, entityId), async () => {
      const current = await this.store.getDraft(workspaceId, entityId);
      const updatedAt = this.clock().toISOString();
      const base = current ?? {
        workspace_id: workspaceId,
        entity_id: entityId,
        title: "",
        content: "",
        updated_at: updatedAt,
      };
      const draft: LocalDraft = {
        ...base,
        title,
        content,
        updated_at: updatedAt,
        draft_generation: (current?.draft_generation ?? 0) + 1,
      };
      await this.store.saveDraft(draft);
      return draft;
    });
  }

  async sync(workspaceId: string, entityId: string, client: DraftServerClient): Promise<DraftSyncResult> {
    const key = this.key(workspaceId, entityId);
    const lifecycle = this.lifecycle(key);
    if (lifecycle.syncPromise) return lifecycle.syncPromise;
    const promise = this.syncDraft(workspaceId, entityId, client).finally(() => {
      if (lifecycle.syncPromise === promise) lifecycle.syncPromise = undefined;
    });
    lifecycle.syncPromise = promise;
    return promise;
  }

  async reconcile(
    workspaceId: string,
    entityId: string,
    expected?: DraftReconcileExpectation | DraftSyncResult,
  ): Promise<boolean> {
    const key = this.key(workspaceId, entityId);
    const lifecycle = this.lifecycle(key);
    if (lifecycle.reconcilePromise) return lifecycle.reconcilePromise;
    const expectation = expected ? this.expectation(expected) : undefined;

    // Tombstone synchronously, before taking the current tail snapshot.
    lifecycle.tombstoned = true;
    const prior = lifecycle.tail;
    const run = prior.then(async () => {
      const current = await this.store.getDraft(workspaceId, entityId);
      if (!current) {
        if (expectation) {
          lifecycle.tombstoned = false;
          return false;
        }
        await this.store.removeDraft(workspaceId, entityId);
        return true;
      }
      if (expectation && !this.matches(current, expectation)) {
        lifecycle.tombstoned = false;
        return false;
      }
      await this.store.removeDraft(workspaceId, entityId);
      return true;
    });
    const tracked = run.then(
      (result) => {
        if (lifecycle.reconcilePromise === tracked) lifecycle.reconcilePromise = undefined;
        if (!result) lifecycle.tombstoned = false;
        return result;
      },
      (error) => {
        if (lifecycle.reconcilePromise === tracked) lifecycle.reconcilePromise = undefined;
        lifecycle.tombstoned = false;
        throw error;
      },
    );
    lifecycle.reconcilePromise = tracked;
    lifecycle.tail = tracked.then(() => undefined, () => undefined);
    return tracked;
  }

  async flush(workspaceId?: string, entityId?: string) {
    const entries = [...this.lifecycles.entries()]
      .filter(([key]) => !workspaceId
        || (entityId !== undefined ? key === this.key(workspaceId, entityId) : key.startsWith(`${workspaceId}:`)));
    await Promise.all(entries.map(([, lifecycle]) => lifecycle.tail));
  }

  private async syncDraft(workspaceId: string, entityId: string, client: DraftServerClient): Promise<DraftSyncResult> {
    const lifecycle = this.lifecycle(this.key(workspaceId, entityId));
    let draft = await this.store.getDraft(workspaceId, entityId);
    if (!draft) throw new Error("Draft was not found");
    let serverNote = draft.server_note;

    if (!serverNote) {
      if (draft.server_note_id) {
        if (!client.get) throw new Error("Server snapshot is missing; local draft remains recoverable");
        serverNote = await client.get(draft.server_note_id);
        const hydrated = await this.persistState(workspaceId, entityId, {
          server_note: serverNote,
          server_note_id: serverNote.id,
          server_revision: serverNote.revision,
          server_updated_at: serverNote.updated_at,
        });
        if (!hydrated) throw new Error("Draft was tombstoned before server snapshot hydration");
        draft = hydrated;
      } else {
        if (draft.server_create_title === undefined || draft.server_create_content === undefined) {
          const persisted = await this.persistState(workspaceId, entityId, {
            server_create_title: draft.title,
            server_create_content: draft.content,
          });
          if (!persisted) throw new Error("Draft was tombstoned before server creation");
          draft = persisted;
        }
        serverNote = await client.create(
          { title: draft.server_create_title ?? draft.title, content: draft.server_create_content ?? draft.content },
          { idempotencyKey: entityId },
        );
        const bound = await this.persistState(workspaceId, entityId, {
          server_note: serverNote,
          server_note_id: serverNote.id,
          server_revision: serverNote.revision,
          server_updated_at: serverNote.updated_at,
          server_create_title: undefined,
          server_create_content: undefined,
        });
        if (!bound) throw new Error("Draft was tombstoned before server identity binding");
        draft = bound;
      }
    }

    for (;;) {
      await this.flush(workspaceId, entityId);
      draft = await this.store.getDraft(workspaceId, entityId);
      if (!draft) throw new Error("Draft disappeared during server sync");

      if (draft.pending_patch) {
        const pending = draft.pending_patch;
        serverNote = await client.update(
          serverNote.id,
          this.patchInput(pending),
          { idempotencyKey: pending.key },
        );
        const saved = await this.persistState(workspaceId, entityId, {
          server_note: serverNote,
          server_note_id: serverNote.id,
          server_revision: serverNote.revision,
          server_updated_at: serverNote.updated_at,
          pending_patch: undefined,
        });
        if (!saved) throw new Error("Draft was tombstoned before PATCH binding");
        continue;
      }

      if (serverNote.title !== draft.title || serverNote.content !== draft.content) {
        const staged = await this.stagePatch(workspaceId, entityId, serverNote);
        if (!staged) throw new Error("Draft was tombstoned before PATCH intent");
        continue;
      }

      const generation = draft.draft_generation ?? 0;
      if (lifecycle.tombstoned) throw new Error("Draft was tombstoned before sync completed");
      return this.syncResult(serverNote, draft, generation);
    }
  }

  private async stagePatch(workspaceId: string, entityId: string, serverNote: Note) {
    return this.enqueue(this.key(workspaceId, entityId), async () => {
      const current = await this.store.getDraft(workspaceId, entityId);
      if (!current) throw new Error("Draft was not found");
      if (current.pending_patch) return current;
      const generation = current.next_patch_generation ?? 1;
      const pending: PendingPatch = {
        key: `${entityId}:patch:${generation}`,
        generation,
        base_revision: serverNote.revision,
        title: current.title,
        content: current.content,
        source: "manual",
      };
      const next = { ...current, pending_patch: pending, next_patch_generation: generation + 1 };
      await this.store.saveDraft(next);
      return next;
    });
  }

  private async persistState(workspaceId: string, entityId: string, patch: Partial<LocalDraft>) {
    return this.enqueue(this.key(workspaceId, entityId), async () => {
      const current = await this.store.getDraft(workspaceId, entityId);
      if (!current) throw new Error("Draft was not found before server state persistence");
      const next = { ...current, ...patch };
      await this.store.saveDraft(next);
      return next;
    });
  }

  private enqueue<T>(key: string, operation: () => Promise<T>): Promise<T | null> {
    const lifecycle = this.lifecycle(key);
    if (lifecycle.tombstoned) return Promise.resolve(null);
    const prior = lifecycle.tail;
    const run = prior.then(() => operation());
    lifecycle.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private lifecycle(key: string) {
    const existing = this.lifecycles.get(key);
    if (existing) return existing;
    const lifecycle: DraftLifecycle = { tail: Promise.resolve(), tombstoned: false };
    this.lifecycles.set(key, lifecycle);
    return lifecycle;
  }

  private syncResult(note: Note, draft: LocalDraft, generation: number): DraftSyncResult {
    return Object.assign({ ...note, note, draft, localDraft: draft, generation, localGeneration: generation }, note);
  }

  private expectation(expected: DraftReconcileExpectation | DraftSyncResult): DraftReconcileExpectation {
    return "note" in expected
      ? { generation: expected.generation, serverNoteId: expected.note.id, serverRevision: expected.note.revision }
      : expected;
  }

  private matches(draft: LocalDraft, expectation: DraftReconcileExpectation) {
    return (draft.draft_generation ?? 0) === expectation.generation
      && (expectation.serverNoteId === undefined || draft.server_note?.id === expectation.serverNoteId)
      && (expectation.serverRevision === undefined || draft.server_note?.revision === expectation.serverRevision)
      && !draft.pending_patch;
  }

  private patchInput(pending: PendingPatch): UpdateNoteInput {
    return {
      base_revision: pending.base_revision,
      title: pending.title,
      content: pending.content,
      source: pending.source,
    };
  }

  private key(workspaceId: string, entityId: string) {
    return `${workspaceId}:${entityId}`;
  }
}
