import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
  const noteSavingRef = useRef(false);
  const permanentDeletePendingRef = useRef(false);

  const setNoteSaving: Dispatch<SetStateAction<boolean>> = useCallback((next) => {
    const value = typeof next === "function" ? next(noteSavingRef.current) : next;
    noteSavingRef.current = value;
    setNoteSavingState(value);
  }, []);

  const beginNoteMutation = () => {
    if (noteSavingRef.current) return false;
    setNoteSaving(true);
    setNoteMessage(null);
    setNoteError(null);
    return true;
  };

  const saveExistingNote = async () => {
    if (logoutPending || !workspaceId || !selectedNote || !beginNoteMutation()) return;
    try {
      const saved = await notesClient.update(selectedNote.id, {
        base_revision: selectedNote.revision,
        title: draft.title,
        content: draft.content,
        folder_id: draft.folderId,
        database_id: draft.databaseId,
        source: "manual",
      });
      installNote(saved);
      setNoteMessage("已保存");
    } catch {
      setNoteError("笔记保存失败，请稍后重试。未保存的内容仍保留在当前编辑器中。");
    } finally {
      setNoteSaving(false);
    }
  };

  const changeSelectedNoteStatus = async (status: NoteStatus) => {
    if (logoutPending || !workspaceId || !selectedNote || !beginNoteMutation()) return;
    const contentChanged = draft.title !== selectedNote.title || draft.content !== selectedNote.content;
    const folderChanged = draft.folderId !== selectedNote.folder_id;
    const databaseChanged = draft.databaseId !== selectedNote.database_id;
    try {
      const saved = await notesClient.update(selectedNote.id, {
        base_revision: selectedNote.revision,
        status,
        source: "manual",
        ...(contentChanged ? { title: draft.title, content: draft.content } : {}),
        ...(folderChanged ? { folder_id: draft.folderId } : {}),
        ...(databaseChanged ? { database_id: draft.databaseId } : {}),
      });
      const nextView: NoteListView = status === "trashed" ? "trash" : status === "archived" ? "archived" : "all";
      selectListView(nextView);
      installNote(saved);
      setNoteMessage(status === "trashed" ? "已移入回收站" : "已恢复");
      completeStatusChange();
    } catch {
      setNoteError(status === "trashed" ? "移入回收站失败，请稍后重试。" : "恢复笔记失败，请稍后重试。");
    } finally {
      setNoteSaving(false);
    }
  };

  const toggleSelectedNoteFlag = async (field: NoteFlag) => {
    if (
      logoutPending
      || role === "viewer"
      || !workspaceId
      || !selectedNote
      || selectedNote.status === "trashed"
      || !beginNoteMutation()
    ) return;
    const nextValue = !selectedNote[field];
    try {
      const saved = await notesClient.update(selectedNote.id, {
        base_revision: selectedNote.revision,
        [field]: nextValue,
        source: "manual",
      });
      installNote(saved);
      setNoteMessage(field === "is_favorite"
        ? nextValue ? "已加入收藏" : "已取消收藏"
        : nextValue ? "已置顶" : "已取消置顶");
    } catch {
      setNoteError(field === "is_favorite" ? "收藏状态保存失败，请重试。" : "置顶状态保存失败，请重试。");
    } finally {
      setNoteSaving(false);
    }
  };

  const deleteSelectedNotePermanently = async () => {
    if (
      logoutPending
      || permanentDeletePendingRef.current
      || !workspaceId
      || !selectedNote
      || selectedNote.status !== "trashed"
    ) return;
    permanentDeletePendingRef.current = true;
    setPermanentDeletePending(true);
    setPermanentDeleteError(null);
    try {
      await notesClient.deletePermanently(selectedNote.id, {
        base_revision: selectedNote.revision,
      });
      setNoteMessage("笔记已永久删除");
      completePermanentDelete(selectedNote.id);
    } catch (error: unknown) {
      setPermanentDeleteError(permanentDeleteErrorMessage(error));
    } finally {
      permanentDeletePendingRef.current = false;
      setPermanentDeletePending(false);
    }
  };

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
