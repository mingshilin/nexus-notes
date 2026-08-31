import { useCallback, useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Note, SyncOperation, SyncOperationResult } from "@nexus/contracts";
import type { NotesClient } from "../data/notes-client";

type ConflictNotesClient = Pick<NotesClient, "get">;

interface UseOfflineConflictReadParams {
  notesClient: ConflictNotesClient;
  workspaceId?: string;
  activeDraftId: string | null;
  logoutPending: boolean;
  activeDraftIdRef: MutableRefObject<string | null>;
  draftTitleRef: MutableRefObject<string>;
  draftContentRef: MutableRefObject<string>;
  mountedRef?: MutableRefObject<boolean>;
  setConflict: Dispatch<SetStateAction<{
    workspaceId: string;
    entityId: string;
    local: { title: string; content: string };
    server: Note;
  } | null>>;
  setNoteError: Dispatch<SetStateAction<string | null>>;
}

interface ConflictReadScope {
  notesClient: ConflictNotesClient;
  workspaceId?: string;
  activeDraftId: string | null;
  logoutPending: boolean;
  token: object;
}

interface ConflictReadRequest {
  controller: AbortController;
  operation: SyncOperation;
  local: { title: string; content: string };
  scopeToken: object;
}

function isAborted(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

export function useOfflineConflictRead({
  notesClient,
  workspaceId,
  activeDraftId,
  logoutPending,
  activeDraftIdRef,
  draftTitleRef,
  draftContentRef,
  mountedRef: parentMountedRef,
  setConflict,
  setNoteError,
}: UseOfflineConflictReadParams) {
  const ownMountedRef = useRef(true);
  const mountedRef = parentMountedRef ?? ownMountedRef;
  const requestRef = useRef<ConflictReadRequest | null>(null);
  const scopeToken = useMemo(() => ({}), [activeDraftId, logoutPending, notesClient, workspaceId]);
  const scopeRef = useRef<ConflictReadScope>({ notesClient, workspaceId, activeDraftId, logoutPending, token: scopeToken });
  scopeRef.current = { notesClient, workspaceId, activeDraftId, logoutPending, token: scopeToken };

  const isCurrent = useCallback((request: ConflictReadRequest) => {
    const current = scopeRef.current;
    return mountedRef.current
      && requestRef.current === request
      && !request.controller.signal.aborted
      && current.token === request.scopeToken
      && current.notesClient === notesClient
      && current.workspaceId === workspaceId
      && !current.logoutPending
      && current.activeDraftId === request.operation.entity_id
      && activeDraftIdRef.current === request.operation.entity_id;
  }, [activeDraftIdRef, mountedRef, notesClient, workspaceId]);

  useEffect(() => {
    ownMountedRef.current = true;
    return () => {
      ownMountedRef.current = false;
      requestRef.current?.controller.abort();
      requestRef.current = null;
    };
  }, []);

  useEffect(() => () => {
    const request = requestRef.current;
    if (!request || request.scopeToken !== scopeToken) return;
    request.controller.abort();
    requestRef.current = null;
  }, [scopeToken]);

  const abort = useCallback(() => {
    requestRef.current?.controller.abort();
    requestRef.current = null;
  }, []);

  const onConflict = useCallback((operation: SyncOperation, result: SyncOperationResult) => {
    const current = scopeRef.current;
    if (
      !mountedRef.current
      || requestRef.current
      || current.token !== scopeToken
      || current.notesClient !== notesClient
      || current.workspaceId !== workspaceId
      || current.logoutPending
      || current.activeDraftId !== operation.entity_id
      || result.status !== "conflict"
      || operation.entity_type !== "note"
      || !workspaceId
      || operation.workspace_id !== workspaceId
      || activeDraftIdRef.current !== operation.entity_id
    ) return;

    const localTitle = typeof operation.patch.title === "string" ? operation.patch.title : draftTitleRef.current;
    const localContent = typeof operation.patch.content === "string" ? operation.patch.content : draftContentRef.current;
    const request: ConflictReadRequest = {
      controller: new AbortController(),
      operation,
      local: { title: localTitle, content: localContent },
      scopeToken,
    };
    requestRef.current = request;
    void notesClient.get(operation.entity_id, request.controller.signal).then((server) => {
      if (!isCurrent(request) || server.workspace_id !== workspaceId) return;
      setConflict({ workspaceId, entityId: operation.entity_id, local: request.local, server });
    }).catch((error: unknown) => {
      if (!isCurrent(request) || isAborted(error, request.controller.signal)) return;
      setNoteError("离线同步发生冲突，服务器版本暂时无法加载。本地草稿仍保留，可稍后重试。");
    }).finally(() => {
      if (requestRef.current === request) requestRef.current = null;
    });
  }, [activeDraftIdRef, draftContentRef, draftTitleRef, isCurrent, mountedRef, notesClient, scopeToken, setConflict, setNoteError, workspaceId]);

  return { onConflict, abort };
}
