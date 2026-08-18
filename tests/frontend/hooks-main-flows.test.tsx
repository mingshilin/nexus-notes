import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCallback, useMemo, useState } from "react";
import { useAuthBootstrap } from "@/hooks/useAuthBootstrap";
import { useDatabaseData } from "@/hooks/useDatabaseData";
import { useNotesData } from "@/hooks/useNotesData";
import { useShareFlow } from "@/hooks/useShareFlow";
import type { AuthUser } from "@/types/auth";
import type { Database, DatabaseProperty, DatabaseRecordTemplate, DatabaseView } from "@/types/database";
import type { NoteWithTags, PublicSharedNote } from "@/types/note";
import type { DatabaseViewPreference } from "@/store/useAppStore";

const authApi = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  verifyEmail: vi.fn(),
}));

const workspaceApi = vi.hoisted(() => ({
  getWorkspaceInvitePreview: vi.fn(),
}));

const notesApi = vi.hoisted(() => ({
  getInboxNotes: vi.fn(),
  getNoteById: vi.fn(),
  getNotes: vi.fn(),
  getRecentNotes: vi.fn(),
  getTrashedNotes: vi.fn(),
  markNoteOpen: vi.fn(),
}));

const databasesApi = vi.hoisted(() => ({
  getDatabaseDuplicateGroups: vi.fn(),
  getDatabaseNotes: vi.fn(),
  getDatabaseProperties: vi.fn(),
  getDatabaseTemplates: vi.fn(),
  getDatabaseViews: vi.fn(),
  getDatabases: vi.fn(),
}));

const sharesApi = vi.hoisted(() => ({
  createPublicNoteShare: vi.fn(),
  getPublicNoteShareSummary: vi.fn(),
  getPublicSharedNote: vi.fn(),
  revokePublicNoteShare: vi.fn(),
}));

vi.mock("@/api/auth", () => authApi);
vi.mock("@/api/workspaces", () => workspaceApi);
vi.mock("@/api/notes", () => notesApi);
vi.mock("@/api/databases", () => databasesApi);
vi.mock("@/api/shares", () => sharesApi);
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

function makeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    id: overrides.id ?? "db-1",
    workspace_id: overrides.workspace_id ?? "ws-1",
    name: overrides.name ?? "Projects",
    description: overrides.description ?? "",
    icon: overrides.icon ?? "DB",
    created_by_user_id: overrides.created_by_user_id ?? "u1",
    board_property_id: overrides.board_property_id ?? null,
    calendar_property_id: overrides.calendar_property_id ?? null,
    created_at: overrides.created_at ?? "2026-05-20T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-05-20T00:00:00.000Z",
  };
}

function makeView(overrides: Partial<DatabaseView> = {}): DatabaseView {
  return {
    id: overrides.id ?? "view-1",
    database_id: overrides.database_id ?? "db-1",
    name: overrides.name ?? "Board",
    view: overrides.view ?? "board",
    visibleColumnIds: overrides.visibleColumnIds ?? [],
    filterQuery: overrides.filterQuery ?? "",
    filterPropertyId: overrides.filterPropertyId ?? "",
    filterPropertyValue: overrides.filterPropertyValue ?? "",
    advancedFilter: overrides.advancedFilter ?? { mode: "and", rules: [] },
    sortField: overrides.sortField ?? "updated_at",
    sortDirection: overrides.sortDirection ?? "desc",
    created_by_user_id: overrides.created_by_user_id ?? "u1",
    created_at: overrides.created_at ?? "2026-05-20T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-05-20T00:00:00.000Z",
  };
}

function makeSharedNote(): PublicSharedNote {
  return {
    note: {
      id: "note-1",
      title: "Shared",
      content: "Shared content",
      created_at: "2026-05-20T00:00:00.000Z",
      updated_at: "2026-05-20T00:00:00.000Z",
    },
    access_mode: "read",
    workspace_name: "Workspace",
    shared_by: "Owner",
    created_at: "2026-05-20T00:00:00.000Z",
  };
}

function createDefaultPreference(): DatabaseViewPreference {
  return {
    view: "table",
    visibleColumnIds: [],
    filterQuery: "",
    filterPropertyId: "",
    filterPropertyValue: "",
    advancedFilter: { mode: "and", rules: [] },
    sortField: "updated_at",
    sortDirection: "desc",
    savedViews: [],
    activeSavedViewId: null,
  };
}

