import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Database, Folder, NoteLink, NoteRevision, Tag } from "@nexus/contracts";

import type { DatabaseClient } from "../data/database-client";
import type { KnowledgeClient } from "../data/knowledge-client";
import type { NotesClient } from "../data/notes-client";

type KnowledgeMetadataClient = Pick<KnowledgeClient,
  "listFolders" | "listTags" | "listNoteTags" | "listNoteLinks" | "listBacklinks" | "createTag" | "setNoteTags" | "setNoteLinks"
>;
type DatabaseMetadataClient = Pick<DatabaseClient, "listDatabases">;
type NotesHistoryClient = Pick<NotesClient, "listRevisions">;

export interface UseNoteInspectorDataParams {
  knowledgeClient: KnowledgeMetadataClient;
  databaseClient: DatabaseMetadataClient;
  notesClient: NotesHistoryClient;
  workspaceId?: string;
  selectedNoteId: string | null;
  creatingNote: boolean;
}

export interface NoteInspectorDataState {
  folders: Folder[];
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  folderLoading: boolean;
  tags: Tag[];
  setTags: Dispatch<SetStateAction<Tag[]>>;
  noteTagIds: Record<string, string[]>;
  setNoteTagIds: Dispatch<SetStateAction<Record<string, string[]>>>;
  noteTagsLoading: boolean;
  noteTagsSaving: boolean;
  noteTagsError: string | null;
  setNoteTagsError: Dispatch<SetStateAction<string | null>>;
  linkedNoteIds: string[];
  backlinks: NoteLink[];
  noteLinksLoading: boolean;
  noteLinksSaving: boolean;
  noteLinksError: string | null;
  setNoteLinksError: Dispatch<SetStateAction<string | null>>;
  noteDatabases: Database[];
  noteDatabasesLoading: boolean;
  noteDatabasesError: string | null;
  historyOpen: boolean;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  noteRevisions: NoteRevision[];
  historyLoading: boolean;
  historyError: string | null;
  setHistoryError: Dispatch<SetStateAction<string | null>>;
  resetHistory(): void;
  refreshHistory(): void;
  createTag(name: string): Promise<Tag>;
  saveTags(noteId: string, tagIds: string[]): Promise<boolean>;
  saveLinks(noteId: string, noteIds: string[]): Promise<boolean>;
  abortRequests(): void;
}

