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
    expect(result.current.noteTagsSaving).toBe(false);
  });

  it("does not surface an old note mutation failure on the newly selected note", async () => {
    const save = deferred<{ updated: true }>();
    const api = clients({ setNoteTags: vi.fn(() => save.promise) });
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
    let request!: Promise<boolean>;
    act(() => { request = result.current.saveTags("note-old", ["tag-old"]); });
    rerender({ selectedNoteId: "note-new" });
    save.reject(new Error("old note offline"));
    await expect(request).resolves.toBe(false);
    await waitFor(() => {
      expect(result.current.noteTagsError).toBeNull();
      expect(result.current.noteTagsSaving).toBe(false);
    });
  });

  it("does not apply an old note link mutation after selection changes", async () => {
    const save = deferred<{ updated: true }>();
    const api = clients({ setNoteLinks: vi.fn(() => save.promise) });
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
    let request!: Promise<boolean>;
    act(() => { request = result.current.saveLinks("note-old", ["old-target"]); });
    rerender({ selectedNoteId: "note-new" });
    save.resolve({ updated: true });
    await expect(request).resolves.toBe(false);
    await waitFor(() => expect(result.current.linkedNoteIds).toEqual([]));
  });

  it("does not let an old tag callback write after the workspace or role changes", async () => {
    const api = clients();
    const initialProps = { workspaceId: "ws-1", selectedNoteId: "note-1", role: "editor" as const, logoutPending: false };
    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useNoteInspectorData({
        knowledgeClient: api.knowledge as never,
        databaseClient: api.databases as never,
        notesClient: api.notes as never,
        ...props,
        creatingNote: false,
      }),
      { initialProps },
    );
    const staleSave = result.current.saveTags;

    rerender({ ...initialProps, workspaceId: "ws-2", selectedNoteId: "note-2", role: "viewer", logoutPending: true });
    await act(async () => { await staleSave("note-1", ["tag-old"]); });

    expect(api.knowledge.setNoteTags).not.toHaveBeenCalled();
  });

  it("passes abort signals to tag and link writes and aborts them on unmount", async () => {
    const tagSave = deferred<{ updated: true }>();
    const linkSave = deferred<{ updated: true }>();
    let tagSignal: AbortSignal | undefined;
    let linkSignal: AbortSignal | undefined;
    const api = clients({
      setNoteTags: vi.fn((_noteId: string, _input: unknown, signal?: AbortSignal) => { tagSignal = signal; return tagSave.promise; }),
      setNoteLinks: vi.fn((_noteId: string, _input: unknown, signal?: AbortSignal) => { linkSignal = signal; return linkSave.promise; }),
    });
    const { result, unmount } = renderHook(() => useNoteInspectorData({
      knowledgeClient: api.knowledge as never,
      databaseClient: api.databases as never,
      notesClient: api.notes as never,
      workspaceId: "ws-1",
      selectedNoteId: "note-1",
      creatingNote: false,
      role: "editor",
      logoutPending: false,
    }));

    let tags!: Promise<boolean>;
    let links!: Promise<boolean>;
    act(() => {
      tags = result.current.saveTags("note-1", ["tag-new"]);
      links = result.current.saveLinks("note-1", ["note-target"]);
    });
    await waitFor(() => {
      expect(tagSignal).toBeInstanceOf(AbortSignal);
      expect(linkSignal).toBeInstanceOf(AbortSignal);
    });
    unmount();
    tagSave.resolve({ updated: true });
    linkSave.resolve({ updated: true });
    await Promise.all([tags, links]);

    expect(tagSignal?.aborted).toBe(true);
    expect(linkSignal?.aborted).toBe(true);
  });

  it("does not report stale tag or link successes after the note scope changes", async () => {
    const tagSave = deferred<{ updated: true }>();
    const linkSave = deferred<{ updated: true }>();
    const api = clients({
      setNoteTags: vi.fn(() => tagSave.promise),
      setNoteLinks: vi.fn(() => linkSave.promise),
    });
    const initialProps = { workspaceId: "ws-1", selectedNoteId: "note-1", role: "editor" as const, logoutPending: false };
    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useNoteInspectorData({
        knowledgeClient: api.knowledge as never,
        databaseClient: api.databases as never,
        notesClient: api.notes as never,
        ...props,
        creatingNote: false,
      }),
      { initialProps },
    );
    let tags!: Promise<boolean>;
    let links!: Promise<boolean>;
    act(() => {
      tags = result.current.saveTags("note-1", ["tag-new"]);
      links = result.current.saveLinks("note-1", ["note-target"]);
    });
    rerender({ ...initialProps, selectedNoteId: "note-2" });
    tagSave.resolve({ updated: true });
    linkSave.resolve({ updated: true });

    await expect(tags).resolves.toBe(false);
    await expect(links).resolves.toBe(false);
  });

  it("clears tag and link saving state after current-scope writes finish", async () => {
    const api = clients();
    const { result } = renderHook(() => useNoteInspectorData({
      knowledgeClient: api.knowledge as never,
      databaseClient: api.databases as never,
      notesClient: api.notes as never,
      workspaceId: "ws-1",
      selectedNoteId: "note-1",
      creatingNote: false,
      role: "editor",
      logoutPending: false,
    }));

    let tags!: Promise<boolean>;
    let links!: Promise<boolean>;
    act(() => {
      tags = result.current.saveTags("note-1", ["tag-new"]);
      links = result.current.saveLinks("note-1", ["note-target"]);
    });
    await expect(tags).resolves.toBe(true);
    await expect(links).resolves.toBe(true);
    await waitFor(() => {
      expect(result.current.noteTagsSaving).toBe(false);
      expect(result.current.noteLinksSaving).toBe(false);
    });
  });

  it("clears link saving state after a current-scope write fails", async () => {
    const api = clients({
      setNoteLinks: vi.fn(() => Promise.reject(new Error("link write failed"))),
    });
    const { result } = renderHook(() => useNoteInspectorData({
      knowledgeClient: api.knowledge as never,
      databaseClient: api.databases as never,
      notesClient: api.notes as never,
      workspaceId: "ws-1",
      selectedNoteId: "note-1",
      creatingNote: false,
      role: "editor",
      logoutPending: false,
    }));

    let save!: Promise<boolean>;
    act(() => {
      save = result.current.saveLinks("note-1", ["note-target"]);
    });

    await expect(save).resolves.toBe(false);
    await waitFor(() => {
      expect(result.current.noteLinksSaving).toBe(false);
      expect(result.current.noteLinksError).toBe("笔记链接保存失败，请重试。当前选择已保留。");
    });
  });

  it("does not let an old link callback write after logout begins", async () => {
    const api = clients();
    const initialProps = { workspaceId: "ws-1", selectedNoteId: "note-1", role: "editor" as const, logoutPending: false };
    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useNoteInspectorData({
        knowledgeClient: api.knowledge as never,
        databaseClient: api.databases as never,
        notesClient: api.notes as never,
        ...props,
        creatingNote: false,
      }),
      { initialProps },
    );
    const staleSave = result.current.saveLinks;
    rerender({ ...initialProps, logoutPending: true });

    await act(async () => { await staleSave("note-1", ["note-target"]); });

    expect(api.knowledge.setNoteLinks).not.toHaveBeenCalled();
  });

  it("does not let an old create-tag callback write after the note scope changes", async () => {
    const api = clients();
    const initialProps = { workspaceId: "ws-1", selectedNoteId: "note-1", role: "editor" as const, logoutPending: false };
    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useNoteInspectorData({
        knowledgeClient: api.knowledge as never,
        databaseClient: api.databases as never,
        notesClient: api.notes as never,
        ...props,
        creatingNote: false,
      }),
      { initialProps },
    );
    const staleCreate = result.current.createTag;
    rerender({ ...initialProps, selectedNoteId: "note-2" });

    await expect(staleCreate("Old tag")).rejects.toMatchObject({ name: "AbortError" });

    expect(api.knowledge.createTag).not.toHaveBeenCalled();
  });

  it("silences a non-abort create-tag failure after the note scope changes", async () => {
    const save = deferred<{ tag: any }>();
    const api = clients({ createTag: vi.fn(() => save.promise) });
    const initialProps = { workspaceId: "ws-1", selectedNoteId: "note-1", role: "editor" as const, logoutPending: false };
    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useNoteInspectorData({
        knowledgeClient: api.knowledge as never,
        databaseClient: api.databases as never,
        notesClient: api.notes as never,
        ...props,
        creatingNote: false,
      }),
      { initialProps },
    );
    let request!: Promise<unknown>;
    act(() => { request = result.current.createTag("Old tag"); });
    rerender({ ...initialProps, selectedNoteId: "note-2" });
    save.reject(new Error("old scope failure"));

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not let an old tag failure roll back a new request after an A-B-A scope cycle", async () => {
    const firstSave = deferred<{ updated: true }>();
    const secondSave = deferred<{ updated: true }>();
    const api = clients({
      setNoteTags: vi.fn()
        .mockImplementationOnce(() => firstSave.promise)
        .mockImplementationOnce(() => secondSave.promise),
    });
    const initialProps = { workspaceId: "ws-1", selectedNoteId: "note-a", role: "editor" as const, logoutPending: false };
    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useNoteInspectorData({
        knowledgeClient: api.knowledge as never,
        databaseClient: api.databases as never,
        notesClient: api.notes as never,
        ...props,
        creatingNote: false,
      }),
      { initialProps },
    );

    let first!: Promise<boolean>;
    act(() => { first = result.current.saveTags("note-a", ["tag-old"]); });
    rerender({ ...initialProps, selectedNoteId: "note-b" });
    rerender(initialProps);
    let second!: Promise<boolean>;
    act(() => { second = result.current.saveTags("note-a", ["tag-new"]); });
    firstSave.reject(new Error("old failure"));
    await expect(first).resolves.toBe(false);
    expect(result.current.noteTagIds["note-a"]).toEqual(["tag-new"]);
    secondSave.resolve({ updated: true });
    await expect(second).resolves.toBe(true);
  });

  it("does not let an old link finally clear a new request after an A-B-A scope cycle", async () => {
    const firstSave = deferred<{ updated: true }>();
    const secondSave = deferred<{ updated: true }>();
    const api = clients({
      setNoteLinks: vi.fn()
        .mockImplementationOnce(() => firstSave.promise)
        .mockImplementationOnce(() => secondSave.promise),
    });
    const initialProps = { workspaceId: "ws-1", selectedNoteId: "note-a", role: "editor" as const, logoutPending: false };
    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useNoteInspectorData({
        knowledgeClient: api.knowledge as never,
        databaseClient: api.databases as never,
        notesClient: api.notes as never,
        ...props,
        creatingNote: false,
      }),
      { initialProps },
    );

    let first!: Promise<boolean>;
    act(() => { first = result.current.saveLinks("note-a", ["old-target"]); });
    rerender({ ...initialProps, selectedNoteId: "note-b" });
    rerender(initialProps);
    let second!: Promise<boolean>;
    act(() => { second = result.current.saveLinks("note-a", ["new-target"]); });
    firstSave.resolve({ updated: true });
    await expect(first).resolves.toBe(false);
    expect(result.current.noteLinksSaving).toBe(true);
    secondSave.resolve({ updated: true });
    await expect(second).resolves.toBe(true);
  });
});
