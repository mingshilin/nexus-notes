import { useMemo } from "react";
import { toast } from "sonner";
import { getDatabaseNotes } from "@/api/databases";
import { getInboxNotes, getNoteById, getNotes, getRecentNotes, getTrashedNotes, markNoteOpen } from "@/api/notes";
import { getErrorMessage } from "@/lib/errorMessages";
import { decodeEscapedUnicode } from "@/lib/utils";
import type { AuthUser } from "@/types/auth";
import type { NoteWithTags } from "@/types/note";
import type { LibraryView, NoteSort } from "@/store/useAppStore";

interface LoadVisibleNotesOptions {
  silent?: boolean;
  reason?: string;
}

interface NotesDataState {
  user: AuthUser | null;
  notes: NoteWithTags[];
  trashNotes: NoteWithTags[];
  recentNotes: NoteWithTags[];
  allKnownNotes: Map<string, NoteWithTags>;
  selectedNoteId: string | null;
  pendingNoteId: string | null;
  page: number;
  pageSize: number;
  searchQuery: string;
  debouncedSearchQuery: string;
  selectedTagId: string | null;
  favoriteOnly: boolean;
  libraryView: LibraryView;
  selectedFolderId: string | null;
  selectedDatabaseId: string | null;
  activeDailyDate: string;
  noteSort: NoteSort;
}

interface NotesDataActions {
  setNotes: (notes: NoteWithTags[]) => void;
  setTrashNotes: (notes: NoteWithTags[]) => void;
  setRecentNotes: (notes: NoteWithTags[]) => void;
  upsertNote: (note: NoteWithTags) => void;
  setPagination: (payload: { page: number; pageSize: number; total: number }) => void;
  setSelectedNoteId: (id: string | null) => void;
  openTab: (id: string) => void;
  setTitleDraft: (value: string) => void;
  setContentDraft: (value: string) => void;
  setMoveFolderValue: (value: string | null) => void;
  setMobilePrimaryPane: (value: "list" | "main") => void;
  setMobileInspectorOpen: (value: boolean) => void;
  setAccountMenuOpen: (value: boolean) => void;
  setLoading: (value: boolean) => void;
  setLoadError: (value: string | null) => void;
}

export interface UseNotesDataParams extends NotesDataState, NotesDataActions {}

interface NoteViewMatchParams {
  searchQuery: string;
  selectedTagId: string | null;
  favoriteOnly: boolean;
  libraryView: LibraryView;
  selectedFolderId: string | null;
}

export function sortNotesForView(items: NoteWithTags[], noteSort: NoteSort) {
  const nextItems = [...items];
  switch (noteSort) {
    case "created_desc":
      return nextItems.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case "title_asc":
      return nextItems.sort((a, b) => decodeEscapedUnicode(a.title || "").localeCompare(decodeEscapedUnicode(b.title || ""), "zh-CN"));
    case "updated_desc":
    default:
      return nextItems.sort((a, b) => {
        const pinDelta = Number(b.is_pinned) - Number(a.is_pinned);
        if (pinDelta !== 0) return pinDelta;
        return b.updated_at.localeCompare(a.updated_at);
      });
  }
}

export function noteMatchesSearch(note: NoteWithTags, searchQuery: string) {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return true;
  const haystack = `${decodeEscapedUnicode(note.title)}\n${decodeEscapedUnicode(note.content)}\n${note.tags.map((tag) => decodeEscapedUnicode(tag.name)).join(" ")}`.toLowerCase();
  return haystack.includes(q);
}

export function noteMatchesCurrentView(note: NoteWithTags, params: NoteViewMatchParams) {
  if (note.deleted_at) return false;
  if (!noteMatchesSearch(note, params.searchQuery)) return false;
  if (params.selectedTagId && !note.tags.some((tag) => tag.id === params.selectedTagId)) return false;
  if (params.favoriteOnly && !note.is_favorite) return false;

  switch (params.libraryView) {
    case "inbox":
      return !note.folder_id && !note.archived_at;
    case "daily":
      return Boolean(note.is_daily) && !note.archived_at;
    case "all":
      return !note.archived_at;
    case "favorites":
      return note.is_favorite && !note.archived_at;
    case "pinned":
      return note.is_pinned && !note.archived_at;
    case "folder":
      return note.folder_id === params.selectedFolderId && !note.archived_at;
    case "archive":
      return Boolean(note.archived_at);
    default:
      return true;
  }
}

