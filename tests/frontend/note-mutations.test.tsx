import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNoteMutations } from "@/hooks/useNoteMutations";
import type { AuthUser } from "@/types/auth";
import type { NoteWithTags } from "@/types/note";

const notesApi = vi.hoisted(() => ({
  archiveNote: vi.fn(),
  clearTrash: vi.fn(),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  deleteNotePermanent: vi.fn(),
  restoreNote: vi.fn(),
  unarchiveNote: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock("@/api/notes", () => notesApi);
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const user: AuthUser = {
  id: "u1",
  email: "user@example.com",
  email_verified_at: "2026-05-20T00:00:00.000Z",
  created_at: "2026-05-20T00:00:00.000Z",
  current_workspace: { id: "ws-1", name: "Workspace", owner_user_id: "u1", role: "owner" },
};

function makeNote(overrides: Partial<NoteWithTags> = {}): NoteWithTags {
  return {
    id: overrides.id ?? "note-1",
    folder_id: overrides.folder_id ?? null,
    database_id: overrides.database_id,
    title: overrides.title ?? "Alpha",
    content: overrides.content ?? "Body",
    is_favorite: overrides.is_favorite ?? false,
    is_pinned: overrides.is_pinned ?? false,
    is_daily: overrides.is_daily ?? false,
    daily_date: overrides.daily_date ?? null,
    created_at: overrides.created_at ?? "2026-05-19T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-05-20T00:00:00.000Z",
    deleted_at: overrides.deleted_at ?? null,
    archived_at: overrides.archived_at ?? null,
    last_opened_at: overrides.last_opened_at ?? null,
    tags: overrides.tags ?? [],
    folder: overrides.folder ?? null,
    database_values: overrides.database_values,
  };
}

function makeParams(overrides: Partial<Parameters<typeof useNoteMutations>[0]> = {}) {
  const note = makeNote();
  return {
    user,
    libraryView: "all" as const,
    isWorkspaceReadonly: false,
    selectedFolderId: null,
    selectedDatabaseId: null,
    selectedNoteBase: note,
    titleDraft: note.title,
    contentDraft: note.content,
    moveFolderValue: null,
    deletingNoteId: null,
    permanentDeleteMode: false,
    batchSelectedIds: [],
    listNotes: [note],
    allKnownNotes: new Map([[note.id, note]]),
    pageSize: 30,
    total: 1,
    saveTimerRef: { current: undefined },
    assertCanWrite: vi.fn(),
    runMutation: vi.fn(async (_key: string, task: () => Promise<unknown>) => task()),
    refreshDataSilently: vi.fn(),
    loadData: vi.fn(async () => undefined),
    selectLocalNote: vi.fn(),
    selectNote: vi.fn(),
    reconcileVisibleNote: vi.fn(),
    reconcileVisibleNotesBulk: vi.fn(),
    upsertNote: vi.fn(),
    removeNote: vi.fn(),
    closeTab: vi.fn(),
    setSaveStatus: vi.fn(),
    setLibraryView: vi.fn(),
    setTitleAutoFocus: vi.fn(),
    setDeleteDialog: vi.fn(),
    setPermanentDeleteMode: vi.fn(),
    setBatchSelectedIds: vi.fn(),
    setBatchMode: vi.fn(),
    setMoveFolderOpen: vi.fn(),
    setMoveFolderLoading: vi.fn(),
    setPagination: vi.fn(),
    setTrashNotes: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useNoteMutations", () => {
  it("creates notes with optimistic state and selects the persisted note", async () => {
    const created = makeNote({ id: "created", title: "Created" });
    notesApi.createNote.mockResolvedValue(created);
    const params = makeParams();

    const { result } = renderHook(() => useNoteMutations(params));
    await act(async () => {
      await result.current.handleCreateNote({ id: "blank", name: "Blank", title: "", content: "" });
    });

    expect(params.upsertNote).toHaveBeenCalledWith(expect.objectContaining({ id: expect.stringMatching(/^temp-/) }));
    expect(notesApi.createNote).toHaveBeenCalledWith({ title: "", content: "", folder_id: null, database_id: null });
    expect(params.removeNote).toHaveBeenCalledWith(expect.stringMatching(/^temp-/));
    expect(params.selectNote).toHaveBeenCalledWith("created");
    expect(params.refreshDataSilently).toHaveBeenCalledWith("create-note", true, 700);
  });

  it("rolls back batch delete by reloading data when deletion fails", async () => {
    const note = makeNote({ id: "delete-me" });
    notesApi.deleteNote.mockRejectedValue(new Error("boom"));
    const params = makeParams({
      batchSelectedIds: ["delete-me"],
      listNotes: [note],
      allKnownNotes: new Map([[note.id, note]]),
    });

    const { result } = renderHook(() => useNoteMutations(params));
    await act(async () => {
      await result.current.handleBatchDelete();
    });

    expect(params.removeNote).toHaveBeenCalledWith("delete-me");
    expect(notesApi.deleteNote).toHaveBeenCalledWith("delete-me");
    expect(params.loadData).toHaveBeenCalledWith({ silent: true, reason: "batch-delete-rollback", lightweight: false });
    expect(params.refreshDataSilently).not.toHaveBeenCalledWith("batch-delete");
  });

  it("toggles favorite through visible-note reconciliation", async () => {
    const note = makeNote({ id: "fav", is_favorite: false });
    const updated = makeNote({ id: "fav", is_favorite: true });
    notesApi.updateNote.mockResolvedValue(updated);
    const params = makeParams({ selectedNoteBase: note, titleDraft: "Fav", contentDraft: "Body" });

    const { result } = renderHook(() => useNoteMutations(params));
    await act(async () => {
      await result.current.handleToggleFavorite();
    });

    expect(notesApi.updateNote).toHaveBeenCalledWith("fav", { is_favorite: true, title: "Fav", content: "Body" });
    expect(params.reconcileVisibleNote).toHaveBeenCalledWith(updated);
    expect(params.refreshDataSilently).toHaveBeenCalledWith("toggle-favorite");
  });
});
