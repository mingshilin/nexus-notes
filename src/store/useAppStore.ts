import { create, type StateCreator } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AuthUser } from "@/types/auth";
import type { DatabaseAdvancedFilter, DatabaseSortDirection, DatabaseView, DatabaseViewKind, DatabaseViewSnapshot } from "@/types/database";
import type { Folder, NoteVersion, NoteWithTags, Reminder, Tag } from "@/types/note";

export type SaveStatus = "idle" | "saving" | "saved" | "failed";
export type EditorMode = "write" | "preview" | "split";
export type ThemeMode = "light" | "dark" | "system";
export type LibraryView =
  | "inbox"
  | "daily"
  | "database"
  | "graph"
  | "knowledge"
  | "reminders"
  | "all"
  | "favorites"
  | "pinned"
  | "folder"
  | "archive"
  | "trash"
  | "recent";
export type RightPanelTab = "outline" | "links" | "info";
export type NoteListView = "list" | "grid";
export type InspectorMode = "format" | "infoMedia";
export type NoteSort = "updated_desc" | "created_desc" | "title_asc";
export type MobilePrimaryPane = "list" | "main";

export interface DatabaseViewPreference extends DatabaseViewSnapshot {
  savedViews: DatabaseView[];
  activeSavedViewId: string | null;
  tablePage: number;
  tablePageSize: number;
}

function createDefaultDatabaseViewPreference(): DatabaseViewPreference {
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
    tablePage: 1,
    tablePageSize: 100,
  };
}

function normalizeTablePage(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 1;
}

function normalizeTablePageSize(value: unknown) {
  return value === 200 || value === 500 ? value : 100;
}

function normalizeDatabaseViewPreference(value: Partial<DatabaseViewPreference> | undefined): DatabaseViewPreference {
  const defaults = createDefaultDatabaseViewPreference();
  return {
    ...defaults,
    ...(value ?? {}),
    visibleColumnIds: Array.isArray(value?.visibleColumnIds) ? value.visibleColumnIds : defaults.visibleColumnIds,
    savedViews: Array.isArray(value?.savedViews) ? value.savedViews : defaults.savedViews,
    advancedFilter: normalizeAdvancedFilter(value?.advancedFilter),
    activeSavedViewId: value?.activeSavedViewId ?? defaults.activeSavedViewId,
    tablePage: normalizeTablePage(value?.tablePage),
    tablePageSize: normalizeTablePageSize(value?.tablePageSize),
  };
}

function normalizeAdvancedFilter(value: Partial<DatabaseAdvancedFilter> | undefined): DatabaseAdvancedFilter {
  return {
    mode: value?.mode === "or" ? "or" : "and",
    rules: Array.isArray(value?.rules)
      ? value.rules
        .filter((rule): rule is NonNullable<DatabaseAdvancedFilter["rules"]>[number] => Boolean(rule?.id && rule?.property_id && rule?.operator))
        .map((rule) => ({
          id: rule.id,
          property_id: rule.property_id,
          operator: rule.operator,
          value: rule.value ?? "",
          values: Array.isArray(rule.values) ? rule.values : [],
        }))
      : [],
  };
}

export interface LegacyDatabaseViewPreference {
  view: DatabaseViewKind;
  visibleColumnIds: string[];
  filterQuery: string;
  filterPropertyId: string;
  filterPropertyValue: string;
  sortField: "updated_at" | "title" | string;
  sortDirection: DatabaseSortDirection;
}

