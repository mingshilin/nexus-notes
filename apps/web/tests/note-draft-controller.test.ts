import { describe, expect, it, vi } from "vitest";
import type { LocalDraft } from "../src/data/local-store";
import { NoteDraftController } from "../src/notes/note-draft-controller";

function createStore(overrides: Partial<{
  saveDraft(draft: LocalDraft): Promise<void>;
  listDrafts(workspaceId: string): Promise<LocalDraft[]>;
  removeDraft(workspaceId: string, entityId: string): Promise<void>;
}> = {}) {
  return {
    saveDraft: vi.fn(async () => undefined),
    listDrafts: vi.fn(async () => []),
    removeDraft: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("NoteDraftController", () => {
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
    const controller = new NoteDraftController(store);

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
    await Promise.resolve();

    expect(writes).toEqual(["start:first"]);
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
    await Promise.resolve();
    expect(calls).toEqual(["save:start"]);

    releaseSave();
    await reconciling;

    expect(calls).toEqual(["save:start", "save:finish", "remove"]);
    expect(store.removeDraft).toHaveBeenCalledWith("ws-1", "local-1");
  });
});
