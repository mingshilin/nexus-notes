import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useNoteInspectorData } from "../src/app/use-note-inspector-data";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; });
  return { promise, resolve, reject };
}

function clients(overrides: Record<string, unknown> = {}) {
  const knowledge = {
    listFolders: vi.fn(async () => []),
    listTags: vi.fn(async () => []),
    listNoteTags: vi.fn(async () => []),
    listNoteLinks: vi.fn(async () => []),
    listBacklinks: vi.fn(async () => []),
    createFolder: vi.fn(async ({ name }: { name: string }) => ({ id: `folder-${name}`, name, position: 0 })),
    createTag: vi.fn(async ({ name }: { name: string }) => ({ id: `tag-${name}`, name, color: "" })),
    setNoteTags: vi.fn(async () => ({ updated: true })),
    setNoteLinks: vi.fn(async () => ({ updated: true })),
    ...overrides,
  };
  return {
    knowledge,
    databases: { listDatabases: vi.fn(async () => []) },
    notes: { listRevisions: vi.fn(async () => []) },
  };
}

describe("useNoteInspectorData", () => {
  it("ignores late folders and tags from the previous workspace", async () => {
    const oldFolders = deferred<any[]>();
    const oldTags = deferred<any[]>();
    const oldClients = clients({ listFolders: vi.fn(() => oldFolders.promise), listTags: vi.fn(() => oldTags.promise) });
    const newClients = clients({
      listFolders: vi.fn(async () => [{ id: "folder-new", name: "New", position: 0 }]),
      listTags: vi.fn(async () => [{ id: "tag-new", name: "New", color: "" }]),
    });
    const initialProps = { clients: oldClients, workspaceId: "ws-old", selectedNoteId: null, creatingNote: false };
    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useNoteInspectorData({
        knowledgeClient: props.clients.knowledge as never,
        databaseClient: props.clients.databases as never,
        notesClient: props.clients.notes as never,
        workspaceId: props.workspaceId,
        selectedNoteId: props.selectedNoteId,
        creatingNote: props.creatingNote,
      }),
      { initialProps },
    );
    await waitFor(() => expect(oldClients.knowledge.listFolders).toHaveBeenCalledOnce());
    rerender({ ...initialProps, clients: newClients, workspaceId: "ws-new" });
    await waitFor(() => expect(result.current.folders[0]?.id).toBe("folder-new"));
    await act(async () => {
      oldFolders.resolve([{ id: "folder-old", name: "Old", position: 0 }]);
      oldTags.resolve([{ id: "tag-old", name: "Old", color: "" }]);
      await Promise.all([oldFolders.promise, oldTags.promise]);
    });
    expect(result.current.folders.map((item) => item.id)).toEqual(["folder-new"]);
    expect(result.current.tags.map((item) => item.id)).toEqual(["tag-new"]);
  });

  it("keeps the new note links when an old selection resolves late", async () => {
    const oldLinks = deferred<any[]>();
    const api = clients({
      listNoteLinks: vi.fn((noteId: string) => noteId === "note-old" ? oldLinks.promise : Promise.resolve([{ target_note_id: "note-new-target" }])),
      listBacklinks: vi.fn(async (noteId: string) => noteId === "note-new" ? [{ id: "backlink-new" }] : []),
      listNoteTags: vi.fn(async () => []),
    });
    const initialProps = { selectedNoteId: "note-old" };
    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useNoteInspectorData({
        knowledgeClient: api.knowledge as never,
        databaseClient: api.databases as never,
        notesClient: api.notes as never,
        workspaceId: "ws-1",
        selectedNoteId: props.selectedNoteId,
        creatingNote: false,
      }),
      { initialProps },
    );
    await waitFor(() => expect(api.knowledge.listNoteLinks).toHaveBeenCalledWith("note-old", expect.any(AbortSignal)));
    rerender({ selectedNoteId: "note-new" });
    await waitFor(() => expect(result.current.linkedNoteIds).toEqual(["note-new-target"]));
    oldLinks.resolve([{ target_note_id: "note-old-target" }]);
    await oldLinks.promise;
    expect(result.current.linkedNoteIds).toEqual(["note-new-target"]);
    expect(result.current.backlinks).toEqual([{ id: "backlink-new" }]);
  });

  it("rolls an optimistic tag update back after a failed save", async () => {
    const save = deferred<{ updated: true }>();
    const api = clients({
      listNoteTags: vi.fn(async () => [{ id: "tag-old", name: "Old", color: "" }]),
      setNoteTags: vi.fn(() => save.promise),
    });
    const { result } = renderHook(() => useNoteInspectorData({
      knowledgeClient: api.knowledge as never,
      databaseClient: api.databases as never,
      notesClient: api.notes as never,
      workspaceId: "ws-1",
      selectedNoteId: "note-1",
      creatingNote: false,
    }));
    await waitFor(() => expect(result.current.noteTagIds["note-1"]).toEqual(["tag-old"]));
    let request!: Promise<boolean>;
    act(() => { request = result.current.saveTags("note-1", ["tag-new"]); });
    expect(result.current.noteTagIds["note-1"]).toEqual(["tag-new"]);
    save.reject(new Error("offline"));
    await expect(request).resolves.toBe(false);
    await waitFor(() => expect(result.current.noteTagIds["note-1"]).toEqual(["tag-old"]));
    expect(result.current.noteTagsError).toContain("恢复");
  });
});
