import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Note, WorkspaceRoleContract } from "@nexus/contracts";

import { ApiClientError } from "../data/api-client";
import type { NotesClient } from "../data/notes-client";
import type { NoteListView } from "./use-notes-list-data";

type NoteMutationClient = Pick<NotesClient, "update" | "deletePermanently">;
type NoteFlag = "is_favorite" | "is_pinned";
type NoteStatus = "active" | "archived" | "trashed";

export interface NoteMutationDraft {
  title: string;
  content: string;
  folderId: string | null;
  databaseId: string | null;
}

export interface UseNoteMutationsParams {
  notesClient: NoteMutationClient;
  workspaceId?: string;
  role: WorkspaceRoleContract;
  logoutPending: boolean;
  selectedNote: Note | null;
  draft: NoteMutationDraft;
  installNote(note: Note): void;
  selectListView(view: NoteListView): void;
  completeStatusChange(): void;
  completePermanentDelete(noteId: string): void;
}

export interface NoteMutationState {
  noteSaving: boolean;
  setNoteSaving: Dispatch<SetStateAction<boolean>>;
  noteMessage: string | null;
  setNoteMessage: Dispatch<SetStateAction<string | null>>;
  noteError: string | null;
  setNoteError: Dispatch<SetStateAction<string | null>>;
  permanentDeletePending: boolean;
  permanentDeleteError: string | null;
  setPermanentDeleteError: Dispatch<SetStateAction<string | null>>;
  saveExistingNote(): Promise<void>;
  changeSelectedNoteStatus(status: NoteStatus): Promise<void>;
  toggleSelectedNoteFlag(field: NoteFlag): Promise<void>;
  deleteSelectedNotePermanently(): Promise<void>;
}

interface NoteMutationScope {
  notesClient: NoteMutationClient;
  workspaceId?: string;
  role: WorkspaceRoleContract;
  logoutPending: boolean;
  noteId: string | null;
  noteRevision: number | null;
  noteStatus: NoteStatus | null;
  draft: NoteMutationDraft;
}

interface NoteMutationRequest {
  controller: AbortController;
  version: number;
  notesClient: NoteMutationClient;
  workspaceId: string;
  role: WorkspaceRoleContract;
  noteId: string;
  noteRevision: number;
  baseRevision: number;
  noteStatus: NoteStatus;
  draft: NoteMutationDraft;
}

type NoteMutationIdentity = Pick<NoteMutationScope, "notesClient" | "workspaceId" | "role" | "logoutPending" | "noteId" | "noteRevision" | "noteStatus">;

function sameDraft(left: NoteMutationDraft, right: NoteMutationDraft) {
  return left.title === right.title
    && left.content === right.content
    && left.folderId === right.folderId
    && left.databaseId === right.databaseId;
}

function sameMutationIdentity(left: NoteMutationIdentity, right: NoteMutationIdentity) {
  return left.notesClient === right.notesClient
    && left.workspaceId === right.workspaceId
    && left.role === right.role
    && left.logoutPending === right.logoutPending
    && left.noteId === right.noteId
    && left.noteRevision === right.noteRevision
    && left.noteStatus === right.noteStatus;
}

function sameScope(left: NoteMutationScope, right: NoteMutationScope) {
  return sameMutationIdentity(left, right);
}