function isAborted(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

export function useNoteInspectorData({
  knowledgeClient,
  databaseClient,
  notesClient,
  workspaceId,
  selectedNoteId,
  creatingNote,
}: UseNoteInspectorDataParams): NoteInspectorDataState {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderLoading, setFolderLoading] = useState(Boolean(workspaceId));
  const [tags, setTags] = useState<Tag[]>([]);
  const [noteTagIds, setNoteTagIds] = useState<Record<string, string[]>>({});
  const [noteTagsLoading, setNoteTagsLoading] = useState(false);
  const [noteTagsSaving, setNoteTagsSaving] = useState(false);
  const [noteTagsError, setNoteTagsError] = useState<string | null>(null);
  const [linkedNoteIds, setLinkedNoteIds] = useState<string[]>([]);
  const [backlinks, setBacklinks] = useState<NoteLink[]>([]);
  const [noteLinksLoading, setNoteLinksLoading] = useState(false);
  const [noteLinksSaving, setNoteLinksSaving] = useState(false);
  const [noteLinksError, setNoteLinksError] = useState<string | null>(null);
  const [noteDatabases, setNoteDatabases] = useState<Database[]>([]);
  const [noteDatabasesLoading, setNoteDatabasesLoading] = useState(false);
  const [noteDatabasesError, setNoteDatabasesError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [noteRevisions, setNoteRevisions] = useState<NoteRevision[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRefreshVersion, setHistoryRefreshVersion] = useState(0);
  const globalControllersRef = useRef(new Set<AbortController>());
  const noteControllersRef = useRef(new Set<AbortController>());
  const historyControllerRef = useRef<AbortController | null>(null);
  const scopeRef = useRef({ workspaceId, selectedNoteId, creatingNote, knowledgeClient, databaseClient, notesClient });
  const noteTagIdsRef = useRef(noteTagIds);
  const tagMutationRef = useRef(new Map<string, number>());
  const linksMutationRef = useRef(new Map<string, number>());
  scopeRef.current = { workspaceId, selectedNoteId, creatingNote, knowledgeClient, databaseClient, notesClient };
  noteTagIdsRef.current = noteTagIds;

  const abortRequests = useCallback(() => {
    globalControllersRef.current.forEach((controller) => controller.abort());
    noteControllersRef.current.forEach((controller) => controller.abort());
    historyControllerRef.current?.abort();
    globalControllersRef.current.clear();
    noteControllersRef.current.clear();
    historyControllerRef.current = null;
  }, []);

  useEffect(() => {
    abortRequests();
    setFolders([]);
    setTags([]);
    setNoteTagIds({});
    setNoteTagsError(null);
    setNoteTagsSaving(false);
    setLinkedNoteIds([]);
    setBacklinks([]);
    setNoteLinksError(null);
    setNoteLinksSaving(false);
    setNoteDatabases([]);
    setNoteDatabasesError(null);
    setNoteRevisions([]);
    setHistoryError(null);
    setHistoryOpen(false);
    tagMutationRef.current.clear();
    linksMutationRef.current.clear();
  }, [abortRequests, databaseClient, knowledgeClient, notesClient, workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setFolders([]);
      setFolderLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    const scope = workspaceId;
    globalControllersRef.current.add(controller);
    setFolderLoading(true);
    void knowledgeClient.listFolders(controller.signal).then((items) => {
      if (!controller.signal.aborted && scopeRef.current.workspaceId === scope) setFolders(items);
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal) && scopeRef.current.workspaceId === scope) setFolders([]);
    }).finally(() => {
      globalControllersRef.current.delete(controller);
      if (!controller.signal.aborted && scopeRef.current.workspaceId === scope) setFolderLoading(false);
    });
    return () => {
      controller.abort();
      globalControllersRef.current.delete(controller);
    };
  }, [knowledgeClient, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return undefined;
    const controller = new AbortController();
    const scope = workspaceId;
    globalControllersRef.current.add(controller);
    void knowledgeClient.listTags(controller.signal).then((items) => {
      if (!controller.signal.aborted && scopeRef.current.workspaceId === scope) setTags(items);
    }).catch(() => {
      if (!controller.signal.aborted && scopeRef.current.workspaceId === scope) setTags([]);
    }).finally(() => globalControllersRef.current.delete(controller));
    return () => {
      controller.abort();
      globalControllersRef.current.delete(controller);
    };
  }, [knowledgeClient, workspaceId]);

  useEffect(() => {
    setNoteRevisions([]);
    setHistoryError(null);
    setHistoryOpen(false);
    const noteId = selectedNoteId;
    if (!workspaceId || !noteId || creatingNote) {
      setLinkedNoteIds([]);
      setBacklinks([]);
    setNoteLinksLoading(false);
      setNoteLinksSaving(false);
      setNoteLinksError(null);
      setNoteDatabases([]);
      setNoteDatabasesLoading(false);
      setNoteDatabasesError(null);
      setNoteTagsLoading(false);
      setNoteTagsSaving(false);
      setNoteTagsError(null);
      return undefined;
    }
    const controller = new AbortController();
    const scope = { workspaceId, noteId };
    noteControllersRef.current.add(controller);
    setNoteLinksLoading(true);
    setNoteLinksError(null);
    void Promise.all([
      knowledgeClient.listNoteLinks(noteId, controller.signal),
      knowledgeClient.listBacklinks(noteId, controller.signal),
    ]).then(([links, incoming]) => {
      if (controller.signal.aborted || scopeRef.current.workspaceId !== scope.workspaceId || scopeRef.current.selectedNoteId !== scope.noteId) return;
      setLinkedNoteIds(links.map((link) => link.target_note_id));
      setBacklinks(incoming);
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal) && scopeRef.current.workspaceId === scope.workspaceId && scopeRef.current.selectedNoteId === scope.noteId) setNoteLinksError("笔记链接暂时无法加载，当前内容不受影响。请重试。");
    }).finally(() => {
      noteControllersRef.current.delete(controller);
      if (!controller.signal.aborted && scopeRef.current.workspaceId === scope.workspaceId && scopeRef.current.selectedNoteId === scope.noteId) setNoteLinksLoading(false);
    });

    setNoteTagsLoading(true);
    setNoteTagsError(null);
    void knowledgeClient.listNoteTags(noteId, controller.signal).then((items) => {
      if (controller.signal.aborted || scopeRef.current.workspaceId !== scope.workspaceId || scopeRef.current.selectedNoteId !== scope.noteId) return;
      setNoteTagIds((current) => ({ ...current, [noteId]: items.map((tag) => tag.id) }));
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal) && scopeRef.current.workspaceId === scope.workspaceId && scopeRef.current.selectedNoteId === scope.noteId) setNoteTagsError("标签暂时无法加载，保持当前选择后可重试。");
    }).finally(() => {
      if (!controller.signal.aborted && scopeRef.current.workspaceId === scope.workspaceId && scopeRef.current.selectedNoteId === scope.noteId) setNoteTagsLoading(false);
    });

    setNoteDatabasesLoading(true);
    setNoteDatabasesError(null);
    void databaseClient.listDatabases(controller.signal).then((items) => {
      if (controller.signal.aborted || scopeRef.current.workspaceId !== scope.workspaceId || scopeRef.current.selectedNoteId !== scope.noteId) return;
      setNoteDatabases(items);
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal) && scopeRef.current.workspaceId === scope.workspaceId && scopeRef.current.selectedNoteId === scope.noteId) {
        setNoteDatabases([]);
        setNoteDatabasesError("数据库列表暂时无法加载。保存笔记不受影响，可稍后重试。");
      }
    }).finally(() => {
      if (!controller.signal.aborted && scopeRef.current.workspaceId === scope.workspaceId && scopeRef.current.selectedNoteId === scope.noteId) setNoteDatabasesLoading(false);
    });
    return () => {
      controller.abort();
      noteControllersRef.current.delete(controller);
    };
  }, [creatingNote, databaseClient, knowledgeClient, selectedNoteId, workspaceId]);

  useEffect(() => {
    historyControllerRef.current?.abort();
    const noteId = selectedNoteId;
    if (!historyOpen || !workspaceId || !noteId || creatingNote) {
      setHistoryLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    const scope = { workspaceId, noteId };
    historyControllerRef.current = controller;
    setHistoryLoading(true);
    setHistoryError(null);
    void notesClient.listRevisions(noteId, controller.signal).then((items) => {
      if (!controller.signal.aborted && scopeRef.current.workspaceId === scope.workspaceId && scopeRef.current.selectedNoteId === scope.noteId) setNoteRevisions(items);
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal) && scopeRef.current.workspaceId === scope.workspaceId && scopeRef.current.selectedNoteId === scope.noteId) setHistoryError("版本历史暂时无法加载，当前内容不受影响。请重试。");
    }).finally(() => {
      if (historyControllerRef.current === controller) historyControllerRef.current = null;
      if (!controller.signal.aborted && scopeRef.current.workspaceId === scope.workspaceId && scopeRef.current.selectedNoteId === scope.noteId) setHistoryLoading(false);
    });
    return () => {
      controller.abort();
      if (historyControllerRef.current === controller) historyControllerRef.current = null;
    };
  }, [creatingNote, historyOpen, historyRefreshVersion, notesClient, selectedNoteId, workspaceId]);

  const resetHistory = useCallback(() => {
    historyControllerRef.current?.abort();
    setHistoryOpen(false);
    setNoteRevisions([]);
    setHistoryError(null);
  }, []);

  const createTag = useCallback(async (name: string) => {
    const created = await knowledgeClient.createTag({ name, color: "" });
    if (scopeRef.current.workspaceId === workspaceId) setTags((current) => current.some((tag) => tag.id === created.id) ? current : [...current, created].sort((left, right) => left.name.localeCompare(right.name)));
    return created;
  }, [knowledgeClient, workspaceId]);

  const saveTags = useCallback(async (noteId: string, tagIds: string[]) => {
    const sequence = (tagMutationRef.current.get(noteId) ?? 0) + 1;
    tagMutationRef.current.set(noteId, sequence);
    const previous = noteTagIdsRef.current[noteId] ?? [];
    setNoteTagIds((current) => ({ ...current, [noteId]: [...tagIds] }));
    setNoteTagsSaving(true);
    setNoteTagsError(null);
    try {
      await knowledgeClient.setNoteTags(noteId, { tag_ids: tagIds });
      return true;
    } catch {
      if (tagMutationRef.current.get(noteId) === sequence) {
        setNoteTagIds((current) => ({ ...current, [noteId]: previous }));
        setNoteTagsError("标签保存失败，请重试。当前选择已恢复。");
      }
      return false;
    } finally {
      if (tagMutationRef.current.get(noteId) === sequence) setNoteTagsSaving(false);
    }
  }, [knowledgeClient]);

  const saveLinks = useCallback(async (noteId: string, noteIds: string[]) => {
    const sequence = (linksMutationRef.current.get(noteId) ?? 0) + 1;
    linksMutationRef.current.set(noteId, sequence);
    setNoteLinksSaving(true);
    setNoteLinksError(null);
    try {
      await knowledgeClient.setNoteLinks(noteId, { target_note_ids: noteIds });
      if (linksMutationRef.current.get(noteId) === sequence) setLinkedNoteIds([...noteIds]);
      return true;
    } catch {
      if (linksMutationRef.current.get(noteId) === sequence) setNoteLinksError("笔记链接保存失败，请重试。当前选择已保留。");
      return false;
    } finally {
      if (linksMutationRef.current.get(noteId) === sequence) setNoteLinksSaving(false);
    }
  }, [knowledgeClient]);

  return {
    folders, setFolders, folderLoading, tags, setTags, noteTagIds, setNoteTagIds,
    noteTagsLoading, noteTagsSaving, noteTagsError, setNoteTagsError,
    linkedNoteIds, backlinks, noteLinksLoading, noteLinksSaving, noteLinksError, setNoteLinksError,
    noteDatabases, noteDatabasesLoading, noteDatabasesError,
    historyOpen, setHistoryOpen, noteRevisions, historyLoading, historyError,
    setHistoryError, resetHistory,
    refreshHistory: () => setHistoryRefreshVersion((version) => version + 1),
    createTag, saveTags, saveLinks, abortRequests,
  };
}
