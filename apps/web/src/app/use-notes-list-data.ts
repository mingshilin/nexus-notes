import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Note } from "@nexus/contracts";
import type { NoteListOptions, NotesClient } from "../data/notes-client";

export type NoteListView = "all" | "inbox" | "today" | "favorites" | "pinned" | "archived" | "trash";

export function localDateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function noteMatchesListView(note: Note, view: NoteListView, todayDate = localDateKey()) {
  if (view === "trash") return note.status === "trashed";
  if (view === "archived") return note.status === "archived";
  if (note.status !== "active") return false;
  if (view === "inbox") return note.folder_id === null;
  if (view === "today") return note.daily_date === todayDate;
  if (view === "favorites") return note.is_favorite;
  if (view === "pinned") return note.is_pinned;
  return true;
}

export interface NotesListDataOptions {
  notesClient: Pick<NotesClient, "list">;
  workspaceId?: string;
  noteListView: NoteListView;
  noteFolderFilter: string | null;
  debouncedNoteSearchQuery: string;
  refreshVersion: number;
  installedNotesRef: MutableRefObject<Map<string, Note>>;
  activeDraftIdRef: MutableRefObject<string | null>;
  activationInFlight: MutableRefObject<boolean>;
  userSelectedNote: MutableRefObject<boolean>;
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  setCreatingNote: Dispatch<SetStateAction<boolean>>;
}

export interface NotesListDataResult {
  notes: Note[];
  setNotes: Dispatch<SetStateAction<Note[]>>;
  notesLoading: boolean;
  notesError: string | null;
  setNotesError: Dispatch<SetStateAction<string | null>>;
  notesNextCursor: string | null;
  notesPageLoading: boolean;
  loadMoreNotes(): void;
}

function optionsForView(view: NoteListView, folderId: string | null, todayDate: string): NoteListOptions {
  if (view === "inbox") return { status: "active", folderId: null, limit: 50 };
  if (view === "today") return { status: "active", dailyDate: todayDate, limit: 50 };
  if (view === "favorites") return { status: "active", favorite: true, limit: 50 };
  if (view === "pinned") return { status: "active", pinned: true, limit: 50 };
  if (view === "archived") return { status: "archived", limit: 50 };
  if (view === "trash") return { status: "trashed", limit: 50 };
  return { status: "active", folderId: folderId ?? undefined, limit: 50 };
}

function isAbort(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

export function useNotesListData(options: NotesListDataOptions): NotesListDataResult {
  const {
    notesClient,
    workspaceId,
    noteListView,
    noteFolderFilter,
    debouncedNoteSearchQuery,
    refreshVersion,
    installedNotesRef,
    activeDraftIdRef,
    activationInFlight,
    userSelectedNote,
    setSelectedNoteId,
    setCreatingNote,
  } = options;
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(Boolean(workspaceId));
  const [notesError, setNotesError] = useState<string | null>(null);
  const [notesNextCursor, setNotesNextCursor] = useState<string | null>(null);
  const [notesPageLoading, setNotesPageLoading] = useState(false);
  const pageControllerRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    pageControllerRef.current?.abort();
    pageControllerRef.current = null;
    const requestVersion = ++requestVersionRef.current;
    setNotesNextCursor(null);
    setNotesPageLoading(false);
    if (!workspaceId) {
      setNotes([]);
      setSelectedNoteId(null);
      setCreatingNote(false);
      setNotesLoading(false);
      setNotesError(null);
      return undefined;
    }

    const controller = new AbortController();
    setNotesLoading(true);
    setNotesError(null);
    const todayDate = localDateKey();
    const listOptions = optionsForView(noteListView, noteFolderFilter, todayDate);
    const requestOptions: NoteListOptions = {
      ...listOptions,
      signal: controller.signal,
      ...(debouncedNoteSearchQuery ? { query: debouncedNoteSearchQuery } : {}),
    };
    void notesClient.list(requestOptions).then((page) => {
      if (controller.signal.aborted || requestVersionRef.current !== requestVersion) return;
      const activeNotes = page.items.filter((note) => noteMatchesListView(note, noteListView, todayDate));
      const installedNotes = [...installedNotesRef.current.values()].filter((note) => note.workspace_id === workspaceId
        && noteMatchesListView(note, noteListView, todayDate)
        && (!debouncedNoteSearchQuery || [note.title, note.content].join("\n").toLocaleLowerCase().includes(debouncedNoteSearchQuery.toLocaleLowerCase()))
        && (noteFolderFilter === null || note.folder_id === noteFolderFilter));
      const byId = new Map([...activeNotes, ...installedNotes].map((note) => [note.id, note]));
      setNotes([...byId.values()]);
      setNotesNextCursor(page.next_cursor);
      if (!activeDraftIdRef.current && !activationInFlight.current && !userSelectedNote.current) {
        setSelectedNoteId([...byId.values()][0]?.id ?? null);
        setCreatingNote(false);
      }
    }).catch((error: unknown) => {
      if (requestVersionRef.current === requestVersion && !isAbort(error, controller.signal)) {
        setNotesError("笔记列表暂时无法加载。你仍可以尝试新建笔记。");
      }
    }).finally(() => {
      if (!controller.signal.aborted && requestVersionRef.current === requestVersion) setNotesLoading(false);
    });

    return () => {
      controller.abort();
      pageControllerRef.current?.abort();
      pageControllerRef.current = null;
      requestVersionRef.current += 1;
    };
  }, [activeDraftIdRef, activationInFlight, debouncedNoteSearchQuery, installedNotesRef, noteFolderFilter, noteListView, notesClient, refreshVersion, setCreatingNote, setSelectedNoteId, userSelectedNote, workspaceId]);

  const loadMoreNotes = useCallback(() => {
    if (!workspaceId || !notesNextCursor || notesLoading || notesPageLoading) return;
    pageControllerRef.current?.abort();
    const controller = new AbortController();
    pageControllerRef.current = controller;
    const requestVersion = ++requestVersionRef.current;
    const todayDate = localDateKey();
    const requestOptions: NoteListOptions = {
      ...optionsForView(noteListView, noteFolderFilter, todayDate),
      cursor: notesNextCursor,
      signal: controller.signal,
      ...(debouncedNoteSearchQuery ? { query: debouncedNoteSearchQuery } : {}),
    };
    setNotesPageLoading(true);
    void notesClient.list(requestOptions).then((page) => {
      if (controller.signal.aborted || requestVersionRef.current !== requestVersion) return;
      setNotes((current) => {
        const byId = new Map(current.map((note) => [note.id, note]));
        page.items.forEach((note) => byId.set(note.id, note));
        return [...byId.values()];
      });
      setNotesNextCursor(page.next_cursor);
    }).catch((error: unknown) => {
      if (requestVersionRef.current === requestVersion && !isAbort(error, controller.signal)) setNotesError("更多笔记暂时无法加载，请重试。");
    }).finally(() => {
      if (requestVersionRef.current !== requestVersion || controller.signal.aborted) return;
      pageControllerRef.current = null;
      setNotesPageLoading(false);
    });
  }, [debouncedNoteSearchQuery, noteFolderFilter, noteListView, notesClient, notesLoading, notesNextCursor, notesPageLoading, workspaceId]);

  return { notes, setNotes, notesLoading, notesError, setNotesError, notesNextCursor, notesPageLoading, loadMoreNotes };
}
