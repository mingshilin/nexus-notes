import { act, renderHook } from "@testing-library/react";
import type { Note } from "@nexus/contracts";
import { describe, expect, it, vi } from "vitest";

import { useNoteMutations } from "../src/app/use-note-mutations";

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
  const update = options.update ?? vi.fn(async () => selectedNote);
  const deletePermanently = options.deletePermanently ?? vi.fn(async () => ({ deleted: true as const }));
  const installNote = vi.fn();
  const selectListView = vi.fn();
  const completeStatusChange = vi.fn();
  const completePermanentDelete = vi.fn();
  const hook = renderHook(() => useNoteMutations({
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
  }));
  return {
    ...hook,
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
    });
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
});
