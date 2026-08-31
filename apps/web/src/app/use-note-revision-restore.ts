import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Note, NoteRevision, WorkspaceRoleContract } from "@nexus/contracts";

import { ApiClientError } from "../data/api-client";
import type { NotesClient } from "../data/notes-client";

type NoteRevisionClient = Pick<NotesClient, "restore">;

export interface UseNoteRevisionRestoreParams {
  notesClient: NoteRevisionClient;
  workspaceId?: string;
  role: WorkspaceRoleContract;
  logoutPending: boolean;
  selectedNote: Note | null;
  installNote(note: Note): void;
  resetHistory(): void;
  setHistoryError: Dispatch<SetStateAction<string | null>>;
  setNoteMessage: Dispatch<SetStateAction<string | null>>;
}

export interface NoteRevisionRestoreState {
  restoringRevision: number | null;
  restoreRevision(revision: NoteRevision): Promise<void>;
  abortRestore(): void;
}

function isAborted(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function restoreErrorMessage(error: unknown) {
  return error instanceof ApiClientError && error.code === "NOTE_CONFLICT"
    ? "笔记已发生变化，历史版本没有覆盖当前内容。请重新加载历史后再试。"
    : "版本恢复失败，当前内容仍保留。请重试。";
}

export function useNoteRevisionRestore({
  notesClient,
  workspaceId,
  role,
  logoutPending,
  selectedNote,
  installNote,
  resetHistory,
  setHistoryError,
  setNoteMessage,
}: UseNoteRevisionRestoreParams): NoteRevisionRestoreState {
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);
  const mountedRef = useRef(true);
  const pendingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const scopeRef = useRef({
    notesClient,
    workspaceId,
    role,
    logoutPending,
    noteId: selectedNote?.id ?? null,
    noteRevision: selectedNote?.revision ?? null,
    noteStatus: selectedNote?.status ?? null,
  });

  useLayoutEffect(() => {
    const nextScope = {
      notesClient,
      workspaceId,
      role,
      logoutPending,
      noteId: selectedNote?.id ?? null,
      noteRevision: selectedNote?.revision ?? null,
      noteStatus: selectedNote?.status ?? null,
    };
    const current = scopeRef.current;
    const changed = current.notesClient !== nextScope.notesClient
      || current.workspaceId !== nextScope.workspaceId
      || current.role !== nextScope.role
      || current.logoutPending !== nextScope.logoutPending
      || current.noteId !== nextScope.noteId
      || current.noteRevision !== nextScope.noteRevision
      || current.noteStatus !== nextScope.noteStatus;
    if (changed) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      requestVersionRef.current += 1;
      pendingRef.current = false;
      if (mountedRef.current) setRestoringRevision(null);
    }
    scopeRef.current = nextScope;
  }, [logoutPending, notesClient, role, selectedNote, workspaceId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
      requestVersionRef.current += 1;
      pendingRef.current = false;
    };
  }, []);

  const abortRestore = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    requestVersionRef.current += 1;
    pendingRef.current = false;
    if (mountedRef.current) setRestoringRevision(null);
  }, []);

  const restoreRevision = useCallback(async (revision: NoteRevision) => {
    const note = selectedNote;
    const requestWorkspaceId = workspaceId;
    const requestClient = notesClient;
    const requestRole = role;
    const requestNoteId = note?.id;
    const requestNoteRevision = note?.revision;
    if (!mountedRef.current
      || logoutPending
      || requestRole === "viewer"
      || !requestWorkspaceId
      || !note
      || note.status === "trashed"
      || requestNoteId === undefined
      || requestNoteRevision === undefined
      || pendingRef.current
      || scopeRef.current.notesClient !== requestClient
      || scopeRef.current.workspaceId !== requestWorkspaceId
      || scopeRef.current.role !== requestRole
      || scopeRef.current.logoutPending
      || scopeRef.current.noteId !== requestNoteId
      || scopeRef.current.noteRevision !== requestNoteRevision
      || revision.note_id !== requestNoteId
      || revision.workspace_id !== requestWorkspaceId) return;

    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    const version = ++requestVersionRef.current;
    pendingRef.current = true;
    setRestoringRevision(revision.revision);
    setHistoryError(null);

    const isCurrent = () => !controller.signal.aborted
      && mountedRef.current
      && requestVersionRef.current === version
      && scopeRef.current.notesClient === requestClient
      && scopeRef.current.workspaceId === requestWorkspaceId
      && scopeRef.current.role === requestRole
      && !scopeRef.current.logoutPending
      && scopeRef.current.noteId === requestNoteId
      && scopeRef.current.noteRevision === requestNoteRevision;

    try {
      const saved = await requestClient.restore(requestNoteId, revision.revision, {
        base_revision: requestNoteRevision,
      }, controller.signal);
      if (!isCurrent()) return;
      if (saved.id !== requestNoteId || saved.workspace_id !== requestWorkspaceId) {
        setHistoryError("服务器返回的版本与当前笔记不匹配，请重新加载历史后再试。");
        return;
      }
      installNote(saved);
      setNoteMessage(`已恢复版本 ${revision.revision}`);
      resetHistory();
    } catch (error: unknown) {
      if (isCurrent() && !isAborted(error, controller.signal)) setHistoryError(restoreErrorMessage(error));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (requestVersionRef.current === version) {
        pendingRef.current = false;
        if (mountedRef.current) setRestoringRevision(null);
      }
    }
  }, [installNote, logoutPending, notesClient, resetHistory, role, selectedNote, setHistoryError, setNoteMessage, workspaceId]);

  return { restoringRevision, restoreRevision, abortRestore };
}