function isAborted(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function validServerNote(value: unknown, request: NoteMutationRequest): value is Note {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Note>;
  return candidate.id === request.noteId
    && candidate.workspace_id === request.workspaceId
    && typeof candidate.revision === "number"
    && Number.isInteger(candidate.revision)
    && candidate.revision > request.baseRevision;
}

function permanentDeleteErrorMessage(error: unknown) {
  const candidate = error instanceof ApiClientError
    ? { code: error.code, retryable: error.retryable, requestId: error.requestId }
    : typeof error === "object" && error !== null
      ? error as { code?: unknown; retryable?: unknown; requestId?: unknown; request_id?: unknown }
      : {};
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const retryable = candidate.retryable === true;
  const requestId = typeof candidate.requestId === "string"
    ? candidate.requestId
    : typeof candidate.request_id === "string" ? candidate.request_id : undefined;
  const message = code === "NOTE_CONFLICT"
    ? "笔记已发生变化。请刷新回收站后再试。"
    : code === "NOTE_NOT_TRASHED"
      ? "笔记已不在回收站中。请刷新回收站后再试。"
      : code === "NOTE_NOT_FOUND"
        ? "笔记已不存在或无权访问。请刷新回收站后再试。"
        : code === "NETWORK_ERROR" || code === "TIMEOUT" || retryable
          ? "网络或服务暂时不可用。笔记仍保留在回收站中，可安全重试。"
          : "永久删除失败，请重试。笔记仍保留在回收站中。";
  const safeRequestId = requestId && /^[A-Za-z0-9._:-]{1,128}$/u.test(requestId) ? requestId : undefined;
  return safeRequestId ? `${message} 请求 ID：${safeRequestId}` : message;
}

export function useNoteMutations({
  notesClient,
  workspaceId,
  role,
  logoutPending,
  selectedNote,
  draft,
  installNote,
  selectListView,
  completeStatusChange,
  completePermanentDelete,
}: UseNoteMutationsParams): NoteMutationState {
  const [noteSavingState, setNoteSavingState] = useState(false);
  const [noteMessage, setNoteMessage] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [permanentDeletePending, setPermanentDeletePending] = useState(false);
  const [permanentDeleteError, setPermanentDeleteError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const noteSavingRef = useRef(false);
  const permanentDeletePendingRef = useRef(false);
  const noteControllerRef = useRef<AbortController | null>(null);
  const deleteControllerRef = useRef<AbortController | null>(null);
  const noteMutationVersionRef = useRef(0);
  const deleteMutationVersionRef = useRef(0);
  const latestRevisionByNoteRef = useRef(new Map<string, number>());
  const scopeRef = useRef<NoteMutationScope>({
    notesClient,
    workspaceId,
    role,
    logoutPending,
    noteId: selectedNote?.id ?? null,
    noteRevision: selectedNote?.revision ?? null,
    noteStatus: selectedNote?.status ?? null,
    draft: { ...draft },
  });

  const setNoteSaving: Dispatch<SetStateAction<boolean>> = useCallback((next) => {
    const value = typeof next === "function" ? next(noteSavingRef.current) : next;
    noteSavingRef.current = value;
    if (mountedRef.current) setNoteSavingState(value);
  }, []);

  const setPermanentDeletePendingSafe = useCallback((next: boolean) => {
    permanentDeletePendingRef.current = next;
    if (mountedRef.current) setPermanentDeletePending(next);
  }, []);

  useLayoutEffect(() => {
    const nextScope: NoteMutationScope = {
      notesClient,
      workspaceId,
      role,
      logoutPending,
      noteId: selectedNote?.id ?? null,
      noteRevision: selectedNote?.revision ?? null,
      noteStatus: selectedNote?.status ?? null,
      draft: { ...draft },
    };
    if (!sameScope(scopeRef.current, nextScope)) {
      noteControllerRef.current?.abort();
      deleteControllerRef.current?.abort();
      noteControllerRef.current = null;
      deleteControllerRef.current = null;
      noteMutationVersionRef.current += 1;
      deleteMutationVersionRef.current += 1;
      noteSavingRef.current = false;
      permanentDeletePendingRef.current = false;
      if (mountedRef.current) {
        setNoteSavingState(false);
        setPermanentDeletePending(false);
      }
    }
    scopeRef.current = nextScope;
  }, [draft.content, draft.databaseId, draft.folderId, draft.title, logoutPending, notesClient, role, selectedNote?.id, selectedNote?.revision, selectedNote?.status, workspaceId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      noteControllerRef.current?.abort();
      deleteControllerRef.current?.abort();
      noteControllerRef.current = null;
      deleteControllerRef.current = null;
      noteMutationVersionRef.current += 1;
      deleteMutationVersionRef.current += 1;
      noteSavingRef.current = false;
      permanentDeletePendingRef.current = false;
    };
  }, []);

  const revisionKey = useCallback((currentWorkspaceId: string, noteId: string) => `${currentWorkspaceId}:${noteId}`, []);

  const baseRevisionFor = useCallback((currentNote: Note, currentWorkspaceId: string) => Math.max(
    currentNote.revision,
    latestRevisionByNoteRef.current.get(revisionKey(currentWorkspaceId, currentNote.id)) ?? 0,
  ), [revisionKey]);

  const rememberServerRevision = useCallback((value: unknown, request: NoteMutationRequest) => {
    if (!validServerNote(value, request)) return;
    const key = revisionKey(request.workspaceId, request.noteId);
    const current = latestRevisionByNoteRef.current.get(key) ?? 0;
    if (value.revision > current) latestRevisionByNoteRef.current.set(key, value.revision);
  }, [revisionKey]);

  const isCurrentNoteRequest = useCallback((request: NoteMutationRequest) => {
    const current = scopeRef.current;
    return !request.controller.signal.aborted
      && mountedRef.current
      && noteMutationVersionRef.current === request.version
      && current.notesClient === request.notesClient
      && current.workspaceId === request.workspaceId
      && current.role === request.role
      && !current.logoutPending
      && current.noteId === request.noteId
      && current.noteRevision === request.noteRevision
      && current.noteStatus === request.noteStatus
      && sameDraft(current.draft, request.draft);
  }, []);

  const isCurrentDeleteRequest = useCallback((request: NoteMutationRequest) => {
    const current = scopeRef.current;
    return !request.controller.signal.aborted
      && mountedRef.current
      && deleteMutationVersionRef.current === request.version
      && current.notesClient === request.notesClient
      && current.workspaceId === request.workspaceId
      && current.role === request.role
      && !current.logoutPending
      && current.noteId === request.noteId
      && current.noteRevision === request.noteRevision
      && current.noteStatus === request.noteStatus
      && sameDraft(current.draft, request.draft);
  }, []);

  const beginNoteRequest = useCallback((): NoteMutationRequest | null => {
    if (!mountedRef.current || logoutPending || role === "viewer" || !workspaceId || !selectedNote || noteSavingRef.current) return null;
    if (!sameMutationIdentity(scopeRef.current, {
      notesClient,
      workspaceId,
      role,
      logoutPending,
      noteId: selectedNote.id,
      noteRevision: selectedNote.revision,
      noteStatus: selectedNote.status,
    }) || !sameDraft(scopeRef.current.draft, draft)) return null;
    const request: NoteMutationRequest = {
      controller: new AbortController(),
      version: noteMutationVersionRef.current + 1,
      notesClient,
      workspaceId,
      role,
      noteId: selectedNote.id,
      noteRevision: selectedNote.revision,
      baseRevision: baseRevisionFor(selectedNote, workspaceId),
      noteStatus: selectedNote.status,
      draft: { ...draft },
    };
    noteControllerRef.current?.abort();
    noteControllerRef.current = request.controller;
    noteMutationVersionRef.current = request.version;
    noteSavingRef.current = true;
    if (mountedRef.current) setNoteSavingState(true);
    setNoteMessage(null);
    setNoteError(null);
    return request;
  }, [baseRevisionFor, draft, logoutPending, notesClient, role, selectedNote, workspaceId]);

  const finishNoteRequest = useCallback((request: NoteMutationRequest) => {
    if (noteControllerRef.current === request.controller) noteControllerRef.current = null;
    if (noteMutationVersionRef.current !== request.version) return;
    noteSavingRef.current = false;
    if (mountedRef.current) setNoteSavingState(false);
  }, []);

  const saveExistingNote = useCallback(async () => {
    const request = beginNoteRequest();
    if (!request) return;
    try {
      const saved = await notesClient.update(request.noteId, {
        base_revision: request.baseRevision,
        title: request.draft.title,
        content: request.draft.content,
        folder_id: request.draft.folderId,
        database_id: request.draft.databaseId,
        source: "manual",
      }, { signal: request.controller.signal });
      if (!validServerNote(saved, request)) {
        if (isCurrentNoteRequest(request)) setNoteError("笔记保存失败，请稍后重试。未保存的内容仍保留在当前编辑器中。");
        return;
      }
      rememberServerRevision(saved, request);
      if (!isCurrentNoteRequest(request)) return;
      installNote(saved);
      setNoteMessage("已保存");
    } catch (error: unknown) {
      if (isCurrentNoteRequest(request) && !isAborted(error, request.controller.signal)) setNoteError("笔记保存失败，请稍后重试。未保存的内容仍保留在当前编辑器中。");
    } finally {
      finishNoteRequest(request);
    }
  }, [beginNoteRequest, finishNoteRequest, installNote, isCurrentNoteRequest, notesClient, rememberServerRevision]);

  const changeSelectedNoteStatus = useCallback(async (status: NoteStatus) => {
    const request = beginNoteRequest();
    if (!request) return;
    const original = selectedNote!;
    const contentChanged = request.draft.title !== original.title || request.draft.content !== original.content;
    const folderChanged = request.draft.folderId !== original.folder_id;
    const databaseChanged = request.draft.databaseId !== original.database_id;
    try {
      const saved = await notesClient.update(request.noteId, {
        base_revision: request.baseRevision,
        status,
        source: "manual",
        ...(contentChanged ? { title: request.draft.title, content: request.draft.content } : {}),
        ...(folderChanged ? { folder_id: request.draft.folderId } : {}),
        ...(databaseChanged ? { database_id: request.draft.databaseId } : {}),
      }, { signal: request.controller.signal });
      if (!validServerNote(saved, request)) {
        if (isCurrentNoteRequest(request)) setNoteError(status === "trashed" ? "移入回收站失败，请稍后重试。" : "恢复笔记失败，请稍后重试。");
        return;
      }
      rememberServerRevision(saved, request);
      if (!isCurrentNoteRequest(request)) return;
      const nextView: NoteListView = status === "trashed" ? "trash" : status === "archived" ? "archived" : "all";
      selectListView(nextView);
      installNote(saved);
      setNoteMessage(status === "trashed" ? "已移入回收站" : "已恢复");
      completeStatusChange();
    } catch (error: unknown) {
      if (isCurrentNoteRequest(request) && !isAborted(error, request.controller.signal)) setNoteError(status === "trashed" ? "移入回收站失败，请稍后重试。" : "恢复笔记失败，请稍后重试。");
    } finally {
      finishNoteRequest(request);
    }
  }, [beginNoteRequest, completeStatusChange, finishNoteRequest, installNote, isCurrentNoteRequest, notesClient, rememberServerRevision, selectedNote, selectListView]);

  const toggleSelectedNoteFlag = useCallback(async (field: NoteFlag) => {
    if (!selectedNote || selectedNote.status === "trashed") return;
    const request = beginNoteRequest();
    if (!request) return;
    const nextValue = !selectedNote[field];
    try {
      const saved = await notesClient.update(request.noteId, {
        base_revision: request.baseRevision,
        [field]: nextValue,
        source: "manual",
      }, { signal: request.controller.signal });
      if (!validServerNote(saved, request)) {
        if (isCurrentNoteRequest(request)) setNoteError(field === "is_favorite" ? "收藏状态保存失败，请重试。" : "置顶状态保存失败，请重试。");
        return;
      }
      rememberServerRevision(saved, request);
      if (!isCurrentNoteRequest(request)) return;
      installNote(saved);
      setNoteMessage(field === "is_favorite"
        ? nextValue ? "已加入收藏" : "已取消收藏"
        : nextValue ? "已置顶" : "已取消置顶");
    } catch (error: unknown) {
      if (isCurrentNoteRequest(request) && !isAborted(error, request.controller.signal)) setNoteError(field === "is_favorite" ? "收藏状态保存失败，请重试。" : "置顶状态保存失败，请重试。");
    } finally {
      finishNoteRequest(request);
    }
  }, [beginNoteRequest, finishNoteRequest, installNote, isCurrentNoteRequest, notesClient, rememberServerRevision, selectedNote]);

  const deleteSelectedNotePermanently = useCallback(async () => {
    if (!mountedRef.current || logoutPending || role === "viewer" || permanentDeletePendingRef.current || !workspaceId || !selectedNote || selectedNote.status !== "trashed") return;
    if (!sameMutationIdentity(scopeRef.current, {
      notesClient,
      workspaceId,
      role,
      logoutPending,
      noteId: selectedNote.id,
      noteRevision: selectedNote.revision,
      noteStatus: selectedNote.status,
    }) || !sameDraft(scopeRef.current.draft, draft)) return;
    const request: NoteMutationRequest = {
      controller: new AbortController(),
      version: deleteMutationVersionRef.current + 1,
      notesClient,
      workspaceId,
      role,
      noteId: selectedNote.id,
      noteRevision: selectedNote.revision,
      baseRevision: baseRevisionFor(selectedNote, workspaceId),
      noteStatus: selectedNote.status,
      draft: { ...draft },
    };
    deleteControllerRef.current?.abort();
    deleteControllerRef.current = request.controller;
    deleteMutationVersionRef.current = request.version;
    setPermanentDeletePendingSafe(true);
    if (mountedRef.current) setPermanentDeleteError(null);
    try {
      await notesClient.deletePermanently(request.noteId, { base_revision: request.baseRevision }, request.controller.signal);
      if (!isCurrentDeleteRequest(request)) return;
      setNoteMessage("笔记已永久删除");
      completePermanentDelete(request.noteId);
    } catch (error: unknown) {
      if (isCurrentDeleteRequest(request) && !isAborted(error, request.controller.signal)) setPermanentDeleteError(permanentDeleteErrorMessage(error));
    } finally {
      if (deleteControllerRef.current === request.controller) deleteControllerRef.current = null;
      if (deleteMutationVersionRef.current === request.version) setPermanentDeletePendingSafe(false);
    }
  }, [completePermanentDelete, draft, isCurrentDeleteRequest, logoutPending, notesClient, role, selectedNote, setPermanentDeletePendingSafe, workspaceId]);

  return {
    noteSaving: noteSavingState,
    setNoteSaving,
    noteMessage,
    setNoteMessage,
    noteError,
    setNoteError,
    permanentDeletePending,
    permanentDeleteError,
    setPermanentDeleteError,
    saveExistingNote,
    changeSelectedNoteStatus,
    toggleSelectedNoteFlag,
    deleteSelectedNotePermanently,
  };
}
