import { act, renderHook } from "@testing-library/react";
import type { Note } from "@nexus/contracts";
import { describe, expect, it, vi } from "vitest";

import { useNoteMutations } from "../src/app/use-note-mutations";
import { ApiClientError } from "../src/data/api-client";

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    workspace_id: "ws-1",
    folder_id: null,
    database_id: null,
    created_by: "user-1",
    updated_by: "user-1",
    title: "Server title",
    content: "Server content",
    status: "active",
    is_favorite: false,
    is_pinned: false,
    daily_date: null,
    revision: 3,
    created_at: "2026-08-29T00:00:00.000Z",
    updated_at: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup(options: {
  selectedNote?: Note;
  draft?: { title: string; content: string; folderId: string | null; databaseId: string | null };
  update?: ReturnType<typeof vi.fn>;
  deletePermanently?: ReturnType<typeof vi.fn>;
} = {}) {
  const selectedNote = options.selectedNote ?? note();
  const draft = options.draft ?? {
    title: selectedNote.title,
    content: selectedNote.content,
    folderId: selectedNote.folder_id,
    databaseId: selectedNote.database_id,
  };
  const update = options.update ?? vi.fn(async () => note({ ...selectedNote, revision: selectedNote.revision + 1 }));
  const deletePermanently = options.deletePermanently ?? vi.fn(async () => ({ deleted: true as const }));
  const installNote = vi.fn();
  const selectListView = vi.fn();
  const completeStatusChange = vi.fn();
  const completePermanentDelete = vi.fn();
  const input = {
    notesClient: { update, deletePermanently } as never,
    workspaceId: "ws-1",
    role: "editor",
    logoutPending: false,
    selectedNote,
    draft,
    installNote,
    selectListView,
    completeStatusChange,
    completePermanentDelete,
  };
  const hook = renderHook((value) => useNoteMutations(value), { initialProps: input });
  return {
    ...hook,
    input,
    selectedNote,
    draft,
    update,
    deletePermanently,
    installNote,
    selectListView,
    completeStatusChange,
    completePermanentDelete,
  };
}

