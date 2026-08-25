import { describe, expect, it, vi } from "vitest";
import type { LocalDraft } from "../src/data/local-store";
import { NoteDraftController } from "../src/notes/note-draft-controller";

function createStore(overrides: Partial<{
  saveDraft(draft: LocalDraft): Promise<void>;
  getDraft(workspaceId: string, entityId: string): Promise<LocalDraft | null>;
  listDrafts(workspaceId: string): Promise<LocalDraft[]>;
  removeDraft(workspaceId: string, entityId: string): Promise<void>;
  mutateDraft(workspaceId: string, entityId: string, mutation: (current: LocalDraft | null) => LocalDraft | null | undefined): Promise<LocalDraft | null>;
}> = {}) {
  const drafts = new Map<string, LocalDraft>();
  const saveDraft = vi.fn(async (draft: LocalDraft) => { drafts.set(`${draft.workspace_id}:${draft.entity_id}`, { ...draft }); });
  const persistedSaveDraft = overrides.saveDraft ?? saveDraft;
  const removeDraft = vi.fn(async (workspaceId: string, entityId: string) => { drafts.delete(`${workspaceId}:${entityId}`); });
  const persistedRemoveDraft = overrides.removeDraft ?? removeDraft;
  return {
    saveDraft: persistedSaveDraft,
    mutateDraft: vi.fn(async (workspaceId: string, entityId: string, mutation: (current: LocalDraft | null) => LocalDraft | null | undefined) => {
      const key = `${workspaceId}:${entityId}`;
      const current = drafts.get(key) ?? null;
      const next = mutation(current ? { ...current } : null);
      if (next === undefined) return current ? { ...current } : null;
      if (next === null) {
        await persistedRemoveDraft(workspaceId, entityId);
        return null;
      }
      drafts.set(key, { ...next });
      await persistedSaveDraft(next);
      return { ...next };
    }),
    getDraft: vi.fn(async (workspaceId: string, entityId: string) => drafts.get(`${workspaceId}:${entityId}`) ?? null),
    listDrafts: vi.fn(async (workspaceId: string) => [...drafts.values()].filter((draft) => draft.workspace_id === workspaceId)),
    removeDraft: persistedRemoveDraft,
    ...overrides,
  };
}

const serverNote = (overrides: Partial<{ id: string; title: string; content: string; revision: number }> = {}) => ({
  id: "server-1",
  workspace_id: "ws-1",
  folder_id: null,
  database_id: null,
  created_by: "user-1",
  updated_by: "user-1",
  title: "",
  content: "",
  status: "active" as const,
  is_favorite: false,
  is_pinned: false,
  daily_date: null,
  revision: 1,
  created_at: "2026-08-22T00:00:00.000Z",
  updated_at: "2026-08-22T00:00:00.000Z",
  ...overrides,
});

