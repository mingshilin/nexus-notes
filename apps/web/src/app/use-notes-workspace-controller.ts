import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Note } from "@nexus/contracts";
import type { DatabaseClient } from "../data/database-client";
import type { KnowledgeClient } from "../data/knowledge-client";
import type { NotesClient } from "../data/notes-client";
import { NoteDraftController, type DraftSyncResult, type NoteDraftStore } from "../notes/note-draft-controller";
import { useNoteInspectorData } from "./use-note-inspector-data";
import { useNotesListData, type NoteListView } from "./use-notes-list-data";

export interface UseNotesWorkspaceControllerParams {
  notesClient: NotesClient;
  knowledgeClient: KnowledgeClient;
  databaseClient: DatabaseClient;
  workspaceId?: string;
  refreshVersion: number;
  localStore: NoteDraftStore;
  draftControllerRef: MutableRefObject<NoteDraftController | null>;
}

export function useNotesWorkspaceController({
  notesClient,
  knowledgeClient,
  databaseClient,
  workspaceId,
  refreshVersion,
  localStore,
  draftControllerRef,
}: UseNotesWorkspaceControllerParams) {
  const [noteFolderFilter, setNoteFolderFilter] = useState<string | null>(null);
  const [noteSearchQuery, setNoteSearchQuery] = useState("");
  const [debouncedNoteSearchQuery, setDebouncedNoteSearchQuery] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [noteListView, setNoteListView] = useState<NoteListView>("all");
  const [creatingNote, setCreatingNote] = useState(false);
  const [dailyNoteOpening, setDailyNoteOpening] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [draftFolderId, setDraftFolderId] = useState<string | null>(null);
  const [draftDatabaseId, setDraftDatabaseId] = useState<string | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [serverRetryVersion, setServerRetryVersion] = useState(0);
  const [noteConflict, setNoteConflict] = useState<{
    workspaceId: string;
    entityId: string;
    local: { title: string; content: string };
    server: Note;
  } | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [pendingReconcile, setPendingReconcile] = useState<{
    workspaceId: string;
    entityId: string;
    result: DraftSyncResult;
  } | null>(null);
  const noteListViewRef = useRef<NoteListView>(noteListView);
  const [draftController] = useState(() => new NoteDraftController(localStore));
  const activeDraftIdRef = useRef<string | null>(null);
  const activationInFlight = useRef(false);
  const dailyNoteOpeningRef = useRef(false);
  const userSelectedNote = useRef(false);
  const draftTitleRef = useRef("");
  const draftContentRef = useRef("");
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const focusInstalledNoteRef = useRef(false);
  const installedNotesRef = useRef(new Map<string, Note>());
  const mountedRef = useRef(true);

  const notesData = useNotesListData({
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
  });
  const inspectorData = useNoteInspectorData({
    knowledgeClient,
    databaseClient,
    notesClient,
    workspaceId,
    selectedNoteId,
    creatingNote,
  });
  const selectedNote = notesData.notes.find((note) => note.id === selectedNoteId) ?? null;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedNoteSearchQuery(noteSearchQuery.trim().slice(0, 500));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [noteSearchQuery]);

  useEffect(() => {
    setNoteSearchQuery("");
    setDebouncedNoteSearchQuery("");
  }, [workspaceId]);

  useEffect(() => {
    draftControllerRef.current = draftController;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (draftControllerRef.current === draftController) draftControllerRef.current = null;
      void draftController.flush().catch(() => undefined);
    };
  }, [draftController, draftControllerRef]);

  useEffect(() => {
    if (!creatingNote && !focusInstalledNoteRef.current) return;
    titleInputRef.current?.focus();
    focusInstalledNoteRef.current = false;
  }, [activeDraftId, creatingNote, selectedNoteId]);

  useEffect(() => {
    if (creatingNote) return;
    if (selectedNote) {
      setDraftTitle(selectedNote.title);
      setDraftContent(selectedNote.content);
      setDraftFolderId(selectedNote.folder_id);
      setDraftDatabaseId(selectedNote.database_id);
      draftTitleRef.current = selectedNote.title;
      draftContentRef.current = selectedNote.content;
    } else {
      setDraftTitle("");
      setDraftContent("");
      setDraftFolderId(null);
      setDraftDatabaseId(null);
      draftTitleRef.current = "";
      draftContentRef.current = "";
    }
  }, [creatingNote, selectedNote]);

  return {
    noteFolderFilter,
    setNoteFolderFilter,
    noteSearchQuery,
    setNoteSearchQuery,
    debouncedNoteSearchQuery,
    setDebouncedNoteSearchQuery,
    selectedNoteId,
    setSelectedNoteId,
    noteListView,
    setNoteListView,
    creatingNote,
    setCreatingNote,
    dailyNoteOpening,
    setDailyNoteOpening,
    draftTitle,
    setDraftTitle,
    draftContent,
    setDraftContent,
    editorMode,
    setEditorMode,
    draftFolderId,
    setDraftFolderId,
    draftDatabaseId,
    setDraftDatabaseId,
    activeDraftId,
    setActiveDraftId,
    serverRetryVersion,
    setServerRetryVersion,
    noteConflict,
    setNoteConflict,
    resolvingConflict,
    setResolvingConflict,
    pendingReconcile,
    setPendingReconcile,
    noteListViewRef,
    draftController,
    activeDraftIdRef,
    activationInFlight,
    dailyNoteOpeningRef,
    userSelectedNote,
    draftTitleRef,
    draftContentRef,
    titleInputRef,
    focusInstalledNoteRef,
    installedNotesRef,
    mountedRef,
    selectedNote,
    ...notesData,
    ...inspectorData,
  };
}

export type NotesWorkspaceController = ReturnType<typeof useNotesWorkspaceController>;