export interface AppState {
  user: AuthUser | null;
  notes: NoteWithTags[];
  trashNotes: NoteWithTags[];
  recentNotes: NoteWithTags[];
  tags: Tag[];
  folders: Folder[];
  versions: NoteVersion[];
  profile: AuthUser | null;
  reminders: Reminder[];
  hasDueReminders: boolean;
  selectedNoteId: string | null;
  searchQuery: string;
  recentSearches: string[];
  favoriteOnly: boolean;
  selectedTagId: string | null;
  selectedFolderId: string | null;
  selectedDatabaseId: string | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  theme: ThemeMode;
  sidebarCollapsed: boolean;
  editorMode: EditorMode;
  mobilePrimaryPane: MobilePrimaryPane;
  mobileInspectorOpen: boolean;
  isDeleteDialogOpen: boolean;
  deletingNoteId: string | null;
  libraryView: LibraryView;
  commandOpen: boolean;
  shortcutsOpen: boolean;
  openedTabs: string[];
  rightPanelTab: RightPanelTab;
  inspectorMode: InspectorMode;
  focusMode: boolean;
  accountMenuOpen: boolean;
  noteListView: NoteListView;
  noteSort: NoteSort;
  databaseViewPreferences: Record<string, DatabaseViewPreference>;
  page: number;
  pageSize: number;
  total: number;
  pendingMutations: string[];
  setUser: (user: AuthUser | null) => void;
  setNotes: (notes: NoteWithTags[]) => void;
  setTrashNotes: (notes: NoteWithTags[]) => void;
  setRecentNotes: (notes: NoteWithTags[]) => void;
  upsertNote: (note: NoteWithTags) => void;
  removeNote: (id: string) => void;
  setTags: (tags: Tag[]) => void;
  upsertTag: (tag: Tag) => void;
  setFolders: (folders: Folder[]) => void;
  upsertFolder: (folder: Folder) => void;
  removeFolder: (id: string) => void;
  setVersions: (versions: NoteVersion[]) => void;
  setProfile: (profile: AuthUser | null) => void;
  setReminders: (reminders: Reminder[]) => void;
  setHasDueReminders: (value: boolean) => void;
  setSelectedNoteId: (id: string | null) => void;
  setSearchQuery: (value: string) => void;
  pushRecentSearch: (value: string) => void;
  setFavoriteOnly: (value: boolean) => void;
  setSelectedTagId: (id: string | null) => void;
  setSelectedFolderId: (id: string | null) => void;
  setSelectedDatabaseId: (id: string | null) => void;
  setSaveStatus: (status: SaveStatus, error?: string | null) => void;
  setTheme: (theme: ThemeMode) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setEditorMode: (mode: EditorMode) => void;
  setMobilePrimaryPane: (value: MobilePrimaryPane) => void;
  setMobileInspectorOpen: (value: boolean) => void;
  setDeleteDialog: (open: boolean, noteId?: string | null) => void;
  setLibraryView: (view: LibraryView) => void;
  setCommandOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  openTab: (id: string) => void;
  closeTab: (id: string) => void;
  setOpenedTabs: (ids: string[]) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setInspectorMode: (mode: InspectorMode) => void;
  setFocusMode: (value: boolean) => void;
  setAccountMenuOpen: (value: boolean) => void;
  setNoteListView: (view: NoteListView) => void;
  setNoteSort: (sort: NoteSort) => void;
  setDatabaseViewPreference: (databaseId: string, patch: Partial<DatabaseViewPreference>) => void;
  setPagination: (payload: { page: number; pageSize: number; total: number }) => void;
  setPendingMutation: (key: string, pending: boolean) => void;
  resetUserScopedState: () => void;
}

export type FilterableNotesState = Pick<
  AppState,
  "notes" | "searchQuery" | "favoriteOnly" | "selectedTagId"
>;

export function selectFilteredNotes(state: FilterableNotesState): NoteWithTags[] {
  const query = state.searchQuery.trim().toLowerCase();
  return state.notes.filter((note) => {
    if (state.favoriteOnly && !note.is_favorite) return false;
    if (state.selectedTagId && !note.tags.some((tag) => tag.id === state.selectedTagId)) return false;
    if (!query) return true;
    const haystack = `${note.title}\n${note.content}\n${note.tags.map((tag) => tag.name).join(" ")}`.toLowerCase();
    return haystack.includes(query);
  });
}

