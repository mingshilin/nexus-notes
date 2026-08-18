import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { noteMatchesCurrentView, sortNotesForView, useNotesData, type UseNotesDataParams } from "@/hooks/useNotesData";
import type { AuthUser } from "@/types/auth";
import type { NoteWithTags } from "@/types/note";

const notesApi = vi.hoisted(() => ({
  getInboxNotes: vi.fn(),
  getNoteById: vi.fn(),
  getNotes: vi.fn(),
  getRecentNotes: vi.fn(),
  getTrashedNotes: vi.fn(),
  markNoteOpen: vi.fn(),
}));

const databasesApi = vi.hoisted(() => ({
  getDatabaseNotes: vi.fn(),
}));

vi.mock("@/api/notes", () => notesApi);
vi.mock("@/api/databases", () => databasesApi);
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
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

function makeParams(overrides: Partial<UseNotesDataParams> = {}): UseNotesDataParams {
  const baseNote = makeNote();
  return {
    user,
    notes: [],
    trashNotes: [],
    recentNotes: [],
    allKnownNotes: new Map([[baseNote.id, baseNote]]),
    selectedNoteId: null,
    pendingNoteId: null,
    page: 1,
    pageSize: 30,
    searchQuery: "",
    debouncedSearchQuery: "",
    selectedTagId: null,
    favoriteOnly: false,
    libraryView: "inbox",
    selectedFolderId: null,
    selectedDatabaseId: null,
    activeDailyDate: "2026-05-20",
    noteSort: "updated_desc",
    setNotes: vi.fn(),
    setTrashNotes: vi.fn(),
    setRecentNotes: vi.fn(),
    upsertNote: vi.fn(),
    setPagination: vi.fn(),
    setSelectedNoteId: vi.fn(),
    openTab: vi.fn(),
    setTitleDraft: vi.fn(),
    setContentDraft: vi.fn(),
    setMoveFolderValue: vi.fn(),
    setMobilePrimaryPane: vi.fn(),
    setMobileInspectorOpen: vi.fn(),
    setAccountMenuOpen: vi.fn(),
    setLoading: vi.fn(),
    setLoadError: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useNotesData helpers", () => {
  it("sorts visible notes by pinned and updated time by default", () => {
    const first = makeNote({ id: "first", updated_at: "2026-05-19T00:00:00.000Z" });
    const pinned = makeNote({ id: "pinned", is_pinned: true, updated_at: "2026-05-18T00:00:00.000Z" });
    const recent = makeNote({ id: "recent", updated_at: "2026-05-20T00:00:00.000Z" });

    expect(sortNotesForView([first, pinned, recent], "updated_desc").map((note) => note.id)).toEqual(["pinned", "recent", "first"]);
  });

  it("matches search and library view constraints", () => {
    const tagged = makeNote({
      id: "tagged",
      title: "Project plan",
      tags: [{ id: "tag-1", name: "Work", color: "#fff", created_at: "", updated_at: "" }],
    });
    const archived = makeNote({ id: "archived", title: "Project archive", archived_at: "2026-05-20T00:00:00.000Z" });

    expect(noteMatchesCurrentView(tagged, {
      searchQuery: "work",
      selectedTagId: "tag-1",
      favoriteOnly: false,
      libraryView: "all",
      selectedFolderId: null,
    })).toBe(true);
    expect(noteMatchesCurrentView(archived, {
      searchQuery: "project",
      selectedTagId: null,
      favoriteOnly: false,
      libraryView: "all",
      selectedFolderId: null,
    })).toBe(false);
  });
});

describe("useNotesData loading", () => {
  it("loads inbox notes, pagination, and first-note selection", async () => {
    const first = makeNote({ id: "first", title: "First" });
    notesApi.getInboxNotes.mockResolvedValue({ data: [first], meta: { page: 2, pageSize: 30, total: 42 } });
    notesApi.markNoteOpen.mockResolvedValue({ id: "first" });
    const params = makeParams({ page: 2, debouncedSearchQuery: "first", selectedTagId: "tag-1", favoriteOnly: true });

    const { result } = renderHook(() => useNotesData(params));
    await act(async () => {
      await result.current.loadVisibleNotes({ reason: "test" });
    });

    expect(notesApi.getInboxNotes).toHaveBeenCalledWith({ page: 2, pageSize: 30, q: "first", tag: "tag-1", favorite: true });
    expect(params.setNotes).toHaveBeenCalledWith([first]);
    expect(params.setPagination).toHaveBeenCalledWith({ page: 2, pageSize: 30, total: 42 });
    expect(params.setSelectedNoteId).toHaveBeenCalledWith("first");
    expect(notesApi.markNoteOpen).toHaveBeenCalledWith("first");
  });

  it("loads trash notes into trash state", async () => {
    const trashed = makeNote({ id: "trash-1", deleted_at: "2026-05-20T00:00:00.000Z" });
    notesApi.getTrashedNotes.mockResolvedValue({ data: [trashed], meta: { page: 1, pageSize: 30, total: 1 } });
    const params = makeParams({ libraryView: "trash" });

    const { result } = renderHook(() => useNotesData(params));
    await act(async () => {
      await result.current.loadVisibleNotes();
    });

    expect(notesApi.getTrashedNotes).toHaveBeenCalledWith({ page: 1, pageSize: 30, q: undefined });
    expect(params.setTrashNotes).toHaveBeenCalledWith([trashed]);
    expect(params.setNotes).not.toHaveBeenCalled();
  });

  it("loads database records through the database API", async () => {
    const record = makeNote({ id: "record-1", database_id: "db-1" });
    databasesApi.getDatabaseNotes.mockResolvedValue([record]);
    const params = makeParams({ libraryView: "database", selectedDatabaseId: "db-1" });

    const { result } = renderHook(() => useNotesData(params));
    await act(async () => {
      await result.current.loadVisibleNotes({ silent: true });
    });

    expect(databasesApi.getDatabaseNotes).toHaveBeenCalledWith("db-1");
    expect(params.setNotes).toHaveBeenCalledWith([record]);
    expect(params.setPagination).toHaveBeenCalledWith({ page: 1, pageSize: 500, total: 1 });
    expect(params.setLoading).not.toHaveBeenCalled();
  });
});
