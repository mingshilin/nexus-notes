import { useCallback, useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { WorkspaceRoleContract } from "@nexus/contracts";
import type { NoteDraftController } from "../notes/note-draft-controller";

interface UseNoteDraftInputParams {
  draftController: NoteDraftController;
  workspaceId?: string;
  role: WorkspaceRoleContract;
  logoutPending: boolean;
  selectedNoteId: string | null;
  creatingNote: boolean;
  activeDraftId: string | null;
  activeDraftIdRef: MutableRefObject<string | null>;
  draftTitleRef: MutableRefObject<string>;
  draftContentRef: MutableRefObject<string>;
  mountedRef: MutableRefObject<boolean>;
  setDraftTitle: Dispatch<SetStateAction<string>>;
  setDraftContent: Dispatch<SetStateAction<string>>;
  setNoteMessage: Dispatch<SetStateAction<string | null>>;
  setNoteError: Dispatch<SetStateAction<string | null>>;
}

interface DraftInputScope {
  draftController: NoteDraftController;
  workspaceId?: string;
  role: WorkspaceRoleContract;
  logoutPending: boolean;
  selectedNoteId: string | null;
  creatingNote: boolean;
  activeDraftId: string | null;
  token: object;
}

interface DraftSaveRequest {
  workspaceId: string;
  draftId: string;
  sequence: number;
  scopeToken: object;
}

export function useNoteDraftInput({
  draftController,
  workspaceId,
  role,
  logoutPending,
  selectedNoteId,
  creatingNote,
  activeDraftId,
  activeDraftIdRef,
  draftTitleRef,
  draftContentRef,
  mountedRef,
  setDraftTitle,
  setDraftContent,
  setNoteMessage,
  setNoteError,
}: UseNoteDraftInputParams) {
  const hookMountedRef = useRef(true);
  const scopeToken = useMemo(() => ({}), [activeDraftId, creatingNote, draftController, logoutPending, role, selectedNoteId, workspaceId]);
  const scopeRef = useRef<DraftInputScope>({ draftController, workspaceId, role, logoutPending, selectedNoteId, creatingNote, activeDraftId, token: scopeToken });
  const saveSequencesRef = useRef(new Map<string, number>());
  scopeRef.current = { draftController, workspaceId, role, logoutPending, selectedNoteId, creatingNote, activeDraftId, token: scopeToken };

  useEffect(() => {
    hookMountedRef.current = true;
    return () => { hookMountedRef.current = false; };
  }, []);

  const updateActiveDraftInput = useCallback((title: string, content: string) => {
    const current = scopeRef.current;
    if (
      !hookMountedRef.current
      || !mountedRef.current
      || current.token !== scopeToken
      || current.draftController !== draftController
      || current.workspaceId !== workspaceId
      || current.role !== role
      || current.logoutPending
    ) return;

    draftTitleRef.current = title;
    draftContentRef.current = content;
    setDraftTitle(title);
    setDraftContent(content);
    setNoteMessage(null);

    const draftId = activeDraftIdRef.current;
    if (!workspaceId || !draftId) return;
    const sequence = (saveSequencesRef.current.get(draftId) ?? 0) + 1;
    saveSequencesRef.current.set(draftId, sequence);
    const request: DraftSaveRequest = { workspaceId, draftId, sequence, scopeToken };
    void draftController.save(workspaceId, draftId, title, content).catch(() => {
      const latest = scopeRef.current;
      if (
        hookMountedRef.current
        && mountedRef.current
        && latest.token === request.scopeToken
        && latest.draftController === draftController
        && latest.workspaceId === request.workspaceId
        && latest.activeDraftId === request.draftId
        && activeDraftIdRef.current === request.draftId
        && saveSequencesRef.current.get(request.draftId) === request.sequence
      ) setNoteError("本地草稿保存失败，当前内容仍保留在编辑器中。请重试。");
    });
  }, [activeDraftIdRef, draftContentRef, draftController, draftTitleRef, logoutPending, mountedRef, role, scopeToken, setDraftContent, setDraftTitle, setNoteError, setNoteMessage, workspaceId]);

  return { updateActiveDraftInput };
}