function useMainFlowHarness(options: { initialSelectedDatabaseId?: string | null } = {}) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [notes, setNotes] = useState<NoteWithTags[]>([]);
  const [trashNotes, setTrashNotes] = useState<NoteWithTags[]>([]);
  const [recentNotes, setRecentNotes] = useState<NoteWithTags[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [contentDraft, setContentDraft] = useState("");
  const [moveFolderValue, setMoveFolderValue] = useState<string | null>(null);
  const [openedTabs, setOpenedTabs] = useState<string[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 30, total: 0 });
  const [selectedDatabaseId, setSelectedDatabaseId] = useState<string | null>(options.initialSelectedDatabaseId ?? "db-1");
  const [databaseViewPreferences, setDatabaseViewPreferences] = useState<Record<string, DatabaseViewPreference>>({
    "db-1": { ...createDefaultPreference(), activeSavedViewId: "view-1" },
  });
  const setDatabaseViewPreference = useCallback((databaseId: string, patch: Partial<DatabaseViewPreference>) => {
    setDatabaseViewPreferences((current) => ({
      ...current,
      [databaseId]: { ...(current[databaseId] ?? createDefaultPreference()), ...patch },
    }));
  }, []);

  const allKnownNotes = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);

  const auth = useAuthBootstrap({
    user: currentUser,
    setUser: setCurrentUser,
    handleSignedOut: () => setCurrentUser(null),
  });

  const notesData = useNotesData({
    user: currentUser,
    notes,
    trashNotes,
    recentNotes,
    allKnownNotes,
    selectedNoteId,
    pendingNoteId: auth.pendingNoteId,
    page: pagination.page,
    pageSize: pagination.pageSize,
    searchQuery: "",
    debouncedSearchQuery: "",
    selectedTagId: null,
    favoriteOnly: false,
    libraryView: "inbox",
    selectedFolderId: null,
    selectedDatabaseId: null,
    activeDailyDate: "2026-05-20",
    noteSort: "updated_desc",
    setNotes,
    setTrashNotes,
    setRecentNotes,
    upsertNote: (note) => setNotes((current) => [note, ...current.filter((item) => item.id !== note.id)]),
    setPagination,
    setSelectedNoteId,
    openTab: (id) => setOpenedTabs((current) => [id, ...current.filter((item) => item !== id)].slice(0, 8)),
    setTitleDraft,
    setContentDraft,
    setMoveFolderValue,
    setMobilePrimaryPane: vi.fn(),
    setMobileInspectorOpen: vi.fn(),
    setAccountMenuOpen: vi.fn(),
    setLoading: vi.fn(),
    setLoadError: vi.fn(),
  });

  const databaseData = useDatabaseData({
    user: currentUser,
    selectedDatabaseId,
    databaseViewPreferences,
    setDatabaseViewPreference,
  });

  const share = useShareFlow({ user: currentUser, allKnownNotes });

  return {
    auth,
    currentUser,
    notes,
    notesData,
    titleDraft,
    contentDraft,
    moveFolderValue,
    openedTabs,
    pagination,
    selectedNoteId,
    selectedDatabaseId,
    setSelectedDatabaseId,
    databaseData,
    databaseViewPreferences,
    share,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("main hook flows", () => {
  it("bootstraps auth, loads notes, opens the first note, and keeps share summary wired to known notes", async () => {
    const firstNote = makeNote({ id: "note-1", title: "First note", content: "Ready" });
    authApi.getCurrentUser.mockResolvedValue(user);
    notesApi.getInboxNotes.mockResolvedValue({ data: [firstNote], meta: { page: 1, pageSize: 30, total: 1 } });
    notesApi.markNoteOpen.mockResolvedValue({ id: "note-1" });
    sharesApi.getPublicNoteShareSummary.mockResolvedValue({ active: true, expires_at: null });

    const { result } = renderHook(() => useMainFlowHarness({ initialSelectedDatabaseId: null }));

    await waitFor(() => expect(result.current.auth.authLoading).toBe(false));
    expect(result.current.currentUser).toEqual(user);

    await act(async () => {
      await result.current.notesData.loadVisibleNotes({ reason: "main-flow" });
    });

    expect(notesApi.getInboxNotes).toHaveBeenCalledWith({
      page: 1,
      pageSize: 30,
      q: undefined,
      tag: undefined,
      favorite: undefined,
    });
    expect(result.current.notes).toEqual([firstNote]);
    expect(result.current.selectedNoteId).toBe("note-1");
    expect(result.current.openedTabs).toEqual(["note-1"]);
    expect(result.current.titleDraft).toBe("First note");
    expect(result.current.contentDraft).toBe("Ready");
    expect(result.current.moveFolderValue).toBeNull();
    expect(result.current.pagination).toEqual({ page: 1, pageSize: 30, total: 1 });
    expect(notesApi.markNoteOpen).toHaveBeenCalledWith("note-1");

    act(() => result.current.share.openShareDialog("note-1"));

    await waitFor(() => expect(result.current.share.shareDialogNote).toEqual(firstNote));
    await waitFor(() => expect(result.current.share.publicShareSummary).toEqual({ active: true, expires_at: null }));
    expect(sharesApi.getPublicNoteShareSummary).toHaveBeenCalledWith("note-1");
  });

  it("loads database chrome and reconciles saved views through the shared preference state", async () => {
    const database = makeDatabase();
    const statusProperty: DatabaseProperty = {
      id: "prop-1",
      database_id: "db-1",
      name: "Status",
      type: "single_select",
      config: { options: [] },
      sort_order: 1,
      created_at: "2026-05-20T00:00:00.000Z",
      updated_at: "2026-05-20T00:00:00.000Z",
    };
    const template: DatabaseRecordTemplate = {
      id: "tpl-1",
      database_id: "db-1",
      name: "Default",
      title: "Task",
      content: "",
      default_values: [],
      created_by_user_id: "u1",
      created_at: "2026-05-20T00:00:00.000Z",
      updated_at: "2026-05-20T00:00:00.000Z",
    };
    const savedView = makeView({ id: "view-1", view: "board" });
    authApi.getCurrentUser.mockResolvedValue(user);
    databasesApi.getDatabases.mockResolvedValue([database]);
    databasesApi.getDatabaseProperties.mockResolvedValue([statusProperty]);
    databasesApi.getDatabaseTemplates.mockResolvedValue([template]);
    databasesApi.getDatabaseDuplicateGroups.mockResolvedValue([{ title: "Same", notes: [] }]);
    databasesApi.getDatabaseViews.mockResolvedValue([savedView]);

    const { result } = renderHook(() => useMainFlowHarness({ initialSelectedDatabaseId: null }));

    await waitFor(() => expect(result.current.currentUser).toEqual(user));
    await act(async () => {
      await result.current.databaseData.loadDatabaseList();
    });
    await waitFor(() => expect(result.current.databaseData.databaseProperties).toEqual([statusProperty]));
    await waitFor(() => expect(result.current.databaseViewPreferences["db-1"].savedViews).toEqual([savedView]));

    expect(result.current.databaseData.databases).toEqual([database]);
    expect(result.current.databaseData.currentDatabase).toEqual(database);
    expect(result.current.databaseData.databaseTemplates).toEqual([template]);
    expect(result.current.databaseData.databaseDuplicateGroups).toEqual([{ title: "Same", notes: [] }]);
    expect(result.current.databaseViewPreferences["db-1"].activeSavedViewId).toBe("view-1");
  });

  it("detects URL entry intents for public shares and internal note deep links", async () => {
    const sharedNote = makeSharedNote();
    authApi.getCurrentUser.mockResolvedValue(user);
    sharesApi.getPublicSharedNote.mockResolvedValue(sharedNote);
    window.history.replaceState({}, "", "/?note=note-2&share=share-token");

    const { result } = renderHook(() => useMainFlowHarness());

    await waitFor(() => expect(result.current.auth.pendingNoteId).toBe("note-2"));
    await waitFor(() => expect(result.current.share.pendingPublicShareToken).toBe("share-token"));
    await waitFor(() => expect(result.current.share.publicSharedNote).toEqual(sharedNote));
    expect(sharesApi.getPublicSharedNote).toHaveBeenCalledWith("share-token", null);
  });
});
