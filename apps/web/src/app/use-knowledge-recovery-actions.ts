import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { KnowledgeDiagnostic, Note, UpdateNoteInput, WorkspaceRoleContract } from "@nexus/contracts";

import type { NotesClient } from "../data/notes-client";

export interface UseKnowledgeRecoveryActionsParams {
  notesClient: Pick<NotesClient, "get" | "list" | "update">;
  workspaceId?: string;
  role: WorkspaceRoleContract;
  diagnostics: KnowledgeDiagnostic[];
  installedNotesRef: MutableRefObject<Map<string, Note>>;
  setNotes: Dispatch<SetStateAction<Note[]>>;
  setDiagnostics: Dispatch<SetStateAction<KnowledgeDiagnostic[]>>;
  setRetryFeedback: Dispatch<SetStateAction<string | null>>;
  setDiagnosticError: Dispatch<SetStateAction<string | null>>;
  refreshRecovery(): void;
}

type NotePatchFactory = (note: Note) => Pick<UpdateNoteInput, "folder_id" | "database_id">;

function isAbort(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function duplicateContentBlock(note: Note) {
  return `\n\n---\n\n# ${note.title || "未命名笔记"}\n\n${note.content}`;
}

export function mergeDuplicateContent(primary: Note, duplicates: readonly Note[]) {
  let content = primary.content;
  duplicates.forEach((note) => {
    const block = duplicateContentBlock(note);
    if (!content.includes(block)) content += block;
  });
  return content.trim();
}

export function useKnowledgeRecoveryActions({
  notesClient,
  workspaceId,
  role,
  diagnostics,
  installedNotesRef,
  setNotes,
  setDiagnostics,
  setRetryFeedback,
  setDiagnosticError,
  refreshRecovery,
}: UseKnowledgeRecoveryActionsParams) {
  const [pending, setPending] = useState(false);
  const mountedRef = useRef(true);
  const scopeRef = useRef({ notesClient, workspaceId, role });
  const generationRef = useRef(0);
  const diagnosticsRef = useRef(diagnostics);
  const actionControllerRef = useRef<AbortController | null>(null);
  const actionVersionRef = useRef(0);
  useLayoutEffect(() => {
    diagnosticsRef.current = diagnostics;
  }, [diagnostics]);

  useLayoutEffect(() => {
    const changed = scopeRef.current.notesClient !== notesClient
      || scopeRef.current.workspaceId !== workspaceId
      || scopeRef.current.role !== role;
    if (!changed) return;
    actionControllerRef.current?.abort();
    actionControllerRef.current = null;
    actionVersionRef.current += 1;
    generationRef.current += 1;
    scopeRef.current = { notesClient, workspaceId, role };
    setPending(false);
  }, [notesClient, role, workspaceId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionControllerRef.current?.abort();
      actionControllerRef.current = null;
      actionVersionRef.current += 1;
    };
  }, []);

  const isCurrentScope = useCallback(() => mountedRef.current
    && scopeRef.current.notesClient === notesClient
    && scopeRef.current.workspaceId === workspaceId
    && scopeRef.current.role === role, [notesClient, role, workspaceId]);

  const beginAction = useCallback(() => {
    actionControllerRef.current?.abort();
    const controller = new AbortController();
    const version = ++actionVersionRef.current;
    actionControllerRef.current = controller;
    const generation = generationRef.current;
    const requestClient = notesClient;
    const requestWorkspaceId = workspaceId;
    const requestRole = role;
    setPending(true);
    const isCurrent = () => !controller.signal.aborted
      && mountedRef.current
      && actionVersionRef.current === version
      && generationRef.current === generation
      && scopeRef.current.notesClient === requestClient
      && scopeRef.current.workspaceId === requestWorkspaceId
      && scopeRef.current.role === requestRole;
    return { controller, isCurrent };
  }, [notesClient, role, workspaceId]);

  const updateDiagnosticNotes = useCallback(async (
    items: KnowledgeDiagnostic[],
    patchFor: NotePatchFactory,
  ) => {
    if (!workspaceId || role === "viewer" || items.length === 0 || !isCurrentScope()) return;
    const requestWorkspaceId = workspaceId;
    const action = beginAction();
    const updated: Note[] = [];
    let failed = 0;
    try {
      for (const item of items) {
        if (!action.isCurrent()) return;
        try {
          const current = await notesClient.get(item.entity_id, action.controller.signal);
          if (!action.isCurrent()) return;
          if (current.workspace_id !== requestWorkspaceId) {
            failed += 1;
            continue;
          }
          const saved = await notesClient.update(current.id, {
            base_revision: current.revision,
            ...patchFor(current),
            source: "manual",
          });
          if (!action.isCurrent()) return;
          if (saved.workspace_id !== requestWorkspaceId) {
            failed += 1;
            continue;
          }
          updated.push(saved);
        } catch (error) {
          if (!action.isCurrent() || isAbort(error, action.controller.signal)) return;
          failed += 1;
        }
      }
      if (!action.isCurrent()) return;
      if (updated.length > 0) {
        updated.forEach((note) => installedNotesRef.current.set(note.id, note));
        setNotes((current) => {
          const byId = new Map(current.map((note) => [note.id, note]));
          updated.forEach((note) => byId.set(note.id, note));
          return [...byId.values()];
        });
      }
      setRetryFeedback(failed > 0
        ? `已处理 ${updated.length} 篇，${failed} 篇失败；失败项仍保留，可重试。`
        : `已处理 ${updated.length} 篇笔记。`);
      refreshRecovery();
    } finally {
      if (actionControllerRef.current === action.controller) {
        actionControllerRef.current = null;
        setPending(false);
      }
    }
  }, [beginAction, installedNotesRef, isCurrentScope, notesClient, refreshRecovery, role, setNotes, setRetryFeedback, workspaceId]);

  const classifyUnfiledNotes = useCallback((folderId: string) => {
    if (!folderId) return;
    void updateDiagnosticNotes(
      diagnosticsRef.current.filter((item) => item.kind === "unfiled_note"),
      () => ({ folder_id: folderId, database_id: null }),
    );
  }, [updateDiagnosticNotes]);

  const moveOrphansToInbox = useCallback(() => {
    void updateDiagnosticNotes(
      diagnosticsRef.current.filter((item) => item.kind === "orphan_note"),
      () => ({ folder_id: null }),
    );
  }, [updateDiagnosticNotes]);

  const ignoreOrphans = useCallback(() => {
    if (!isCurrentScope()) return;
    actionControllerRef.current?.abort();
    actionControllerRef.current = null;
    actionVersionRef.current += 1;
    setPending(false);
    setDiagnostics((current) => current.filter((item) => item.kind !== "orphan_note"));
    setRetryFeedback("已暂时隐藏当前页面的孤立笔记诊断；刷新后仍可恢复查看。");
  }, [isCurrentScope, setDiagnostics, setRetryFeedback]);

  const mergeDuplicateNotes = useCallback(async (diagnostic: KnowledgeDiagnostic) => {
    if (!workspaceId || role === "viewer" || diagnostic.kind !== "duplicate_title" || !isCurrentScope()) return;
    const action = beginAction();
    let saved: Note | null = null;
    const archived: Note[] = [];
    const publishMergedState = () => {
      if (!action.isCurrent() || (!saved && archived.length === 0)) return;
      if (saved) installedNotesRef.current.set(saved.id, saved);
      archived.forEach((note) => installedNotesRef.current.set(note.id, note));
      setNotes((current) => current.map((note) => {
        if (saved && note.id === saved.id) return saved;
        return archived.find((item) => item.id === note.id) ?? note;
      }));
    };
    try {
      const page = await notesClient.list({ query: diagnostic.title, limit: 100, signal: action.controller.signal });
      if (!action.isCurrent()) return;
      const title = diagnostic.title.trim().toLocaleLowerCase();
      const matches = page.items
        .filter((note) => note.workspace_id === workspaceId && note.status === "active" && note.title.trim().toLocaleLowerCase() === title)
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || right.id.localeCompare(left.id));
      if (matches.length < 2) throw new Error("当前没有足够的同名笔记可合并。");
      const [primary, ...duplicates] = matches;
      const mergedContent = mergeDuplicateContent(primary, duplicates);
      saved = await notesClient.update(primary.id, {
        base_revision: primary.revision,
        content: mergedContent,
        source: "manual",
      });
      if (!action.isCurrent()) return;
      if (saved.workspace_id !== workspaceId) throw new Error("笔记不属于当前工作区，合并已停止。");
      for (const duplicate of duplicates) {
        if (!action.isCurrent()) return;
        const next = await notesClient.update(duplicate.id, {
          base_revision: duplicate.revision,
          status: "archived",
          source: "manual",
        });
        if (!action.isCurrent()) return;
        if (next.workspace_id !== workspaceId) throw new Error("笔记不属于当前工作区，合并已停止。");
        archived.push(next);
      }
      publishMergedState();
      setRetryFeedback(`已合并 ${matches.length} 篇同名笔记，重复副本已归档，可在归档列表恢复。`);
      refreshRecovery();
    } catch (error) {
      if (action.isCurrent() && !isAbort(error, action.controller.signal)) {
        publishMergedState();
        refreshRecovery();
        setDiagnosticError(error instanceof Error ? error.message : "同名笔记合并失败，内容未删除。请重试。");
      }
    } finally {
      if (actionControllerRef.current === action.controller) {
        actionControllerRef.current = null;
        setPending(false);
      }
    }
  }, [beginAction, installedNotesRef, isCurrentScope, notesClient, refreshRecovery, role, setDiagnosticError, setNotes, setRetryFeedback, workspaceId]);

  const abortActions = useCallback(() => {
    actionControllerRef.current?.abort();
    actionControllerRef.current = null;
    actionVersionRef.current += 1;
    setPending(false);
  }, []);

  return {
    classifyUnfiledNotes,
    moveOrphansToInbox,
    ignoreOrphans,
    mergeDuplicateNotes,
    abortActions,
    pending,
  };
}
