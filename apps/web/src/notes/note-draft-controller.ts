import type { Note, UpdateNoteInput } from "@nexus/contracts";
import type { DraftMutation, LocalDraft, PendingPatch } from "../data/local-store";

export interface NoteDraftStore {
  saveDraft(draft: LocalDraft): Promise<void>;
  mutateDraft(workspaceId: string, entityId: string, mutation: DraftMutation): Promise<LocalDraft | null>;
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

export class NoteDraftControllerQuiescedError extends Error {
  readonly code = "DRAFT_CONTROLLER_QUIESCED";

  constructor() {
    super("Draft controller is quiesced");
    this.name = "NoteDraftControllerQuiescedError";
  }
}

export class NoteDraftController {
  private readonly createId: () => string;
  private readonly clock: () => Date;
  private readonly lifecycles = new Map<string, DraftLifecycle>();
  private readonly activeOperations = new Set<Promise<unknown>>();
  private quiesced = false;
  private quiescePromise?: Promise<void>;

  constructor(
    private readonly store: NoteDraftStore,
    options: NoteDraftControllerOptions = {},
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.clock = options.clock ?? (() => new Date());
  }

  async create(workspaceId: string): Promise<LocalDraft> {
    this.assertActive();
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
    this.assertActive();
    return this.trackOperation((async () => {
      await this.flush(workspaceId);
      const drafts = await this.store.listDrafts(workspaceId);
      return drafts[0] ?? null;
    })());
  }

  save(workspaceId: string, entityId: string, title: string, content: string) {
    try {
      this.assertActive();
    } catch (error) {
      return Promise.reject(error);
    }
    return this.enqueue(this.key(workspaceId, entityId), async () => {
      return this.store.mutateDraft(workspaceId, entityId, (current) => {
        if (!current) return undefined;
        return {
          ...current,
          title,
          content,
          updated_at: this.clock().toISOString(),
          draft_generation: (current.draft_generation ?? 0) + 1,
        };
      });
    });
  }