describe("NoteDraftController", () => {
  it("rebases a local conflict patch onto the latest server revision", async () => {
    const store = createStore();
    const base = serverNote({ id: "server-1", title: "旧服务器标题", content: "旧服务器正文", revision: 2 });
    await store.saveDraft({
      workspace_id: "ws-1", entity_id: "local-1", title: "本地标题", content: "本地正文", updated_at: "2026-08-24T00:00:00.000Z",
      draft_generation: 4, next_patch_generation: 8, server_note: base, server_note_id: base.id, server_revision: base.revision,
      pending_patch: { key: "local-1:patch:7", generation: 7, base_revision: 2, title: "本地标题", content: "本地正文", source: "manual" },
    });
    const latest = serverNote({ id: "server-1", title: "远程标题", content: "远程正文", revision: 6 });
    const controller = new NoteDraftController(store);

    const resolved = await controller.resolveConflict("ws-1", "local-1", "local", latest);

    expect(resolved).toMatchObject({
      server_note: latest,
      pending_patch: { key: "local-1:patch:8", generation: 8, base_revision: 6, title: "本地标题", content: "本地正文" },
      next_patch_generation: 9,
    });
  });

  it("adopts the latest server revision and clears the local conflict patch", async () => {
    const store = createStore();
    const latest = serverNote({ id: "server-1", title: "远程标题", content: "远程正文", revision: 6 });
    await store.saveDraft({
      workspace_id: "ws-1", entity_id: "local-1", title: "本地标题", content: "本地正文", updated_at: "2026-08-24T00:00:00.000Z",
      draft_generation: 4, next_patch_generation: 8, server_note: serverNote({ id: "server-1", revision: 2 }), server_note_id: "server-1", server_revision: 2,
      pending_patch: { key: "local-1:patch:7", generation: 7, base_revision: 2, title: "本地标题", content: "本地正文", source: "manual" },
    });
    const controller = new NoteDraftController(store);

    const resolved = await controller.resolveConflict("ws-1", "local-1", "server", latest);

    expect(resolved).toMatchObject({
      title: "远程标题",
      content: "远程正文",
      server_note: latest,
      server_revision: 6,
    });
    expect(resolved?.pending_patch).toBeUndefined();
  });

  it("keeps a newer shared-store PATCH intent when an older controller response resolves last", async () => {
    const store = createStore();
    const base = serverNote({ id: "server-1", title: "Base", content: "Base body", revision: 1 });
    await store.saveDraft({
      workspace_id: "ws-1", entity_id: "local-1", title: "A", content: "A body", updated_at: "2026-08-22T00:00:00.000Z",
      draft_generation: 1, next_patch_generation: 1, server_note: base, server_note_id: base.id, server_revision: base.revision,
    });
    let resolveA!: (note: ReturnType<typeof serverNote>) => void;
    let resolveB!: (note: ReturnType<typeof serverNote>) => void;
    const oldResponse = new Promise<ReturnType<typeof serverNote>>((resolve) => { resolveA = resolve; });
    const newestResponse = new Promise<ReturnType<typeof serverNote>>((resolve) => { resolveB = resolve; });
    const serverAfterBReplay = serverNote({ id: "server-1", title: "A accepted", content: "A accepted body", revision: 3 });
    const serverAfterB = serverNote({ id: "server-1", title: "B", content: "B body", revision: 4 });
    const controllerA = new NoteDraftController(store);
    const controllerB = new NoteDraftController(store);
    const updateA = vi.fn(async (_id: string, _input: unknown, options?: { idempotencyKey?: string }) => {
      if (options?.idempotencyKey === "local-1:patch:1") return oldResponse;
      return newestResponse;
    });
    const updateB = vi.fn(async (_id: string, _input: unknown, options?: { idempotencyKey?: string }) => {
      if (options?.idempotencyKey === "local-1:patch:1") return serverAfterBReplay;
      return newestResponse;
    });

    const syncingA = controllerA.sync("ws-1", "local-1", { create: vi.fn(), update: updateA });
    await vi.waitFor(() => expect(updateA).toHaveBeenCalledWith("server-1", expect.anything(), { idempotencyKey: "local-1:patch:1" }));
    await controllerB.save("ws-1", "local-1", "B", "B body");
    const syncingB = controllerB.sync("ws-1", "local-1", { create: vi.fn(), update: updateB });
    await vi.waitFor(() => expect(updateB.mock.calls.some(([, , options]) => options?.idempotencyKey === "local-1:patch:2")).toBe(true));

    resolveA(serverNote({ id: "server-1", title: "A old", content: "A old body", revision: 2 }));
    await vi.waitFor(async () => expect(await store.getDraft("ws-1", "local-1")).toMatchObject({
      pending_patch: { key: "local-1:patch:2", title: "B", content: "B body" },
      server_note: { revision: 3, title: "A accepted" },
    }));
    await vi.waitFor(() => expect(updateA.mock.calls.some(([, , options]) => options?.idempotencyKey === "local-1:patch:2")).toBe(true));
    resolveB(serverAfterB);

    await expect(Promise.all([syncingA, syncingB])).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ note: expect.objectContaining({ revision: 4, title: "B" }) }),
    ]));
    const result = await controllerB.sync("ws-1", "local-1", { create: vi.fn(), update: updateB });
    await expect(controllerB.reconcile("ws-1", "local-1", result)).resolves.toBe(true);
    expect(await store.getDraft("ws-1", "local-1")).toBeNull();
  });

  it("does not let a late POST or legacy hydration replace a newer binding or pending PATCH", async () => {
    const store = createStore();
    await store.saveDraft({ workspace_id: "ws-1", entity_id: "local-post", title: "Draft", content: "Body", updated_at: "2026-08-22T00:00:00.000Z" });
    let resolvePost!: (note: ReturnType<typeof serverNote>) => void;
    const postResponse = new Promise<ReturnType<typeof serverNote>>((resolve) => { resolvePost = resolve; });
    let resolvePostPatch!: (note: ReturnType<typeof serverNote>) => void;
    const postPatchResponse = new Promise<ReturnType<typeof serverNote>>((resolve) => { resolvePostPatch = resolve; });
    const postController = new NoteDraftController(store);
    const postUpdate = vi.fn(async (_id: string, _input: unknown, _options?: { idempotencyKey?: string }) => postPatchResponse);
    const postSync = postController.sync("ws-1", "local-post", {
      create: vi.fn(async () => postResponse),
      update: postUpdate,
    });
    await vi.waitFor(() => expect(store.getDraft("ws-1", "local-post")).resolves.toMatchObject({ server_create_title: "Draft" }));
    const newer = serverNote({ id: "server-new", title: "New server", content: "New body", revision: 7 });
    await store.mutateDraft("ws-1", "local-post", (current) => ({
      ...current!, title: "Pending", content: "Pending body", server_note: newer, server_note_id: newer.id, server_revision: newer.revision,
      pending_patch: { key: "local-post:patch:9", generation: 9, base_revision: newer.revision, title: "Pending", content: "Pending body", source: "manual" },
      next_patch_generation: 10,
    }));
    resolvePost(serverNote({ id: "server-old", title: "Old", content: "Old body", revision: 1 }));
    await vi.waitFor(() => expect(postUpdate.mock.calls.some(([, , options]) => options?.idempotencyKey === "local-post:patch:9")).toBe(true));
    await vi.waitFor(async () => expect((await store.getDraft("ws-1", "local-post"))?.pending_patch?.key).toBe("local-post:patch:9"));
    expect((await store.getDraft("ws-1", "local-post"))?.server_note).toMatchObject({ id: "server-new", revision: 7 });
    resolvePostPatch(serverNote({ id: "server-new", title: "Pending", content: "Pending body", revision: 8 }));
    await expect(postSync).resolves.toMatchObject({ note: { id: "server-new", revision: 8 } });

    const legacyServer = serverNote({ id: "server-legacy", title: "Legacy old", content: "Legacy old body", revision: 2 });
    await store.saveDraft({ workspace_id: "ws-1", entity_id: "local-legacy-race", title: "Local", content: "Local body", updated_at: "2026-08-22T00:01:00.000Z", server_note_id: legacyServer.id, server_revision: legacyServer.revision });
    const legacyController = new NoteDraftController(store);
    let resolveLegacyGet!: (note: ReturnType<typeof serverNote>) => void;
    const legacyGetResponse = new Promise<ReturnType<typeof serverNote>>((resolve) => { resolveLegacyGet = resolve; });
    let resolveLegacyPatch!: (note: ReturnType<typeof serverNote>) => void;
    const legacyPatchResponse = new Promise<ReturnType<typeof serverNote>>((resolve) => { resolveLegacyPatch = resolve; });
    const legacyUpdate = vi.fn(async (_id: string, _input: unknown, _options?: { idempotencyKey?: string }) => legacyPatchResponse);
    const legacySync = legacyController.sync("ws-1", "local-legacy-race", {
      create: vi.fn(), get: vi.fn(async () => legacyGetResponse),
      update: legacyUpdate,
    });
    await vi.waitFor(() => expect(store.getDraft("ws-1", "local-legacy-race")).resolves.toMatchObject({ server_note_id: "server-legacy" }));
    await store.mutateDraft("ws-1", "local-legacy-race", (current) => ({
      ...current!, title: "Pending", content: "Pending body", server_note: newer, server_note_id: newer.id, server_revision: newer.revision,
      pending_patch: { key: "local-legacy-race:patch:4", generation: 4, base_revision: newer.revision, title: "Pending", content: "Pending body", source: "manual" },
    }));
    resolveLegacyGet(legacyServer);
    await vi.waitFor(() => expect(legacyUpdate.mock.calls.some(([, , options]) => options?.idempotencyKey === "local-legacy-race:patch:4")).toBe(true));
    expect((await store.getDraft("ws-1", "local-legacy-race"))?.server_note).toMatchObject({ id: "server-new", revision: 7 });
    resolveLegacyPatch(serverNote({ id: "server-new", title: "Pending", content: "Pending body", revision: 8 }));
    const result = await legacySync;
    expect(result.note).toMatchObject({ id: "server-new", revision: 8 });
    expect((await store.getDraft("ws-1", "local-legacy-race"))?.pending_patch).toBeUndefined();
  });

  it("does not recreate a deleted draft when an old controller saves after reconciliation", async () => {
    const store = createStore();
    await store.saveDraft({ workspace_id: "ws-1", entity_id: "local-1", title: "Old", content: "Body", updated_at: "2026-08-22T00:00:00.000Z", draft_generation: 1 });
    const oldController = new NoteDraftController(store);
    const deletingController = new NoteDraftController(store);
    await expect(deletingController.reconcile("ws-1", "local-1", { generation: 1 })).resolves.toBe(true);
    await expect(oldController.save("ws-1", "local-1", "Stale", "Stale body")).resolves.toBeNull();
    expect(await store.getDraft("ws-1", "local-1")).toBeNull();
  });

  it("does not atomically reconcile over a newer save from another controller", async () => {
    const store = createStore();
    const originalMutateDraft = store.mutateDraft.getMockImplementation()!;
    let releaseMutation!: () => void;
    const mutationBlocked = new Promise<void>((resolve) => { releaseMutation = resolve; });
    let blockNextMutation = true;
    store.mutateDraft.mockImplementation(async (workspaceId: string, entityId: string, mutation: (current: LocalDraft | null) => LocalDraft | null | undefined) => {
      if (blockNextMutation) {
        blockNextMutation = false;
        await mutationBlocked;
      }
      return originalMutateDraft(workspaceId, entityId, mutation);
    });
    const originalRemoveDraft = store.removeDraft.getMockImplementation()!;
    store.removeDraft.mockImplementation(async (workspaceId: string, entityId: string) => {
      await originalRemoveDraft(workspaceId, entityId);
    });
    await store.saveDraft({ workspace_id: "ws-1", entity_id: "local-1", title: "Old", content: "Body", updated_at: "2026-08-22T00:00:00.000Z", draft_generation: 1 });
    const controllerA = new NoteDraftController(store);
    const controllerB = new NoteDraftController(store);
    const reconciling = controllerA.reconcile("ws-1", "local-1", { generation: 1 });
    await vi.waitFor(() => expect(store.mutateDraft).toHaveBeenCalled());
    await controllerB.save("ws-1", "local-1", "New", "New body");
    releaseMutation();

    await expect(reconciling).resolves.toBe(false);
    expect(await store.getDraft("ws-1", "local-1")).toMatchObject({ title: "New", content: "New body", draft_generation: 2 });
    expect(store.removeDraft).not.toHaveBeenCalled();
  });

  it("stages PATCH from the current persisted server snapshot after another controller advances it", async () => {
    const store = createStore();
    const serverV1 = serverNote({ id: "server-1", title: "Base", content: "Base body", revision: 1 });
    const serverV2 = serverNote({ id: "server-1", title: "New server", content: "New server body", revision: 2 });
    await store.saveDraft({
      workspace_id: "ws-1", entity_id: "local-1", title: "Local edit", content: "Local body", updated_at: "2026-08-22T00:00:00.000Z",
      draft_generation: 1, next_patch_generation: 1, server_note: serverV1, server_note_id: serverV1.id, server_revision: serverV1.revision,
    });
    const controllerA = new NoteDraftController(store);
    const controllerB = new NoteDraftController(store);
    const originalGetDraft = store.getDraft.getMockImplementation()!;
    let draftReads = 0;
    let releaseDraftRead!: () => void;
    const draftReadBlocked = new Promise<void>((resolve) => { releaseDraftRead = resolve; });
    store.getDraft.mockImplementation(async (workspaceId: string, entityId: string) => {
      const current = await originalGetDraft(workspaceId, entityId);
      draftReads += 1;
      if (draftReads === 2) await draftReadBlocked;
      return current;
    });
    const update = vi.fn(async (_id: string, input: { title: string; content: string; base_revision: number }) => (
      serverNote({ id: "server-1", title: input.title, content: input.content, revision: 3 })
    ));
    const syncing = controllerA.sync("ws-1", "local-1", { create: vi.fn(), update });
    await vi.waitFor(() => expect(draftReads).toBe(2));
    await store.mutateDraft("ws-1", "local-1", (current) => ({
      ...current!, server_note: serverV2, server_note_id: serverV2.id, server_revision: serverV2.revision,
    }));
    releaseDraftRead();

    const result = await syncing;

    expect(update).toHaveBeenCalledWith("server-1", expect.objectContaining({ base_revision: 2 }), expect.objectContaining({ idempotencyKey: "local-1:patch:1" }));
    expect(result.note).toMatchObject({ id: "server-1", revision: 3, title: "Local edit", content: "Local body" });
    expect(result.localDraft.pending_patch).toBeUndefined();
    expect(result.localDraft.server_note?.revision).toBe(3);
    await expect(controllerB.sync("ws-1", "local-1", { create: vi.fn(), update })).resolves.toMatchObject({ note: expect.objectContaining({ revision: 3 }) });
  });

  it("does not hydrate a legacy response over a higher persisted server binding metadata", async () => {
    const store = createStore();
    const legacyServer = serverNote({ id: "server-old", title: "Legacy", content: "Legacy body", revision: 2 });
    await store.saveDraft({
      workspace_id: "ws-1", entity_id: "local-legacy-meta", title: "Legacy", content: "Legacy body", updated_at: "2026-08-22T00:00:00.000Z",
      server_note_id: "server-new", server_revision: 7, server_updated_at: "2026-08-22T00:01:00.000Z",
    });
    const controller = new NoteDraftController(store);

    await expect(controller.sync("ws-1", "local-legacy-meta", {
      create: vi.fn(), get: vi.fn(async () => legacyServer), update: vi.fn(),
    })).rejects.toThrow("newer server binding");
    const preserved = await store.getDraft("ws-1", "local-legacy-meta");
    expect(preserved).toMatchObject({ server_note_id: "server-new", server_revision: 7 });
    expect(preserved?.server_note).toBeUndefined();
  });

  it("serializes a three-save interleaving through one unconditional queue tail", async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let firstStarted!: () => void;
    let secondStarted!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondBlocked = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const writes: string[] = [];
    const store = createStore();
    await store.saveDraft({ workspace_id: "ws-1", entity_id: "local-1", title: "seed", content: "seed", updated_at: "2026-08-22T00:00:00.000Z" });
    store.saveDraft.mockImplementation(async (draft: LocalDraft) => {
      writes.push(`start:${draft.title}`);
      if (draft.title === "first") {
        firstStarted();
        await firstBlocked;
      }
      if (draft.title === "second") {
        secondStarted();
        await secondBlocked;
      }
      writes.push(`finish:${draft.title}`);
    });
    const controller = new NoteDraftController(store);
    const firstStartedPromise = new Promise<void>((resolve) => { firstStarted = resolve; });
    const secondStartedPromise = new Promise<void>((resolve) => { secondStarted = resolve; });

    const first = controller.save("ws-1", "local-1", "first", "1");
    await firstStartedPromise;
    const second = controller.save("ws-1", "local-1", "second", "2");
    releaseFirst();
    await secondStartedPromise;
    const third = controller.save("ws-1", "local-1", "third", "3");

    expect(writes).toEqual(["start:first", "finish:first", "start:second"]);
    releaseSecond();
    await Promise.all([first, second, third]);
    expect(writes).toEqual([
      "start:first", "finish:first", "start:second", "finish:second", "start:third", "finish:third",
    ]);
    expect(store.saveDraft.mock.calls.at(-1)?.[0]).toMatchObject({ title: "third", content: "3" });
  });

  it("returns the exact synchronized local version without deleting the draft", async () => {
    const server = serverNote({ id: "server-1", title: "Server title", content: "Server body", revision: 4 });
    const store = createStore();
    await store.saveDraft({
      workspace_id: "ws-1",
      entity_id: "local-1",
      title: "Server title",
      content: "Server body",
      updated_at: "2026-08-22T00:04:00.000Z",
      draft_generation: 4,
      server_note: server,
      server_note_id: server.id,
      server_revision: server.revision,
      server_updated_at: server.updated_at,
    });
    const controller = new NoteDraftController(store);

    const result = await controller.sync("ws-1", "local-1", {
      create: vi.fn(),
      update: vi.fn(),
    });

    expect(result.note).toEqual(server);
    expect(result.draft).toMatchObject({ entity_id: "local-1", draft_generation: 4, server_note: server });
    expect(result.generation).toBe(4);
    expect(store.removeDraft).not.toHaveBeenCalled();
  });

  it("stages a PATCH from the persisted server snapshot after controller recreation", async () => {
    const server = serverNote({ id: "server-1", title: "Before", content: "Before body", revision: 2 });
    const store = createStore();
    await store.saveDraft({
      workspace_id: "ws-1", entity_id: "local-1", title: "After", content: "After body",
      updated_at: "2026-08-22T00:05:00.000Z", draft_generation: 5,
      server_note: server, server_note_id: server.id, server_revision: server.revision, server_updated_at: server.updated_at,
      next_patch_generation: 1,
    });
    const update = vi.fn(async (_id: string, input: { title: string; content: string; base_revision: number }) => serverNote({
      ...server, title: input.title, content: input.content, revision: 3,
    }));
    const controller = new NoteDraftController(store);

    const result = await controller.sync("ws-1", "local-1", { create: vi.fn(), update });

    expect(update).toHaveBeenCalledWith("server-1", expect.objectContaining({
      base_revision: 2, title: "After", content: "After body",
    }), expect.objectContaining({ idempotencyKey: expect.any(String) }));
    expect(result.note).toMatchObject({ title: "After", content: "After body", revision: 3 });
    expect(store.removeDraft).not.toHaveBeenCalled();
  });

  it("hydrates a legacy server-bound draft without POST before resuming reconciliation", async () => {
    const server = serverNote({ id: "server-legacy", title: "Before", content: "Before body", revision: 2 });
    const store = createStore();
    await store.saveDraft({
      workspace_id: "ws-1", entity_id: "local-legacy", title: "After", content: "After body",
      updated_at: "2026-08-22T00:05:30.000Z", draft_generation: 5,
      server_note_id: server.id, server_revision: server.revision, server_updated_at: server.updated_at,
    });
    const get = vi.fn(async () => server);
    const update = vi.fn(async (_id: string, input: { title: string; content: string; base_revision: number }) => serverNote({
      ...server, title: input.title, content: input.content, revision: 3,
    }));
    const controller = new NoteDraftController(store);

    const result = await controller.sync("ws-1", "local-legacy", { create: vi.fn(), get, update });

    expect(get).toHaveBeenCalledWith("server-legacy");
    expect(update).toHaveBeenCalledWith("server-legacy", expect.objectContaining({ base_revision: 2, title: "After", content: "After body" }), expect.anything());
    expect(result.note).toMatchObject({ id: "server-legacy", title: "After", content: "After body" });
  });

  it("replays a pending PATCH exactly after reload and gives the next edit a new key", async () => {
    const server = serverNote({ id: "server-1", title: "Before", content: "Before body", revision: 2 });
    const store = createStore();
    await store.saveDraft({
      workspace_id: "ws-1", entity_id: "local-1", title: "Latest", content: "Latest body",
      updated_at: "2026-08-22T00:06:00.000Z", draft_generation: 8,
      server_note: server, server_note_id: server.id, server_revision: server.revision,
      next_patch_generation: 3,
      pending_patch: {
        key: "local-1:patch:2", generation: 2, base_revision: 2,
        title: "Pending", content: "Pending body", source: "manual",
      },
    });
    const update = vi.fn()
      .mockImplementationOnce(async (_id: string, input: { title: string; content: string; base_revision: number }, options?: { idempotencyKey?: string }) => {
        expect(options).toEqual({ idempotencyKey: "local-1:patch:2" });
        expect(input).toMatchObject({ base_revision: 2, title: "Pending", content: "Pending body", source: "manual" });
        return serverNote({ ...server, title: "Pending", content: "Pending body", revision: 3 });
      })
      .mockImplementationOnce(async (_id: string, input: { title: string; content: string; base_revision: number }, options?: { idempotencyKey?: string }) => {
        expect(options).toEqual({ idempotencyKey: "local-1:patch:3" });
        expect(input).toMatchObject({ base_revision: 3, title: "Latest", content: "Latest body", source: "manual" });
        return serverNote({ ...server, title: "Latest", content: "Latest body", revision: 4 });
      });
    const controller = new NoteDraftController(store);

    const result = await controller.sync("ws-1", "local-1", { create: vi.fn(), update });

    expect(update).toHaveBeenCalledTimes(2);
    expect(result.note).toMatchObject({ title: "Latest", content: "Latest body", revision: 4 });
    expect(store.removeDraft).not.toHaveBeenCalled();
  });

  it("clears the tombstone after delete failure so a later retry can save and reconcile", async () => {
    const store = createStore();
    await store.saveDraft({ workspace_id: "ws-1", entity_id: "local-1", title: "Saved", content: "Body", updated_at: "2026-08-22T00:07:00.000Z", draft_generation: 1 });
    let attempts = 0;
    store.removeDraft.mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("delete failed");
      await createStore().removeDraft("ws-1", "local-1");
    });
    const controller = new NoteDraftController(store);

    await expect(controller.reconcile("ws-1", "local-1", { generation: 1 })).rejects.toThrow("delete failed");
    await expect(controller.save("ws-1", "local-1", "Recovered", "Body")).resolves.toMatchObject({ title: "Recovered" });
    await expect(controller.reconcile("ws-1", "local-1", { generation: 2 })).resolves.toBe(true);
    expect(attempts).toBe(2);
  });

  it("awaits durable persistence before returning a new draft", async () => {
    let releaseSave!: () => void;
    const saveBlocked = new Promise<void>((resolve) => { releaseSave = resolve; });
    const store = createStore({ saveDraft: vi.fn(() => saveBlocked) });
    const controller = new NoteDraftController(store, {
      createId: () => "local-1",
      clock: () => new Date("2026-08-22T00:00:00.000Z"),
    });
    let returned = false;

    const creating = controller.create("ws-1").then((draft) => {
      returned = true;
      return draft;
    });
    await Promise.resolve();

    expect(store.saveDraft).toHaveBeenCalledOnce();
    expect(returned).toBe(false);

    releaseSave();
    await expect(creating).resolves.toMatchObject({
      workspace_id: "ws-1",
      entity_id: "local-1",
      title: "",
      content: "",
    });
  });

  it("recovers only the newest draft returned for the active workspace", async () => {
    const newest = { workspace_id: "ws-1", entity_id: "local-new", title: "New", content: "", updated_at: "2026-08-22T00:02:00.000Z" };
    const store = createStore({
      listDrafts: vi.fn(async (workspaceId: string) => workspaceId === "ws-1"
        ? [newest, { ...newest, entity_id: "local-old", updated_at: "2026-08-22T00:01:00.000Z" }]
        : []),
    });
    const controller = new NoteDraftController(store, { createId: () => "local-1" });

    await expect(controller.recover("ws-1")).resolves.toEqual(newest);
    await expect(controller.recover("ws-2")).resolves.toBeNull();
    expect(store.listDrafts).toHaveBeenNthCalledWith(1, "ws-1");
    expect(store.listDrafts).toHaveBeenNthCalledWith(2, "ws-2");
  });

  it("serializes saves so an older delayed write cannot resurrect stale values", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const writes: string[] = [];
    const saveDraft = vi.fn(async (draft: LocalDraft) => {
      writes.push(`start:${draft.title}`);
      if (draft.title === "first") await firstBlocked;
      writes.push(`finish:${draft.title}`);
    });
    const store = createStore();
    await store.saveDraft({ workspace_id: "ws-1", entity_id: "local-1", title: "seed", content: "seed", updated_at: "2026-08-22T00:00:00.000Z" });
    store.saveDraft.mockImplementation(saveDraft);
    const timestamps = [new Date("2026-08-22T00:01:00.000Z"), new Date("2026-08-22T00:02:00.000Z")];
    const controller = new NoteDraftController(store, { clock: () => timestamps.shift()! });

    const first = controller.save("ws-1", "local-1", "first", "old");
    const second = controller.save("ws-1", "local-1", "second", "latest");
    await vi.waitFor(() => expect(writes).toEqual(["start:first"]));
    releaseFirst();
    await Promise.all([first, second]);

    expect(writes).toEqual(["start:first", "finish:first", "start:second", "finish:second"]);
    expect(saveDraft.mock.calls.at(-1)?.[0]).toMatchObject({ title: "second", content: "latest" });
  });

  it("flushes pending saves before removing the workspace-scoped draft", async () => {
    const calls: string[] = [];
    let releaseSave!: () => void;
    const store = createStore();
    await store.saveDraft({ workspace_id: "ws-1", entity_id: "local-1", title: "seed", content: "seed", updated_at: "2026-08-22T00:00:00.000Z" });
    store.saveDraft.mockImplementation(async () => {
      calls.push("save:start");
      await new Promise<void>((resolve) => { releaseSave = resolve; });
      calls.push("save:finish");
    });
    store.removeDraft.mockImplementation(async () => { calls.push("remove"); });
    const controller = new NoteDraftController(store);

    void controller.save("ws-1", "local-1", "Latest", "Body");
    const reconciling = controller.reconcile("ws-1", "local-1");
    await vi.waitFor(() => expect(calls).toEqual(["save:start"]));

    releaseSave();
    await reconciling;

    expect(calls).toEqual(["save:start", "save:finish", "remove"]);
    expect(store.removeDraft).toHaveBeenCalledWith("ws-1", "local-1");
  });

  it("tombstones before observing the queue so a late save cannot resurrect a reconciled draft", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const writes: string[] = [];
    const store = createStore();
    await store.saveDraft({ workspace_id: "ws-1", entity_id: "local-1", title: "seed", content: "seed", updated_at: "2026-08-22T00:00:00.000Z" });
    store.saveDraft.mockImplementation(async (draft: LocalDraft) => {
      writes.push(`save:${draft.title}`);
      if (draft.title === "before") await firstBlocked;
    });
    store.removeDraft.mockImplementation(async () => { writes.push("remove"); });
    const controller = new NoteDraftController(store);

    const before = controller.save("ws-1", "local-1", "before", "body");
    const reconciling = controller.reconcile("ws-1", "local-1");
    const after = controller.save("ws-1", "local-1", "after", "stale");
    releaseFirst();

    await expect(after).resolves.toBeNull();
    await before;
    await reconciling;
    expect(writes).toEqual(["save:before", "remove"]);
  });

  it("retries a lost POST response with the same stable idempotency key", async () => {
    const store = createStore();
    const controller = new NoteDraftController(store, { createId: () => "local-1" });
    await controller.create("ws-1");
    await controller.save("ws-1", "local-1", "Draft", "Body");
    const note = serverNote({ title: "Draft", content: "Body" });
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue(note);
    const update = vi.fn(async (_id: string, input: { title: string; content: string }) => serverNote(input));
    const client = { create, update };

    await expect(controller.sync("ws-1", "local-1", client)).rejects.toThrow("response lost");
    const result = await controller.sync("ws-1", "local-1", client);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[1]).toEqual({ idempotencyKey: "local-1" });
    expect(create.mock.calls[1]?.[1]).toEqual({ idempotencyKey: "local-1" });
    expect(update).not.toHaveBeenCalled();
    expect(await store.getDraft("ws-1", "local-1")).toMatchObject({ server_note: note });
    await expect(controller.reconcile("ws-1", "local-1", result)).resolves.toBe(true);
    expect(await store.getDraft("ws-1", "local-1")).toBeNull();
  });

  it("replays a lost POST with its original payload before syncing newer edits", async () => {
    const store = createStore();
    await store.saveDraft({
      workspace_id: "ws-1",
      entity_id: "local-1",
      title: "Latest",
      content: "Latest body",
      updated_at: "2026-08-22T00:02:00.000Z",
      server_create_title: "Initial",
      server_create_content: "Initial body",
    });
    const controller = new NoteDraftController(store);
    const created = serverNote({ id: "server-1", title: "Initial", content: "Initial body" });
    const create = vi.fn()
      .mockImplementationOnce(async (input: { title: string; content: string }, options?: { idempotencyKey?: string }) => {
        expect(input).toEqual({ title: "Initial", content: "Initial body" });
        expect(options).toEqual({ idempotencyKey: "local-1" });
        throw new Error("response lost");
      })
      .mockResolvedValueOnce(created);
    const update = vi.fn(async (_id: string, input: { title: string; content: string }) => serverNote({ id: "server-1", revision: 2, ...input }));

    await expect(controller.sync("ws-1", "local-1", { create, update })).rejects.toThrow("response lost");
    await expect(controller.sync("ws-1", "local-1", { create, update })).resolves.toMatchObject({ title: "Latest", content: "Latest body" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith("server-1", expect.objectContaining({ title: "Latest", content: "Latest body" }), expect.anything());
  });

  it("persists the server identity before PATCH and resumes without POST after PATCH failure", async () => {
    let releaseIdentity!: () => void;
    let identitySaveStarted!: () => void;
    const identityStarted = new Promise<void>((resolve) => { identitySaveStarted = resolve; });
    const identityBlocked = new Promise<void>((resolve) => { releaseIdentity = resolve; });
    const baseStore = createStore();
    const originalSave = baseStore.saveDraft;
    const saveDraft = vi.fn(async (draft: LocalDraft) => {
      await originalSave(draft);
      if (draft.server_note_id) {
        identitySaveStarted();
        await identityBlocked;
      }
    });
    const mutateDraft = vi.fn(async (workspaceId: string, entityId: string, mutation: (current: LocalDraft | null) => LocalDraft | null | undefined) => {
      const current = await baseStore.getDraft(workspaceId, entityId);
      const next = mutation(current ? { ...current } : null);
      if (next === undefined) return current;
      if (next === null) { await baseStore.removeDraft(workspaceId, entityId); return null; }
      await saveDraft(next);
      return next;
    });
    const store = {
      ...baseStore,
      saveDraft,
      mutateDraft,
    };
    const controller = new NoteDraftController(store, { createId: () => "local-1" });
    await controller.create("ws-1");
    await controller.save("ws-1", "local-1", "initial", "initial content");
    const create = vi.fn(async () => serverNote());
    const update = vi.fn(async () => { throw new Error("patch failed"); });
    const syncing = controller.sync("ws-1", "local-1", { create, update });
    await identityStarted;
    expect(update).not.toHaveBeenCalled();
    releaseIdentity();
    await expect(syncing).rejects.toThrow("patch failed");
    expect(await baseStore.getDraft("ws-1", "local-1")).toMatchObject({ server_note_id: "server-1", server_revision: 1 });

    const resumed = new NoteDraftController(baseStore);
    const resumedUpdate = vi.fn(async (_id: string, input: { title: string; content: string }) => serverNote({ ...input, revision: 2 }));
    await expect(resumed.sync("ws-1", "local-1", { create, update: resumedUpdate })).resolves.toMatchObject({ id: "server-1" });
    expect(create).toHaveBeenCalledOnce();
    expect(resumedUpdate).toHaveBeenCalled();
  });

  it("reuses a persisted PATCH idempotency key after reload", async () => {
    const store = createStore();
    const server = serverNote({ id: "server-1", revision: 2 });
    await store.saveDraft({
      workspace_id: "ws-1",
      entity_id: "local-1",
      title: "Latest",
      content: "Body",
      updated_at: "2026-08-22T00:02:00.000Z",
      server_note_id: "server-1",
      server_revision: 2,
      server_updated_at: "2026-08-22T00:02:00.000Z",
      server_note: server,
      pending_patch: { key: "local-1:patch:7", generation: 7, base_revision: 2, title: "Latest", content: "Body", source: "manual" },
      next_patch_generation: 8,
    });
    const controller = new NoteDraftController(store);
    const update = vi.fn(async (_id: string, input: { title: string; content: string }, options?: { idempotencyKey?: string }) => {
      expect(options).toEqual({ idempotencyKey: "local-1:patch:7" });
      return serverNote({ id: "server-1", revision: 3, ...input });
    });

    const result = await controller.sync("ws-1", "local-1", {
      create: vi.fn(),
      update,
    });
    expect(update).toHaveBeenCalledOnce();
    await expect(controller.reconcile("ws-1", "local-1", result)).resolves.toBe(true);
    expect(await store.getDraft("ws-1", "local-1")).toBeNull();
  });

  it("replays a lost PATCH payload before sending edits made during the request", async () => {
    const store = createStore();
    await store.saveDraft({
      workspace_id: "ws-1",
      entity_id: "local-1",
      title: "Latest",
      content: "Latest body",
      updated_at: "2026-08-22T00:03:00.000Z",
      server_note_id: "server-1",
      server_revision: 1,
      server_updated_at: "2026-08-22T00:01:00.000Z",
      server_note: serverNote({ id: "server-1", revision: 1 }),
      pending_patch: { key: "local-1:patch:1", generation: 1, base_revision: 1, title: "Initial", content: "Initial body", source: "manual" },
      next_patch_generation: 2,
    });
    const controller = new NoteDraftController(store);
    const update = vi.fn()
      .mockImplementationOnce(async (_id: string, input: { title: string; content: string }, options?: { idempotencyKey?: string }) => {
        expect(input).toEqual(expect.objectContaining({ title: "Initial", content: "Initial body", base_revision: 1 }));
        expect(options).toEqual({ idempotencyKey: "local-1:patch:1" });
        return serverNote({ id: "server-1", title: "Initial", content: "Initial body", revision: 2 });
      })
      .mockImplementationOnce(async (_id: string, input: { title: string; content: string }, options?: { idempotencyKey?: string }) => {
        expect(input).toEqual(expect.objectContaining({ title: "Latest", content: "Latest body", base_revision: 2 }));
        expect(options).toEqual({ idempotencyKey: "local-1:patch:2" });
        return serverNote({ id: "server-1", title: "Latest", content: "Latest body", revision: 3 });
      });

    const result = await controller.sync("ws-1", "local-1", { create: vi.fn(), update });
    expect(update).toHaveBeenCalledTimes(2);
    await expect(controller.reconcile("ws-1", "local-1", result)).resolves.toBe(true);
    expect(await store.getDraft("ws-1", "local-1")).toBeNull();
  });

  it("sends edits made during PATCH before tombstoning the local draft", async () => {
    const store = createStore();
    const controller = new NoteDraftController(store, { createId: () => "local-1" });
    await controller.create("ws-1");
    await controller.save("ws-1", "local-1", "initial", "initial content");
    let releasePatch!: () => void;
    const patchBlocked = new Promise<void>((resolve) => { releasePatch = resolve; });
    const update = vi.fn()
      .mockImplementationOnce(async () => { await patchBlocked; return serverNote({ revision: 2 }); })
      .mockImplementationOnce(async (_id: string, input: { title: string; content: string }) => serverNote({ ...input, revision: 3 }));
    const client = {
      create: vi.fn(async () => serverNote()),
      update,
    };
    const syncing = controller.sync("ws-1", "local-1", client);
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    await controller.save("ws-1", "local-1", "latest", "content");
    releasePatch();

    const result = await syncing;
    expect(update.mock.calls[1]?.[1]).toMatchObject({ title: "latest", content: "content" });
    await expect(controller.reconcile("ws-1", "local-1", result)).resolves.toBe(true);
    expect(await store.getDraft("ws-1", "local-1")).toBeNull();
  });

  it("does not let one draft's in-flight sync block another draft", async () => {
    const store = createStore();
    const controller = new NoteDraftController(store, { createId: (() => { let index = 0; return () => `local-${++index}`; })() });
    await controller.create("ws-1");
    await controller.create("ws-1");
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const client = {
      create: vi.fn(async (input: { title: string; content: string }, options?: { idempotencyKey?: string }) => {
        if (options?.idempotencyKey === "local-1") await firstBlocked;
        return serverNote({ id: options?.idempotencyKey === "local-1" ? "server-1" : "server-2", title: input.title, content: input.content });
      }),
      update: vi.fn(async (_id: string, input: { title: string; content: string }) => serverNote(input)),
    };

    const first = controller.sync("ws-1", "local-1", client);
    await expect(controller.sync("ws-1", "local-2", client)).resolves.toMatchObject({ id: "server-2" });
    releaseFirst();
    await expect(first).resolves.toMatchObject({ id: "server-1" });
  });

  it("retries local deletion after failure without issuing another POST", async () => {
    let removeAttempts = 0;
    const baseStore = createStore();
    const originalRemoveDraft = baseStore.removeDraft.getMockImplementation()!;
    baseStore.removeDraft.mockImplementation(async (workspaceId: string, entityId: string) => {
      removeAttempts += 1;
      if (removeAttempts === 1) throw new Error("delete failed");
      await originalRemoveDraft(workspaceId, entityId);
    });
    const store = baseStore;
    const controller = new NoteDraftController(store, { createId: () => "local-1" });
    await controller.create("ws-1");
    const create = vi.fn(async () => serverNote());
    const update = vi.fn(async (_id: string, input: { title: string; content: string }) => serverNote(input));

    const result = await controller.sync("ws-1", "local-1", { create, update });
    await expect(controller.reconcile("ws-1", "local-1", result)).rejects.toThrow("delete failed");
    const resumed = new NoteDraftController(baseStore);
    const resumedResult = await resumed.sync("ws-1", "local-1", { create, update });
    await expect(resumed.reconcile("ws-1", "local-1", resumedResult)).resolves.toBe(true);
    expect(create).toHaveBeenCalledOnce();
  });

  it("quiesces before queued writes finish, rejects new lifecycle starts, and resumes safely", async () => {
    const store = createStore();
    const controller = new NoteDraftController(store, { createId: () => "local-1" });
    await controller.create("ws-1");
    const mutate = store.mutateDraft.getMockImplementation()!;
    let releaseWrite!: () => void;
    const writeBlocked = new Promise<void>((resolve) => { releaseWrite = resolve; });
    store.mutateDraft.mockImplementationOnce(async (...args: Parameters<typeof mutate>) => {
      await writeBlocked;
      return mutate(...args);
    });

    const saving = controller.save("ws-1", "local-1", "queued", "queued body");
    const quiescing = controller.quiesce();
    let drained = false;
    void quiescing.then(() => { drained = true; });
    await Promise.resolve();

    expect(drained).toBe(false);
    await expect(controller.create("ws-1")).rejects.toMatchObject({ code: "DRAFT_CONTROLLER_QUIESCED" });
    await expect(controller.save("ws-1", "local-1", "late", "late body")).rejects.toMatchObject({ code: "DRAFT_CONTROLLER_QUIESCED" });
    await expect(controller.sync("ws-1", "local-1", { create: vi.fn(), update: vi.fn() })).rejects.toMatchObject({ code: "DRAFT_CONTROLLER_QUIESCED" });
    await expect(controller.reconcile("ws-1", "local-1")).rejects.toMatchObject({ code: "DRAFT_CONTROLLER_QUIESCED" });
    await expect(controller.recover("ws-1")).rejects.toMatchObject({ code: "DRAFT_CONTROLLER_QUIESCED" });

    releaseWrite();
    await saving;
    await quiescing;
    expect(await store.getDraft("ws-1", "local-1")).toMatchObject({ title: "queued", content: "queued body" });

    controller.resume();
    await expect(controller.save("ws-1", "local-1", "resumed", "resumed body")).resolves.toMatchObject({ title: "resumed" });
  });

  it("waits for an in-flight sync lifecycle before quiesce resolves", async () => {
    const store = createStore();
    const controller = new NoteDraftController(store, { createId: () => "local-1" });
    await controller.create("ws-1");
    let releaseCreate!: () => void;
    const createBlocked = new Promise<void>((resolve) => { releaseCreate = resolve; });
    const syncing = controller.sync("ws-1", "local-1", {
      create: vi.fn(async () => {
        await createBlocked;
        return serverNote();
      }),
      update: vi.fn(async (_id: string, input: { title: string; content: string }) => serverNote(input)),
    });
    await vi.waitFor(async () => expect(store.getDraft).toHaveBeenCalled());
    const quiescing = controller.quiesce();
    let drained = false;
    void quiescing.then(() => { drained = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(drained).toBe(false);

    releaseCreate();
    await syncing;
    await quiescing;
    expect(drained).toBe(true);
  });

  it("waits for an in-flight recovery read before quiesce resolves", async () => {
    const store = createStore();
    let releaseList!: () => void;
    const listBlocked = new Promise<void>((resolve) => { releaseList = resolve; });
    store.listDrafts.mockImplementationOnce(async () => {
      await listBlocked;
      return [];
    });
    const controller = new NoteDraftController(store);
    const recovering = controller.recover("ws-1");
    await vi.waitFor(() => expect(store.listDrafts).toHaveBeenCalledOnce());
    const quiescing = controller.quiesce();
    let drained = false;
    void quiescing.then(() => { drained = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(drained).toBe(false);

    releaseList();
    await recovering;
    await quiescing;
    expect(drained).toBe(true);
  });
});