export function useNotesData(params: UseNotesDataParams) {
  const {
    user,
    notes,
    trashNotes,
    recentNotes,
    allKnownNotes,
    selectedNoteId,
    pendingNoteId,
    page,
    pageSize,
    searchQuery,
    debouncedSearchQuery,
    selectedTagId,
    favoriteOnly,
    libraryView,
    selectedFolderId,
    selectedDatabaseId,
    activeDailyDate,
    noteSort,
    setNotes,
    setTrashNotes,
    setRecentNotes,
    upsertNote,
    setPagination,
    setSelectedNoteId,
    openTab,
    setTitleDraft,
    setContentDraft,
    setMoveFolderValue,
    setMobilePrimaryPane,
    setMobileInspectorOpen,
    setAccountMenuOpen,
    setLoading,
    setLoadError,
  } = params;

  const rawListNotes = libraryView === "trash" ? trashNotes : libraryView === "recent" ? recentNotes : notes;
  const sortedListNotes = useMemo(() => sortNotesForView(rawListNotes, noteSort), [rawListNotes, noteSort]);
  const listNotes = useMemo(() => sortedListNotes.filter((note) => noteMatchesSearch(note, searchQuery)), [sortedListNotes, searchQuery]);

  const viewMatchParams = {
    searchQuery,
    selectedTagId,
    favoriteOnly,
    libraryView,
    selectedFolderId,
  };

  function matchesCurrentNotesView(note: NoteWithTags) {
    return noteMatchesCurrentView(note, viewMatchParams);
  }

  function sortVisibleNotes(items: NoteWithTags[]) {
    return sortNotesForView(items, noteSort);
  }

  function selectLocalNote(note: NoteWithTags) {
    setSelectedNoteId(note.id);
    openTab(note.id);
    setTitleDraft(decodeEscapedUnicode(note.title));
    setContentDraft(decodeEscapedUnicode(note.content));
    setMoveFolderValue(note.folder_id ?? null);
    setMobilePrimaryPane("main");
    setMobileInspectorOpen(false);
    setAccountMenuOpen(false);
  }

  async function selectNote(id: string) {
    let note = allKnownNotes.get(id);
    if (!note) {
      note = await getNoteById(id);
      upsertNote(note);
    }
    selectLocalNote(note);
    markNoteOpen(id).catch(() => undefined);
  }

  function reconcileVisibleNote(updated: NoteWithTags) {
    if (libraryView === "trash") {
      if (updated.deleted_at) {
        upsertNote(updated);
      } else {
        setTrashNotes(trashNotes.filter((item) => item.id !== updated.id));
      }
      return;
    }

    if (libraryView === "recent") {
      upsertNote(updated);
      return;
    }

    if (libraryView === "graph" || libraryView === "knowledge" || libraryView === "reminders") {
      upsertNote(updated);
      return;
    }

    if (updated.deleted_at) {
      upsertNote(updated);
      return;
    }

    if (matchesCurrentNotesView(updated)) {
      upsertNote(updated);
      return;
    }

    setNotes(sortVisibleNotes(notes.filter((item) => item.id !== updated.id)));
  }

  function reconcileVisibleNotesBulk(updatedNotes: NoteWithTags[]) {
    if (updatedNotes.length === 0) return;

    if (libraryView === "trash") {
      const restoredIds = new Set(updatedNotes.filter((note) => !note.deleted_at).map((note) => note.id));
      if (restoredIds.size > 0) {
        setTrashNotes(trashNotes.filter((item) => !restoredIds.has(item.id)));
      }
      updatedNotes.filter((note) => note.deleted_at).forEach((note) => upsertNote(note));
      return;
    }

    if (libraryView === "recent" || libraryView === "graph" || libraryView === "knowledge" || libraryView === "reminders") {
      updatedNotes.forEach((note) => upsertNote(note));
      return;
    }

    const nextVisible = notes.filter((item) => !updatedNotes.some((updated) => updated.id === item.id));
    const toKeep = updatedNotes.filter((note) => !note.deleted_at && matchesCurrentNotesView(note));
    setNotes(sortVisibleNotes([...nextVisible, ...toKeep]));
    updatedNotes.filter((note) => note.deleted_at).forEach((note) => upsertNote(note));
  }

  async function loadVisibleNotes(options: LoadVisibleNotesOptions = {}) {
    if (!user) return;
    const startedAt = performance.now();
    const silent = Boolean(options.silent);
    if (!silent) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const baseQuery = {
        page,
        pageSize,
        q: debouncedSearchQuery || undefined,
        tag: selectedTagId || undefined,
        favorite: libraryView === "favorites" || favoriteOnly ? true : undefined,
        pinned: libraryView === "pinned" ? true : undefined,
        archived: libraryView === "archive" ? true : undefined,
        folder: libraryView === "folder" ? selectedFolderId : undefined,
        daily: libraryView === "daily" ? true : undefined,
        dailyDate: libraryView === "daily" ? activeDailyDate : undefined,
        databaseId: libraryView === "database" ? selectedDatabaseId || undefined : undefined,
        deleted: false,
      };

      const notesRequest =
        libraryView === "trash"
          ? getTrashedNotes({ page: 1, pageSize: 30, q: debouncedSearchQuery || undefined })
          : libraryView === "recent"
            ? getRecentNotes()
            : libraryView === "inbox"
              ? getInboxNotes({
                  page,
                  pageSize,
                  q: debouncedSearchQuery || undefined,
                  tag: selectedTagId || undefined,
                  favorite: favoriteOnly ? true : undefined,
                })
              : libraryView === "database"
                ? selectedDatabaseId
                  ? getDatabaseNotes(selectedDatabaseId).then((data) => ({ data, meta: { page: 1, pageSize: 500, total: data.length } }))
                  : Promise.resolve({ data: [], meta: { page: 1, pageSize: 30, total: 0 } })
            : libraryView === "graph" || libraryView === "knowledge"
              ? getNotes({ page: 1, pageSize: 100 })
              : getNotes(baseQuery);

      const noteResp = await notesRequest;

      if (libraryView === "trash") setTrashNotes(noteResp.data);
      else if (libraryView === "recent") setRecentNotes(noteResp.data);
      else setNotes(noteResp.data);
      setPagination({
        page: Number(noteResp.meta?.page ?? 1),
        pageSize: Number(noteResp.meta?.pageSize ?? pageSize),
        total: Number(noteResp.meta?.total ?? noteResp.data.length),
      });

      if (!selectedNoteId && !pendingNoteId && noteResp.data.length > 0 && libraryView !== "graph" && libraryView !== "knowledge") {
        const first = noteResp.data[0];
        selectLocalNote(first);
        markNoteOpen(first.id).catch(() => undefined);
      }
    } catch (error) {
      const message = getErrorMessage(error, "加载失败");
      if (!silent) setLoadError(message);
      if (!silent) toast.error(message);
      if (import.meta.env.DEV) {
        console.debug("[loadData] failed", { reason: options.reason ?? "unknown", message });
      }
    } finally {
      if (!silent) setLoading(false);
      if (import.meta.env.DEV) {
        console.debug("[loadData] completed", {
          reason: options.reason ?? "unknown",
          silent,
          ms: Math.round(performance.now() - startedAt),
        });
      }
    }
  }

  return {
    rawListNotes,
    sortedListNotes,
    listNotes,
    sortVisibleNotes,
    matchesCurrentNotesView,
    selectLocalNote,
    selectNote,
    reconcileVisibleNote,
    reconcileVisibleNotesBulk,
    loadVisibleNotes,
  };
}
