import { useCallback, useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Note, WorkspaceRoleContract } from "@nexus/contracts";
import type { NoteDraftController } from "../notes/note-draft-controller";

export interface NoteConflictState {
  workspaceId: string;
  entityId: string;
  local: { title: string; content: string };
  server: Note;
}

interface UseNoteConflictResolutionParams {
  draftController: NoteDraftController;
  workspaceId?: string;
  role: WorkspaceRoleContract;
  logoutPending: boolean;
  activeDraftId: string | null;
  activeDraftIdRef: MutableRefObject<string | null>;
  conflict: NoteConflictState | null;
  setConflict: Dispatch<SetStateAction<NoteConflictState | null>>;
  setResolving: Dispatch<SetStateAction<boolean>>;
  setServerRetryVersion: Dispatch<SetStateAction<number>>;
  setDraftTitle: Dispatch<SetStateAction<string>>;
  setDraftContent: Dispatch<SetStateAction<string>>;
  setDraftFolderId: Dispatch<SetStateAction<string | null>>;
  setDraftDatabaseId: Dispatch<SetStateAction<string | null>>;
  draftTitleRef: MutableRefObject<string>;
  draftContentRef: MutableRefObject<string>;
  setNoteMessage: Dispatch<SetStateAction<string | null>>;
  setNoteError: Dispatch<SetStateAction<string | null>>;
}

interface ConflictScope {
  draftController: NoteDraftController;
  workspaceId?: string;
  role: WorkspaceRoleContract;
  logoutPending: boolean;
  activeDraftId: string | null;
  conflict: NoteConflictState | null;
  token: object;
}

interface ConflictRequest {
  controller: AbortController;
  scopeToken: object;
}

export function useNoteConflictResolution({
  draftController,
  workspaceId,
  role,
  logoutPending,
  activeDraftId,
  activeDraftIdRef,
  conflict,
  setConflict,
  setResolving,
  setServerRetryVersion,
  setDraftTitle,
  setDraftContent,
  setDraftFolderId,
  setDraftDatabaseId,
  draftTitleRef,
  draftContentRef,
  setNoteMessage,
  setNoteError,
}: UseNoteConflictResolutionParams) {
  const mountedRef = useRef(true);
  const requestRef = useRef<ConflictRequest | null>(null);
  const scopeToken = useMemo(() => ({}), [activeDraftId, conflict, draftController, logoutPending, role, workspaceId]);
  const scopeRef = useRef<ConflictScope>({ draftController, workspaceId, role, logoutPending, activeDraftId, conflict, token: scopeToken });
  scopeRef.current = { draftController, workspaceId, role, logoutPending, activeDraftId, conflict, token: scopeToken };

  const isCurrent = useCallback((captured: NoteConflictState, request: ConflictRequest) => {
    const current = scopeRef.current;
    return mountedRef.current
      && requestRef.current === request
      && current.token === request.scopeToken
      && !request.controller.signal.aborted
      && current.draftController === draftController
      && current.workspaceId === captured.workspaceId
      && current.workspaceId === workspaceId
      && current.role !== "viewer"
      && !current.logoutPending
      && current.activeDraftId === captured.entityId
      && activeDraftIdRef.current === captured.entityId
      && current.conflict === captured;
  }, [activeDraftIdRef, draftController, workspaceId]);

  useEffect(() => () => {
    mountedRef.current = false;
    const request = requestRef.current;
    request?.controller.abort();
    requestRef.current = null;
  }, []);

  useEffect(() => () => {
    const request = requestRef.current;
    if (!request || request.scopeToken !== scopeToken) return;
    request.controller.abort();
    requestRef.current = null;
    if (mountedRef.current) setResolving(false);
  }, [scopeToken, setResolving]);

  const resolve = useCallback(async (resolution: "local" | "server") => {
    const current = scopeRef.current;
    const captured = current.conflict;
    if (
      !mountedRef.current
      || requestRef.current
      || current.token !== scopeToken
      || current.draftController !== draftController
      || current.workspaceId !== workspaceId
      || current.role === "viewer"
      || current.logoutPending
      || !captured
      || !workspaceId
      || role === "viewer"
      || logoutPending
      || captured.workspaceId !== workspaceId
      || activeDraftIdRef.current !== captured.entityId
      || scopeRef.current.activeDraftId !== captured.entityId
    ) return;

    const request = { controller: new AbortController(), scopeToken };
    requestRef.current = request;
    setResolving(true);
    setNoteError(null);
    try {
      const resolved = await draftController.resolveConflict(
        workspaceId,
        captured.entityId,
        resolution,
        captured.server,
      );
      if (!isCurrent(captured, request)) return;
      if (!resolved) throw new Error("Conflict draft is no longer available");

      setConflict(null);
      if (resolution === "local") {
        setNoteMessage("已保留本地版本，正在基于最新服务器版本重试同步。");
        setServerRetryVersion((version) => version + 1);
      } else {
        setDraftTitle(captured.server.title);
        setDraftContent(captured.server.content);
        setDraftFolderId(captured.server.folder_id);
        setDraftDatabaseId(captured.server.database_id);
        draftTitleRef.current = captured.server.title;
        draftContentRef.current = captured.server.content;
        setNoteMessage("已采用服务器版本，本地草稿已更新，可继续编辑。");
      }
      return;
    } catch {
      if (isCurrent(captured, request)) {
        setNoteError("冲突恢复失败，本地和服务器版本均已保留。请重试。");
      }
      return;
    } finally {
      const ownsController = requestRef.current === request;
      if (ownsController) {
        if (mountedRef.current) setResolving(false);
        requestRef.current = null;
      }
    }
  }, [
    activeDraftIdRef,
    draftContentRef,
    draftController,
    draftTitleRef,
    isCurrent,
    logoutPending,
    role,
    scopeToken,
    setConflict,
    setDraftContent,
    setDraftDatabaseId,
    setDraftFolderId,
    setDraftTitle,
    setNoteError,
    setNoteMessage,
    setResolving,
    setServerRetryVersion,
    workspaceId,
  ]);

  return { resolve };
}