  async sync(workspaceId: string, entityId: string, client: DraftServerClient): Promise<DraftSyncResult> {
    const key = this.key(workspaceId, entityId);
    const existing = this.lifecycles.get(key);
    if (existing?.syncPromise) return existing.syncPromise;
    this.assertActive();
    const lifecycle = existing ?? this.lifecycle(key);
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
    const existing = this.lifecycles.get(key);
    if (existing?.reconcilePromise) return existing.reconcilePromise;
    this.assertActive();
    const lifecycle = existing ?? this.lifecycle(key);
    const expectation = expected ? this.expectation(expected) : undefined;

    // Tombstone synchronously, before taking the current tail snapshot.
    lifecycle.tombstoned = true;
    const prior = lifecycle.tail;
    const run = prior.then(async () => {
      const outcome: { value: "deleted" | "changed" | "absent" } = { value: "absent" };
      await this.store.mutateDraft(workspaceId, entityId, (current) => {
        if (!current) {
          outcome.value = "absent";
          return undefined;
        }
        if (expectation && !this.matches(current, expectation)) {
          outcome.value = "changed";
          return undefined;
        }
        outcome.value = "deleted";
        return null;
      });
      if (outcome.value === "changed") {
        lifecycle.tombstoned = false;
        return false;
      }
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

  quiesce(): Promise<void> {
    if (this.quiescePromise) return this.quiescePromise;
    this.quiesced = true;
    this.quiescePromise = this.drainLifecycles();
    return this.quiescePromise;
  }

  resume() {
    this.quiesced = false;
    this.quiescePromise = undefined;
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
        const hydrated = await this.bindServerNote(workspaceId, entityId, serverNote);
        if (!hydrated) throw new Error("Draft was tombstoned before server snapshot hydration");
        draft = hydrated;
        if (!draft.server_note
          && (draft.server_note_id !== serverNote.id || (draft.server_revision ?? 0) > serverNote.revision)) {
          throw new Error("Draft has a newer server binding; local recovery remains available");
        }
        serverNote = draft.server_note ?? serverNote;
      } else {
        if (draft.server_create_title === undefined || draft.server_create_content === undefined) {
          const persisted = await this.persistCreatePayload(workspaceId, entityId, draft.title, draft.content);
          if (!persisted) throw new Error("Draft was tombstoned before server creation");
          draft = persisted;
        }
        serverNote = await client.create(
          { title: draft.server_create_title ?? draft.title, content: draft.server_create_content ?? draft.content },
          { idempotencyKey: entityId },
        );
        const bound = await this.bindServerNote(workspaceId, entityId, serverNote);
        if (!bound) throw new Error("Draft was tombstoned before server identity binding");
        draft = bound;
        serverNote = draft.server_note ?? serverNote;
      }
    }

    for (;;) {
      await this.flush(workspaceId, entityId);
      draft = await this.store.getDraft(workspaceId, entityId);
      if (!draft) throw new Error("Draft disappeared during server sync");

      if (draft.pending_patch) {
        const pending = draft.pending_patch;
        if (draft.server_note) serverNote = draft.server_note;
        serverNote = await client.update(
          serverNote.id,
          this.patchInput(pending),
          { idempotencyKey: pending.key },
        );
        const saved = await this.mergePatchResponse(workspaceId, entityId, pending.key, serverNote);
        if (!saved) throw new Error("Draft was tombstoned before PATCH binding");
        draft = saved;
        serverNote = draft.server_note ?? serverNote;
        continue;
      }

      if (serverNote.title !== draft.title || serverNote.content !== draft.content) {
        const staged = await this.stagePatch(workspaceId, entityId, serverNote);
        if (!staged) throw new Error("Draft was tombstoned before PATCH intent");
        if (!staged.server_note || staged.server_note.id !== serverNote.id) {
          throw new Error("DRAFT_CHANGED: server binding changed during PATCH staging");
        }
        serverNote = staged.server_note;
        continue;
      }

      const generation = draft.draft_generation ?? 0;
      if (lifecycle.tombstoned) throw new Error("Draft was tombstoned before sync completed");
      return this.syncResult(serverNote, draft, generation);
    }
  }

  private async stagePatch(workspaceId: string, entityId: string, serverNote: Note) {
    return this.enqueue(this.key(workspaceId, entityId), async () => {
      return this.store.mutateDraft(workspaceId, entityId, (current) => {
        if (!current) return undefined;
        if (current.pending_patch) return current;
        if (!current.server_note || current.server_note.id !== serverNote.id) return current;
        const generation = current.next_patch_generation ?? 1;
        const pending: PendingPatch = {
          key: `${entityId}:patch:${generation}`,
          generation,
          base_revision: current.server_note.revision,
          title: current.title,
          content: current.content,
          source: "manual",
        };
        return { ...current, pending_patch: pending, next_patch_generation: generation + 1 };
      });
    });
  }

  private async bindServerNote(workspaceId: string, entityId: string, serverNote: Note) {
    return this.enqueue(this.key(workspaceId, entityId), async () => {
      return this.store.mutateDraft(workspaceId, entityId, (current) => {
        if (!current) return undefined;
        if (current.server_note_id && current.server_note_id !== serverNote.id) return current;
        if (!current.server_note && (current.server_revision ?? 0) > serverNote.revision) return current;
        if (current.server_note) {
          if (current.server_note.id !== serverNote.id || current.server_note.revision >= serverNote.revision) return current;
        }
        return {
          ...current,
          server_note: serverNote,
          server_note_id: serverNote.id,
          server_revision: serverNote.revision,
          server_updated_at: serverNote.updated_at,
          server_create_title: undefined,
          server_create_content: undefined,
        };
      });
    });
  }

  private async persistCreatePayload(workspaceId: string, entityId: string, title: string, content: string) {
    return this.enqueue(this.key(workspaceId, entityId), async () => this.store.mutateDraft(workspaceId, entityId, (current) => (
      current ? { ...current, server_create_title: title, server_create_content: content } : undefined
    )));
  }

  private async mergePatchResponse(workspaceId: string, entityId: string, completedKey: string, serverNote: Note) {
    return this.enqueue(this.key(workspaceId, entityId), async () => {
      return this.store.mutateDraft(workspaceId, entityId, (current) => {
        if (!current || current.pending_patch?.key !== completedKey) return undefined;
        if (current.server_note && current.server_note.id !== serverNote.id) return current;
        if (current.server_note && current.server_note.revision > serverNote.revision) return current;
        if (current.server_note
          && current.server_note.revision === serverNote.revision
          && JSON.stringify(current.server_note) !== JSON.stringify(serverNote)) return current;
        return {
          ...current,
          server_note: serverNote,
          server_note_id: serverNote.id,
          server_revision: serverNote.revision,
          server_updated_at: serverNote.updated_at,
          pending_patch: undefined,
        };
      });
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

  private async drainLifecycles() {
    for (;;) {
      const pending = this.pendingLifecycles();
      await Promise.allSettled(pending);
      const next = this.pendingLifecycles();
      if (next.every((promise) => pending.includes(promise))) return;
    }
  }

  private pendingLifecycles() {
    const pending = new Set<Promise<unknown>>(this.activeOperations);
    for (const lifecycle of this.lifecycles.values()) {
      pending.add(lifecycle.tail);
      if (lifecycle.syncPromise) pending.add(lifecycle.syncPromise);
      if (lifecycle.reconcilePromise) pending.add(lifecycle.reconcilePromise);
    }
    return [...pending];
  }

  private trackOperation<T>(operation: Promise<T>) {
    const tracked = operation.finally(() => this.activeOperations.delete(tracked));
    this.activeOperations.add(tracked);
    return tracked;
  }

  private assertActive() {
    if (this.quiesced) throw new NoteDraftControllerQuiescedError();
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