const stateCreator: StateCreator<AppState> = (set) => ({
  user: null,
  notes: [],
  trashNotes: [],
  recentNotes: [],
  tags: [],
  folders: [],
  versions: [],
  profile: null,
  reminders: [],
  hasDueReminders: false,
  selectedNoteId: null,
  searchQuery: "",
  recentSearches: [],
  favoriteOnly: false,
  selectedTagId: null,
  selectedFolderId: null,
  selectedDatabaseId: null,
  saveStatus: "idle",
  saveError: null,
  theme: "system",
  sidebarCollapsed: false,
  editorMode: "split",
  mobilePrimaryPane: "list",
  mobileInspectorOpen: false,
  isDeleteDialogOpen: false,
  deletingNoteId: null,
  libraryView: "inbox",
  commandOpen: false,
  shortcutsOpen: false,
  openedTabs: [],
  rightPanelTab: "outline",
  inspectorMode: "infoMedia",
  focusMode: false,
  accountMenuOpen: false,
  noteListView: "list",
  noteSort: "updated_desc",
  databaseViewPreferences: {},
  page: 1,
  pageSize: 30,
  total: 0,
  pendingMutations: [],
  setUser: (user) => set({ user }),
  setNotes: (notes) => set({ notes }),
  setTrashNotes: (trashNotes) => set({ trashNotes }),
  setRecentNotes: (recentNotes) => set({ recentNotes }),
  upsertNote: (note) =>
    set((state) => {
      const targetKey = note.deleted_at ? "trashNotes" : "notes";
      const source = state[targetKey];
      const exists = source.some((item) => item.id === note.id);
      const updated = exists ? source.map((item) => (item.id === note.id ? note : item)) : [note, ...source];
      const cleanedNotes = note.deleted_at ? state.notes.filter((item) => item.id !== note.id) : state.notes;
      const cleanedTrashNotes = note.deleted_at ? updated : state.trashNotes.filter((item) => item.id !== note.id);
      const cleanedRecentNotes = state.recentNotes.map((item) => (item.id === note.id ? note : item));
      return {
        notes: targetKey === "notes"
          ? updated.sort((a, b) => {
              const pinDelta = Number(b.is_pinned) - Number(a.is_pinned);
              if (pinDelta !== 0) return pinDelta;
              return b.updated_at.localeCompare(a.updated_at);
            })
          : cleanedNotes,
        trashNotes: targetKey === "trashNotes"
          ? updated.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          : cleanedTrashNotes,
        recentNotes: cleanedRecentNotes.sort((a, b) => (b.last_opened_at || "").localeCompare(a.last_opened_at || "")),
      } as Partial<AppState>;
    }),
  removeNote: (id) =>
    set((state) => {
      const nextNotes = state.notes.filter((item) => item.id !== id);
      const nextTrashNotes = state.trashNotes.filter((item) => item.id !== id);
      const nextRecentNotes = state.recentNotes.filter((item) => item.id !== id);
      const nextTabs = state.openedTabs.filter((item) => item !== id);
      const replacementId =
        state.selectedNoteId === id
          ? nextNotes[0]?.id ?? nextTrashNotes[0]?.id ?? nextRecentNotes[0]?.id ?? nextTabs[0] ?? null
          : state.selectedNoteId;
      return {
        notes: nextNotes,
        trashNotes: nextTrashNotes,
        recentNotes: nextRecentNotes,
        openedTabs: nextTabs,
        selectedNoteId: replacementId,
      } as Partial<AppState>;
    }),
  setTags: (tags) => set({ tags }),
  upsertTag: (tag) =>
    set((state) => {
      const exists = state.tags.some((item) => item.id === tag.id);
      return {
        tags: exists ? state.tags.map((item) => (item.id === tag.id ? tag : item)) : [...state.tags, tag],
      };
    }),
  setFolders: (folders) => set({ folders }),
  upsertFolder: (folder) =>
    set((state) => {
      const exists = state.folders.some((item) => item.id === folder.id);
      const nextFolders = exists
        ? state.folders.map((item) => (item.id === folder.id ? folder : item))
        : [...state.folders, folder];
      return { folders: nextFolders.sort((a, b) => a.name.localeCompare(b.name)) };
    }),
  removeFolder: (id) =>
    set((state) => ({
      folders: state.folders.filter((item) => item.id !== id),
      selectedFolderId: state.selectedFolderId === id ? null : state.selectedFolderId,
    })),
  setVersions: (versions) => set({ versions }),
  setProfile: (profile) => set({ profile }),
  setReminders: (reminders) => set({ reminders }),
  setHasDueReminders: (hasDueReminders) => set({ hasDueReminders }),
  setSelectedNoteId: (selectedNoteId) => set({ selectedNoteId }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  pushRecentSearch: (value) =>
    set((state) => ({
      recentSearches: [value, ...state.recentSearches.filter((item) => item !== value)].slice(0, 8),
    })),
  setFavoriteOnly: (favoriteOnly) => set({ favoriteOnly }),
  setSelectedTagId: (selectedTagId) => set({ selectedTagId }),
  setSelectedFolderId: (selectedFolderId) => set({ selectedFolderId }),
  setSelectedDatabaseId: (selectedDatabaseId) => set({ selectedDatabaseId }),
  setSaveStatus: (saveStatus, saveError = null) => set({ saveStatus, saveError }),
  setTheme: (theme) => set({ theme }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setEditorMode: (editorMode) => set({ editorMode }),
  setMobilePrimaryPane: (mobilePrimaryPane) => set({ mobilePrimaryPane }),
  setMobileInspectorOpen: (mobileInspectorOpen) => set({ mobileInspectorOpen }),
  setDeleteDialog: (isDeleteDialogOpen, deletingNoteId = null) =>
    set({ isDeleteDialogOpen, deletingNoteId: isDeleteDialogOpen ? deletingNoteId : null }),
  setLibraryView: (libraryView) => set({ libraryView }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  openTab: (id) =>
    set((state) => ({
      openedTabs: [id, ...state.openedTabs.filter((item) => item !== id)].slice(0, 8),
      selectedNoteId: id,
    })),
  closeTab: (id) =>
    set((state) => {
      const nextTabs = state.openedTabs.filter((item) => item !== id);
      return {
        openedTabs: nextTabs,
        selectedNoteId: state.selectedNoteId === id ? (nextTabs[0] ?? null) : state.selectedNoteId,
      };
    }),
  setOpenedTabs: (openedTabs) => set({ openedTabs: openedTabs.slice(0, 8) }),
  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
  setInspectorMode: (inspectorMode) => set({ inspectorMode }),
  setFocusMode: (focusMode) => set({ focusMode }),
  setAccountMenuOpen: (accountMenuOpen) => set({ accountMenuOpen }),
  setNoteListView: (noteListView) => set({ noteListView }),
  setNoteSort: (noteSort) => set({ noteSort }),
  setDatabaseViewPreference: (databaseId, patch) =>
    set((state) => {
      const current = normalizeDatabaseViewPreference(state.databaseViewPreferences[databaseId]);
      const nextAdvancedFilter = patch.advancedFilter === undefined
        ? current.advancedFilter
        : normalizeAdvancedFilter(patch.advancedFilter);
      const nextPreference = normalizeDatabaseViewPreference({ ...current, ...patch, advancedFilter: nextAdvancedFilter });
      return {
        databaseViewPreferences: {
          ...state.databaseViewPreferences,
          [databaseId]: nextPreference,
        },
      };
    }),
  setPagination: ({ page, pageSize, total }) => set({ page, pageSize, total }),
  setPendingMutation: (key, pending) =>
    set((state) => ({
      pendingMutations: pending
        ? state.pendingMutations.includes(key)
          ? state.pendingMutations
          : [...state.pendingMutations, key]
        : state.pendingMutations.filter((item) => item !== key),
    })),
  resetUserScopedState: () =>
    set({
      user: null,
      notes: [],
      trashNotes: [],
      recentNotes: [],
      tags: [],
      folders: [],
      versions: [],
      profile: null,
      reminders: [],
      hasDueReminders: false,
      selectedNoteId: null,
      searchQuery: "",
      recentSearches: [],
      favoriteOnly: false,
      selectedTagId: null,
      selectedFolderId: null,
      selectedDatabaseId: null,
      saveStatus: "idle",
      saveError: null,
      mobilePrimaryPane: "list",
      mobileInspectorOpen: false,
      isDeleteDialogOpen: false,
      deletingNoteId: null,
      libraryView: "inbox",
      commandOpen: false,
      shortcutsOpen: false,
      openedTabs: [],
      rightPanelTab: "outline",
      inspectorMode: "infoMedia",
      focusMode: false,
      accountMenuOpen: false,
      noteSort: "updated_desc",
      page: 1,
      pageSize: 30,
      total: 0,
      pendingMutations: [],
    }),
});

export const useAppStore = create<AppState>()(
  persist(stateCreator, {
    name: "modern-notes-ui",
    storage: createJSONStorage(() => localStorage),
    partialize: (state) => ({
      theme: state.theme,
      sidebarCollapsed: state.sidebarCollapsed,
      editorMode: state.editorMode,
      recentSearches: state.recentSearches,
      openedTabs: state.openedTabs,
      rightPanelTab: state.rightPanelTab,
      inspectorMode: state.inspectorMode,
      noteListView: state.noteListView,
      noteSort: state.noteSort,
      databaseViewPreferences: state.databaseViewPreferences,
      focusMode: state.focusMode,
      pendingMutations: [],
    }),
    merge: (persistedState, currentState) => {
      const merged = {
        ...currentState,
        ...(persistedState as Partial<AppState>),
      };
      merged.databaseViewPreferences = Object.fromEntries(
        Object.entries(merged.databaseViewPreferences ?? {}).map(([databaseId, preference]) => [
          databaseId,
          normalizeDatabaseViewPreference(preference),
        ]),
      );
      return merged;
    },
  }),
);