describe("useNoteMutations", () => {
  it("keeps the supplied draft retryable after a failed save", async () => {
    const draft = {
      title: "Unsaved title",
      content: "Unsaved content",
      folderId: "folder-draft",
      databaseId: "database-draft",
    };
    const update = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(note({
        title: draft.title,
        content: draft.content,
        folder_id: draft.folderId,
        database_id: draft.databaseId,
        revision: 4,
      }));
    const { result, installNote } = setup({ draft, update });

    await act(async () => { await result.current.saveExistingNote(); });

    expect(draft).toEqual({
      title: "Unsaved title",
      content: "Unsaved content",
      folderId: "folder-draft",
      databaseId: "database-draft",
    });
    expect(installNote).not.toHaveBeenCalled();
    expect(result.current.noteError).toBe("笔记保存失败，请稍后重试。未保存的内容仍保留在当前编辑器中。");
    expect(result.current.noteSaving).toBe(false);

    await act(async () => { await result.current.saveExistingNote(); });
    expect(update).toHaveBeenCalledTimes(2);
    expect(installNote).toHaveBeenCalledOnce();
  });

  it("installs a successful save exactly once and reports it as saved", async () => {
    const saved = note({ title: "Saved", content: "Saved body", revision: 4 });
    const update = vi.fn(async () => saved);
    const { result, installNote } = setup({
      draft: { title: "Saved", content: "Saved body", folderId: null, databaseId: null },
      update,
    });

    await act(async () => { await result.current.saveExistingNote(); });

    expect(installNote).toHaveBeenCalledTimes(1);
    expect(installNote).toHaveBeenCalledWith(saved);
    expect(result.current.noteMessage).toBe("已保存");
    expect(result.current.noteError).toBeNull();
  });

  it("passes dirty draft fields when changing status and selects the matching list view", async () => {
    const selectedNote = note();
    const saved = note({
      title: "Dirty title",
      content: "Dirty content",
      folder_id: "folder-new",
      database_id: "database-new",
      status: "archived",
      revision: 4,
    });
    const update = vi.fn(async () => saved);
    const { result, installNote, selectListView, completeStatusChange } = setup({
      selectedNote,
      draft: {
        title: saved.title,
        content: saved.content,
        folderId: saved.folder_id,
        databaseId: saved.database_id,
      },
      update,
    });

    await act(async () => { await result.current.changeSelectedNoteStatus("archived"); });

    expect(update).toHaveBeenCalledWith("note-1", {
      base_revision: 3,
      status: "archived",
      source: "manual",
      title: "Dirty title",
      content: "Dirty content",
      folder_id: "folder-new",
      database_id: "database-new",
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(selectListView).toHaveBeenCalledOnce();
    expect(selectListView).toHaveBeenCalledWith("archived");
    expect(installNote).toHaveBeenCalledOnce();
    expect(completeStatusChange).toHaveBeenCalledOnce();
  });

  it.each(["is_favorite", "is_pinned"] as const)("prevents duplicate %s mutations while pending", async (field) => {
    const request = deferred<Note>();
    const update = vi.fn(() => request.promise);
    const saved = note({ [field]: true, revision: 4 });
    const { result, installNote } = setup({ update });

    let first!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => {
      first = result.current.toggleSelectedNoteFlag(field);
      duplicate = result.current.toggleSelectedNoteFlag(field);
    });

    expect(update).toHaveBeenCalledOnce();
    await act(async () => {
      request.resolve(saved);
      await Promise.all([first, duplicate]);
    });
    expect(installNote).toHaveBeenCalledOnce();
  });

  it("keeps a failed permanent delete retryable without clearing the selected note", async () => {
    const selectedNote = note({ status: "trashed" });
    const deletePermanently = vi.fn()
      .mockRejectedValueOnce({ code: "NETWORK_ERROR", retryable: true, request_id: "req-delete-1" })
      .mockResolvedValueOnce({ deleted: true as const });
    let selectedNoteId: string | null = selectedNote.id;
    const { result, completePermanentDelete } = setup({ selectedNote, deletePermanently });
    completePermanentDelete.mockImplementation(() => { selectedNoteId = null; });

    await act(async () => { await result.current.deleteSelectedNotePermanently(); });

    expect(selectedNoteId).toBe("note-1");
    expect(completePermanentDelete).not.toHaveBeenCalled();
    expect(result.current.permanentDeleteError).toBe("网络或服务暂时不可用。笔记仍保留在回收站中，可安全重试。 请求 ID：req-delete-1");
    expect(result.current.permanentDeletePending).toBe(false);

    await act(async () => { await result.current.deleteSelectedNotePermanently(); });
    expect(deletePermanently).toHaveBeenCalledTimes(2);
    expect(completePermanentDelete).toHaveBeenCalledOnce();
    expect(completePermanentDelete).toHaveBeenCalledWith("note-1");
    expect(selectedNoteId).toBeNull();
  });

  it("ignores a late save after another note is selected", async () => {
    const request = deferred<Note>();
    const update = vi.fn(() => request.promise);
    const first = note({ id: "note-1", title: "First", revision: 3 });
    const second = note({ id: "note-2", title: "Second", revision: 1 });
    const { result, rerender, input, installNote } = setup({ selectedNote: first, update });
    let pending!: Promise<void>;

    act(() => { pending = result.current.saveExistingNote(); });
    expect(update).toHaveBeenCalledOnce();
    rerender({
      ...input,
      selectedNote: second,
      draft: { title: second.title, content: second.content, folderId: second.folder_id, databaseId: second.database_id },
    });
    await act(async () => {
      request.resolve(note({ id: "note-1", title: "First saved", revision: 4 }));
      await pending;
    });

    expect(installNote).not.toHaveBeenCalled();
    expect(result.current.noteMessage).toBeNull();
    expect(result.current.noteError).toBeNull();
    expect(result.current.noteSaving).toBe(false);
  });

  it("does not let an old save callback write after the workspace changes", async () => {
    const update = vi.fn(async () => note({ revision: 4 }));
    const first = note({ id: "note-1", workspace_id: "ws-1" });
    const { result, rerender, input } = setup({ selectedNote: first, update });
    const staleSave = result.current.saveExistingNote;

    rerender({
      ...input,
      workspaceId: "ws-2",
      selectedNote: note({ id: "note-2", workspace_id: "ws-2" }),
    });
    await act(async () => { await staleSave(); });

    expect(update).not.toHaveBeenCalled();
  });

  it("does not let an old save callback submit a superseded draft", async () => {
    const update = vi.fn(async () => note({ revision: 4 }));
    const { result, rerender, input } = setup({ update });
    const staleSave = result.current.saveExistingNote;

    rerender({
      ...input,
      draft: { title: "New local title", content: "New local content", folderId: null, databaseId: null },
    });
    await act(async () => { await staleSave(); });

    expect(update).not.toHaveBeenCalled();
  });

  it("uses a replacement notes client for the current mutation scope", async () => {
    const replacementSaved = note({ title: "Replacement client save", revision: 4 });
    const replacementClient = {
      update: vi.fn(async () => replacementSaved),
      deletePermanently: vi.fn(async () => ({ deleted: true as const })),
    };
    const { result, rerender, input, update: originalUpdate, installNote } = setup();

    rerender({ ...input, notesClient: replacementClient as never });
    await act(async () => { await result.current.saveExistingNote(); });

    expect(originalUpdate).not.toHaveBeenCalled();
    expect(replacementClient.update).toHaveBeenCalledOnce();
    expect(installNote).toHaveBeenCalledWith(replacementSaved);
  });

  it("preserves edits made during a save and advances the retry base revision", async () => {
    const firstRequest = deferred<Note>();
    let firstSignal: AbortSignal | undefined;
    const updatedDraft = { title: "Edited while saving", content: "Newer content", folderId: null, databaseId: null };
    const savedFirst = note({ title: "Initial save", content: "Initial body", revision: 4 });
    const savedSecond = note({ title: updatedDraft.title, content: updatedDraft.content, revision: 5 });
    const update = vi.fn()
      .mockImplementationOnce((_id, _body, options) => {
        firstSignal = options?.signal;
        return firstRequest.promise;
      })
      .mockResolvedValueOnce(savedSecond);
    const { result, rerender, input, installNote } = setup({ update });
    let first!: Promise<void>;

    act(() => { first = result.current.saveExistingNote(); });
    rerender({ ...input, draft: updatedDraft });
    expect(firstSignal?.aborted).toBe(false);
    await act(async () => {
      firstRequest.resolve(savedFirst);
      await first;
    });

    expect(installNote).not.toHaveBeenCalled();
    await act(async () => { await result.current.saveExistingNote(); });
    expect(update).toHaveBeenLastCalledWith("note-1", expect.objectContaining({
      base_revision: 4,
      title: updatedDraft.title,
      content: updatedDraft.content,
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(installNote).toHaveBeenCalledWith(savedSecond);
  });

  it("does not install a flag response over a newer local draft", async () => {
    const request = deferred<Note>();
    const selectedNote = note({ title: "Server title", content: "Server content", revision: 3 });
    const update = vi.fn(() => request.promise);
    const { result, rerender, input, installNote } = setup({ selectedNote, update });
    const newerDraft = { title: "Local title", content: "Local content", folderId: null, databaseId: null };

    let pending!: Promise<void>;
    act(() => { pending = result.current.toggleSelectedNoteFlag("is_favorite"); });
    rerender({ ...input, draft: newerDraft });
    await act(async () => {
      request.resolve(note({ ...selectedNote, is_favorite: true, revision: 4 }));
      await pending;
    });

    expect(installNote).not.toHaveBeenCalled();
    expect(result.current.noteMessage).toBeNull();
  });

  it("does not complete a permanent delete after the selected note changes", async () => {
    const request = deferred<{ deleted: true }>();
    const deleted = note({ id: "delete-1", status: "trashed", revision: 4 });
    const replacement = note({ id: "note-2", title: "Replacement", revision: 1 });
    const deletePermanently = vi.fn(() => request.promise);
    const { result, rerender, input, completePermanentDelete } = setup({ selectedNote: deleted, deletePermanently });
    let pending!: Promise<void>;

    act(() => { pending = result.current.deleteSelectedNotePermanently(); });
    rerender({
      ...input,
      selectedNote: replacement,
      draft: { title: replacement.title, content: replacement.content, folderId: null, databaseId: null },
    });
    await act(async () => {
      request.resolve({ deleted: true });
      await pending;
    });

    expect(completePermanentDelete).not.toHaveBeenCalled();
    expect(result.current.permanentDeleteError).toBeNull();
    expect(result.current.permanentDeletePending).toBe(false);
  });

  it("uses the latest known server revision when permanently deleting a note", async () => {
    const firstRequest = deferred<Note>();
    const selectedNote = note({ id: "delete-1", status: "trashed", revision: 3 });
    const update = vi.fn(() => firstRequest.promise);
    const deletePermanently = vi.fn(async () => ({ deleted: true as const }));
    const { result, rerender, input } = setup({ selectedNote, update, deletePermanently });
    let save!: Promise<void>;

    act(() => { save = result.current.saveExistingNote(); });
    rerender({ ...input, draft: { title: "New local title", content: "New local content", folderId: null, databaseId: null } });
    await act(async () => {
      firstRequest.resolve(note({ ...selectedNote, title: "Saved remotely", revision: 4 }));
      await save;
    });
    await act(async () => { await result.current.deleteSelectedNotePermanently(); });

    expect(deletePermanently).toHaveBeenCalledWith("delete-1", { base_revision: 4 }, expect.any(AbortSignal));
  });

  it("does not let an old delete callback run after the draft changes", async () => {
    const deletePermanently = vi.fn(async () => ({ deleted: true as const }));
    const { result, rerender, input } = setup({ selectedNote: note({ status: "trashed" }), deletePermanently });
    const staleDelete = result.current.deleteSelectedNotePermanently;

    rerender({ ...input, draft: { title: "Changed locally", content: "Unsaved content", folderId: null, databaseId: null } });
    await act(async () => { await staleDelete(); });

    expect(deletePermanently).not.toHaveBeenCalled();
  });

  it("blocks every note mutation for a viewer", async () => {
    const { result, rerender, input, update, deletePermanently } = setup({ selectedNote: note({ status: "trashed" }) });
    rerender({ ...input, role: "viewer" as const });

    await act(async () => {
      await result.current.saveExistingNote();
      await result.current.changeSelectedNoteStatus("active");
      await result.current.toggleSelectedNoteFlag("is_favorite");
      await result.current.deleteSelectedNotePermanently();
    });

    expect(update).not.toHaveBeenCalled();
    expect(deletePermanently).not.toHaveBeenCalled();
  });

  it("rejects a successful response for another workspace without installing it", async () => {
    const installNote = vi.fn();
    const update = vi.fn(async () => note({ workspace_id: "ws-other", revision: 4 }));
    const selectedNote = note();
    const draft = { title: selectedNote.title, content: selectedNote.content, folderId: null, databaseId: null };
    const input = {
      notesClient: { update, deletePermanently: vi.fn(async () => ({ deleted: true as const })) } as never,
      workspaceId: "ws-1",
      role: "editor" as const,
      logoutPending: false,
      selectedNote,
      draft,
      installNote,
      selectListView: vi.fn(),
      completeStatusChange: vi.fn(),
      completePermanentDelete: vi.fn(),
    };
    const { result } = renderHook(() => useNoteMutations(input));

    await act(async () => { await result.current.saveExistingNote(); });

    expect(installNote).not.toHaveBeenCalled();
    expect(result.current.noteError).toBe("笔记保存失败，请稍后重试。未保存的内容仍保留在当前编辑器中。");
  });

  it("rejects a successful response that does not advance the submitted revision", async () => {
    const selectedNote = note({ revision: 3 });
    const update = vi.fn(async () => note({ revision: 3 }));
    const { result, installNote } = setup({ selectedNote, update });

    await act(async () => { await result.current.saveExistingNote(); });

    expect(installNote).not.toHaveBeenCalled();
    expect(result.current.noteError).toBe("笔记保存失败，请稍后重试。未保存的内容仍保留在当前编辑器中。");
  });

  it("does not silently rebase a retry after a server conflict", async () => {
    const selectedNote = note({ revision: 3 });
    const update = vi.fn()
      .mockRejectedValueOnce(new ApiClientError({
        code: "NOTE_CONFLICT",
        message: "conflict",
        retryable: false,
        details: { server_note: note({ revision: 4, title: "Remote" }) },
      }, 409))
      .mockRejectedValueOnce(new Error("still conflicted"));
    const { result } = setup({ selectedNote, update });

    await act(async () => { await result.current.saveExistingNote(); });
    await act(async () => { await result.current.saveExistingNote(); });

    expect(update).toHaveBeenNthCalledWith(2, "note-1", expect.objectContaining({ base_revision: 3 }), expect.anything());
  });

  it("aborts an active save when unmounted", async () => {
    let requestSignal: AbortSignal | undefined;
    const update = vi.fn((_id, _body, options) => {
      requestSignal = options?.signal;
      return new Promise<Note>(() => undefined);
    });
    const { result, unmount } = setup({ update });

    act(() => { void result.current.saveExistingNote(); });
    expect(requestSignal).toBeInstanceOf(AbortSignal);
    unmount();

    expect(requestSignal?.aborted).toBe(true);
  });
});
