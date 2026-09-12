import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Note } from "@nexus/contracts";

import type { CreateActionResult } from "../create/CreateCenter";
import type { NotesClient } from "../data/notes-client";
import { localDateKey, type NoteListView } from "./use-notes-list-data";

type DailyNoteClient = Pick<NotesClient, "openOrCreateDaily">;

export interface UseDailyNoteOpenParams {
  notesClient: DailyNoteClient;
  workspaceId?: string;
  logoutPending: boolean;
  selectedNoteId: string | null;
  noteListView: NoteListView;
  activeDraftId: string | null;
  creatingNote: boolean;
  notes: Note[];
  openNote(note: Note, installed: boolean): void;
  setNoteError: Dispatch<SetStateAction<string | null>>;
}

export interface DailyNoteOpenState {
  dailyNoteOpening: boolean;
  openTodayNote(): Promise<CreateActionResult>;
  abortTodayNoteOpen(): void;
}

const dailyOpenFailureMessage = "今日笔记暂时无法打开，可重试。当前选择和草稿内容已保留。";
const staleDailyOpenMessage = "当前选择已变化，未切换到今日笔记。";

function isAborted(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

export function useDailyNoteOpen({
  notesClient,
  workspaceId,
  logoutPending,
  selectedNoteId,
  noteListView,
  activeDraftId,
  creatingNote,
  notes,
  openNote,
  setNoteError,
}: UseDailyNoteOpenParams): DailyNoteOpenState {
  const [dailyNoteOpening, setDailyNoteOpening] = useState(false);
  const mountedRef = useRef(true);
  const pendingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const callbackRef = useRef(openNote);
  callbackRef.current = openNote;
  const scopeRef = useRef({ notesClient, workspaceId, logoutPending, selectedNoteId, noteListView, activeDraftId, creatingNote });

  useLayoutEffect(() => {
    const nextScope = { notesClient, workspaceId, logoutPending, selectedNoteId, noteListView, activeDraftId, creatingNote };
    const current = scopeRef.current;
    const changed = current.notesClient !== nextScope.notesClient
      || current.workspaceId !== nextScope.workspaceId
      || current.logoutPending !== nextScope.logoutPending
      || current.selectedNoteId !== nextScope.selectedNoteId
      || current.noteListView !== nextScope.noteListView
      || current.activeDraftId !== nextScope.activeDraftId
      || current.creatingNote !== nextScope.creatingNote;
    if (changed) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      requestVersionRef.current += 1;
      pendingRef.current = false;
      if (mountedRef.current) setDailyNoteOpening(false);
    }
    scopeRef.current = nextScope;
  }, [activeDraftId, creatingNote, logoutPending, noteListView, notesClient, selectedNoteId, workspaceId]);

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

  const abortTodayNoteOpen = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    requestVersionRef.current += 1;
    pendingRef.current = false;
    if (mountedRef.current) setDailyNoteOpening(false);
  }, []);

  const openTodayNote = useCallback(async (): Promise<CreateActionResult> => {
    if (logoutPending) return { status: "rejected", message: "正在退出登录，请稍候。" };
    if (!workspaceId) return { status: "rejected", message: "当前没有可用工作区，暂时无法打开今日笔记。" };
    if (pendingRef.current) return { status: "rejected", message: "今日笔记正在打开，请稍候。" };

    const dailyDate = localDateKey();
    const existing = notes.find((note) => note.workspace_id === workspaceId && note.status === "active" && note.daily_date === dailyDate);
    if (existing) {
      callbackRef.current(existing, false);
      return { status: "completed" };
    }

    const requestClient = notesClient;
    const requestWorkspaceId = workspaceId;
    const requestSelectedNoteId = selectedNoteId;
    const requestNoteListView = noteListView;
    const requestActiveDraftId = activeDraftId;
    const requestCreatingNote = creatingNote;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    const version = ++requestVersionRef.current;
    pendingRef.current = true;
    setDailyNoteOpening(true);
    setNoteError(null);

    const isCurrent = () => !controller.signal.aborted
      && mountedRef.current
      && requestVersionRef.current === version
      && scopeRef.current.notesClient === requestClient
      && scopeRef.current.workspaceId === requestWorkspaceId
      && !scopeRef.current.logoutPending
      && scopeRef.current.selectedNoteId === requestSelectedNoteId
      && scopeRef.current.noteListView === requestNoteListView
      && scopeRef.current.activeDraftId === requestActiveDraftId
      && scopeRef.current.creatingNote === requestCreatingNote;

    try {
      const opened = await requestClient.openOrCreateDaily(dailyDate, controller.signal);
      if (!isCurrent()) return;
      if (opened.workspace_id !== requestWorkspaceId || opened.status !== "active" || opened.daily_date !== dailyDate) {
        setNoteError("今日笔记返回的数据与当前工作区不匹配，请重试。");
        return { status: "rejected", message: dailyOpenFailureMessage };
      }
      callbackRef.current(opened, true);
      return { status: "completed" };
    } catch (error: unknown) {
      if (!isCurrent() || isAborted(error, controller.signal)) return;
      setNoteError(dailyOpenFailureMessage);
      return { status: "rejected", message: dailyOpenFailureMessage };
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (requestVersionRef.current === version) {
        pendingRef.current = false;
        if (mountedRef.current) setDailyNoteOpening(false);
      }
    }
  }, [activeDraftId, creatingNote, logoutPending, noteListView, notes, notesClient, selectedNoteId, setNoteError, workspaceId]);

  return { dailyNoteOpening, openTodayNote, abortTodayNoteOpen };
}
