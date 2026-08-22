import { describe, expect, it, vi } from "vitest";
import type { LocalDraft } from "../src/data/local-store";
import { NoteDraftController } from "../src/notes/note-draft-controller";

function createStore(overrides: Partial<{
  saveDraft(draft: LocalDraft): Promise<void>;
  getDraft(workspaceId: string, entityId: string): Promise<LocalDraft | null>;
  listDrafts(workspaceId: string): Promise<LocalDraft[]>;
  removeDraft(workspaceId: string, entityId: string): Promise<void>;
}> = {}) {
  const drafts = new Map<string, LocalDraft>();
  return {
    saveDraft: vi.fn(async (draft: LocalDraft) => { drafts.set(`${draft.workspace_id}:${draft.entity_id}`, { ...draft }); }),
    getDraft: vi.fn(async (workspaceId: string, entityId: string) => drafts.get(`${workspaceId}:${entityId}`) ?? null),
    listDrafts: vi.fn(async (workspaceId: string) => [...drafts.values()].filter((draft) => draft.workspace_id === workspaceId)),
    removeDraft: vi.fn(async (workspaceId: string, entityId: string) => { drafts.delete(`${workspaceId}:${entityId}`); }),
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
  it("serializes a three-save interleaving through one unconditional queue tail", async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let firstStarted!: () => void;
    let secondStarted!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondBlocked = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const writes: string[] = [];
    const store = createStore({
      saveDraft: vi.fn(async (draft: LocalDraft) => {
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
      }),
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
    const store = createStore({ saveDraft });
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
    const store = createStore({
      saveDraft: vi.fn(async () => {
        calls.push("save:start");
        await new Promise<void>((resolve) => { releaseSave = resolve; });
        calls.push("save:finish");
      }),
      removeDraft: vi.fn(async () => { calls.push("remove"); }),
    });
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
    const store = createStore({
      saveDraft: vi.fn(async (draft: LocalDraft) => {
        writes.push(`save:${draft.title}`);
        if (draft.title === "before") await firstBlocked;
      }),
      removeDraft: vi.fn(async () => { writes.push("remove"); }),
    });
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
    const store = {
      ...baseStore,
      saveDraft: vi.fn(async (draft: LocalDraft) => {
        await baseStore.saveDraft(draft);
        if (draft.server_note_id) {
          identitySaveStarted();
          await identityBlocked;
        }
      }),
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
    const resumedUpdate = vi.fn(async (_id: string, input: { title: string; content: string }) => serverNote(input));
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
    const store = {
      ...baseStore,
      removeDraft: vi.fn(async () => {
        removeAttempts += 1;
        if (removeAttempts === 1) throw new Error("delete failed");
        await baseStore.removeDraft("ws-1", "local-1");
      }),
    };
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
});
