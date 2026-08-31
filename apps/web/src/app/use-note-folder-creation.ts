import { useCallback, useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Folder, WorkspaceRoleContract } from "@nexus/contracts";
import type { KnowledgeClient } from "../data/knowledge-client";

interface UseNoteFolderCreationParams {
  knowledgeClient: KnowledgeClient;
  workspaceId?: string;
  role: WorkspaceRoleContract;
  logoutPending: boolean;
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  selectFolderFilter(folderId: string | null): void;
}

interface FolderScope {
  knowledgeClient: KnowledgeClient;
  workspaceId?: string;
  role: WorkspaceRoleContract;
  logoutPending: boolean;
  token: object;
}

interface FolderRequest {
  controller: AbortController;
  scopeToken: object;
}

function scopeAbortError() {
  return new DOMException("Folder creation scope changed", "AbortError");
}

export function useNoteFolderCreation({
  knowledgeClient,
  workspaceId,
  role,
  logoutPending,
  setFolders,
  selectFolderFilter,
}: UseNoteFolderCreationParams) {
  const mountedRef = useRef(true);
  const requestRef = useRef<FolderRequest | null>(null);
  const scopeToken = useMemo(() => ({}), [knowledgeClient, logoutPending, role, workspaceId]);
  const scopeRef = useRef<FolderScope>({ knowledgeClient, workspaceId, role, logoutPending, token: scopeToken });
  scopeRef.current = { knowledgeClient, workspaceId, role, logoutPending, token: scopeToken };

  const isCurrent = useCallback((request: FolderRequest) => {
    const current = scopeRef.current;
    return mountedRef.current
      && requestRef.current === request
      && current.token === request.scopeToken
      && current.knowledgeClient === knowledgeClient
      && current.workspaceId === workspaceId
      && current.role !== "viewer"
      && !current.logoutPending
      && !request.controller.signal.aborted;
  }, [knowledgeClient, workspaceId]);

  const abort = useCallback(() => {
    const request = requestRef.current;
    if (!request) return;
    request.controller.abort();
    requestRef.current = null;
  }, []);

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
  }, [scopeToken]);

  const createFolder = useCallback(async (name: string) => {
    const current = scopeRef.current;
    if (
      !mountedRef.current
      || requestRef.current
      || current.token !== scopeToken
      || current.knowledgeClient !== knowledgeClient
      || current.workspaceId !== workspaceId
      || current.role === "viewer"
      || current.logoutPending
    ) throw scopeAbortError();
    if (!workspaceId) throw new Error("Workspace is required");

    const request = { controller: new AbortController(), scopeToken };
    requestRef.current = request;
    try {
      const folder = await knowledgeClient.createFolder({ name }, request.controller.signal);
      if (!isCurrent(request)) throw scopeAbortError();
      if (folder.workspace_id !== workspaceId) throw new Error("Folder response scope mismatch");
      setFolders((folders) => [...folders, folder].sort((left, right) => left.position - right.position || left.name.localeCompare(right.name)));
      selectFolderFilter(folder.id);
    } catch (error: unknown) {
      if (!isCurrent(request)) throw scopeAbortError();
      throw error;
    } finally {
      if (requestRef.current === request) requestRef.current = null;
    }
  }, [isCurrent, knowledgeClient, selectFolderFilter, setFolders, scopeToken, workspaceId]);

  return { createFolder, abort };
}
