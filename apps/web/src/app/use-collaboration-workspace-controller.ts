import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { CollaborationClient } from "../data/collaboration-client";
import type { DatabaseBundle, DatabaseClient } from "../data/database-client";
import type { CollaborationCommentTarget, NotificationTarget } from "../collaboration/collaboration-types";
import type { Database, DatabaseRecord, Note, WorkspaceRoleContract } from "@nexus/contracts";
import type { ProductDomain } from "../navigation/ProductNavigation";

export interface UseCollaborationWorkspaceControllerParams {
  client: Pick<CollaborationClient, "getUnreadCount">;
  databaseClient: Pick<DatabaseClient, "listDatabases" | "getRecord">;
  workspaceId?: string;
  userId: string;
  collaborationEnabled: boolean;
  role: WorkspaceRoleContract;
  notes: Note[];
  databases: Database[];
  databaseRecords: DatabaseRecord[];
  setSelectedNoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedDatabaseId: Dispatch<SetStateAction<string | null>>;
  setSelectedDatabaseRecordId: Dispatch<SetStateAction<string | null>>;
  setResolvedNotificationRecord: Dispatch<SetStateAction<DatabaseRecord | null>>;
  setSelectedCommentId: Dispatch<SetStateAction<string | null>>;
  setCollaborationInitialSection: Dispatch<SetStateAction<"people" | "comments" | "shares">>;
  setDatabases: Dispatch<SetStateAction<Database[]>>;
  setDatabaseError: Dispatch<SetStateAction<string | null>>;
  transitionToDomain(domain: ProductDomain): void;
}

export interface CollaborationWorkspaceControllerState {
  unreadCount: number;
  notificationOpen: boolean;
  notificationOpenerRef: RefObject<HTMLElement | null>;
  targetError: string | null;
  toggleNotifications(opener: HTMLElement): void;
  closeNotifications(): void;
  onNotificationRead(count: number): void;
  navigateNotificationTarget(target: NotificationTarget): void;
}

export function filterWorkspaceDatabases(databases: readonly Database[], workspaceId?: string) {
  return workspaceId ? databases.filter((database) => database.workspace_id === workspaceId) : [];
}

export function filterWorkspaceDatabaseRecords(records: readonly DatabaseRecord[], workspaceId?: string, databaseIds?: ReadonlySet<string>) {
  return workspaceId
    ? records.filter((record) => record.workspace_id === workspaceId && (!databaseIds || databaseIds.has(record.database_id)))
    : [];
}

export function scopeDatabaseBundle(bundle: DatabaseBundle | null, workspaceId?: string): DatabaseBundle | null {
  if (!bundle || !workspaceId || bundle.database.workspace_id !== workspaceId) return null;
  const databaseId = bundle.database.id;
  return {
    ...bundle,
    properties: bundle.properties.filter((property) => property.workspace_id === workspaceId && property.database_id === databaseId),
    views: bundle.views.filter((view) => view.workspace_id === workspaceId && view.database_id === databaseId),
    templates: bundle.templates.filter((template) => template.workspace_id === workspaceId && template.database_id === databaseId),
  };
}

export function getActiveDatabaseId(
  selectedDatabaseId: string | null,
  bundle: DatabaseBundle | null,
  workspaceId?: string,
) {
  if (!selectedDatabaseId || !bundle || bundle.database.workspace_id !== workspaceId) return null;
  if (bundle.database.id !== selectedDatabaseId) return null;
  return bundle.database.id;
}

export function getVerifiedCollaborationTarget(
  selectedDatabaseRecordId: string | null,
  selectedNoteId: string | null,
  targets: readonly CollaborationCommentTarget[],
): Pick<CollaborationCommentTarget, "type" | "id"> | undefined {
  if (selectedDatabaseRecordId && targets.some((target) => target.type === "database_record" && target.id === selectedDatabaseRecordId)) {
    return { type: "database_record", id: selectedDatabaseRecordId };
  }
  if (selectedNoteId && targets.some((target) => target.type === "note" && target.id === selectedNoteId)) {
    return { type: "note", id: selectedNoteId };
  }
  return undefined;
}

function isAborted(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function isRecordNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const details = error as { code?: string; status?: number };
  return details.code === "RECORD_NOT_FOUND" && details.status === 404;
}

async function resolveDatabaseNotificationTarget(
  client: Pick<DatabaseClient, "listDatabases" | "getRecord">,
  target: NotificationTarget,
  workspaceId: string,
  signal: AbortSignal,
) {
  const databases = filterWorkspaceDatabases(await client.listDatabases(signal), workspaceId);
  const candidates = target.databaseId
    ? databases.filter((database) => database.id === target.databaseId)
    : databases;
  for (const database of candidates) {
    try {
      const record = await client.getRecord(database.id, target.targetId, signal);
      return { database, databases, record };
    } catch (error) {
      if (isRecordNotFound(error)) continue;
      throw error;
    }
  }
  throw Object.assign(new Error("Database notification target was not found"), { code: "RECORD_NOT_FOUND", status: 404 });
}

export function useCollaborationWorkspaceController({
  client,
  databaseClient,
  workspaceId,
  userId,
  collaborationEnabled,
  role,
  notes,
  databases,
  databaseRecords,
  setSelectedNoteId,
  setSelectedDatabaseId,
  setSelectedDatabaseRecordId,
  setResolvedNotificationRecord,
  setSelectedCommentId,
  setCollaborationInitialSection,
  setDatabases,
  setDatabaseError,
  transitionToDomain,
}: UseCollaborationWorkspaceControllerParams): CollaborationWorkspaceControllerState {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);
  const notificationOpenerRef = useRef<HTMLElement | null>(null);
  const notificationTargetController = useRef<AbortController | null>(null);
  const targetRequestVersionRef = useRef(0);
  const notesRef = useRef(notes);
  const databaseDataRef = useRef({ databases, databaseRecords });
  const notesGenerationRef = useRef(0);
  const databaseDataGenerationRef = useRef(0);
  if (notesRef.current !== notes) {
    notesRef.current = notes;
    notesGenerationRef.current += 1;
  }
  if (databaseDataRef.current.databases !== databases || databaseDataRef.current.databaseRecords !== databaseRecords) {
    databaseDataRef.current = { databases, databaseRecords };
    databaseDataGenerationRef.current += 1;
  }
  const callbackNotesGeneration = notesGenerationRef.current;
  const callbackNotes = notesRef.current;
  const callbackDatabaseDataGeneration = databaseDataGenerationRef.current;
  const callbackDatabaseData = databaseDataRef.current;
  const scopeRef = useRef({ client, databaseClient, workspaceId, userId, collaborationEnabled, role });
  const scopeVersionRef = useRef(0);
  const [, setScopeEpoch] = useState(0);
  const mountedRef = useRef(true);
  const currentScope = scopeRef.current;
  const scopeMatches = currentScope.client === client
    && currentScope.workspaceId === workspaceId
    && currentScope.databaseClient === databaseClient
    && currentScope.userId === userId
    && currentScope.collaborationEnabled === collaborationEnabled
    && currentScope.role === role;
  const callbackScopeVersion = scopeVersionRef.current;
  const isCurrentCallbackScope = useCallback(() => scopeVersionRef.current === callbackScopeVersion
    && mountedRef.current
    && scopeRef.current.client === client
    && scopeRef.current.workspaceId === workspaceId
    && scopeRef.current.databaseClient === databaseClient
    && scopeRef.current.userId === userId
    && scopeRef.current.collaborationEnabled === collaborationEnabled
    && scopeRef.current.role === role, [callbackScopeVersion, client, collaborationEnabled, databaseClient, role, userId, workspaceId]);

  const resetTransientState = useCallback(() => {
    notificationTargetController.current?.abort();
    notificationTargetController.current = null;
    targetRequestVersionRef.current += 1;
    setNotificationOpen(false);
    setUnreadCount(0);
    setTargetError(null);
    notificationOpenerRef.current = null;
    setSelectedDatabaseRecordId(null);
    setSelectedCommentId(null);
    setCollaborationInitialSection("people");
    setResolvedNotificationRecord(null);
  }, []);

  useLayoutEffect(() => {
    const changed = scopeRef.current.client !== client
      || scopeRef.current.databaseClient !== databaseClient
      || scopeRef.current.workspaceId !== workspaceId
      || scopeRef.current.userId !== userId
      || scopeRef.current.collaborationEnabled !== collaborationEnabled
      || scopeRef.current.role !== role;
    if (!changed) return;
    scopeRef.current = { client, databaseClient, workspaceId, userId, collaborationEnabled, role };
    scopeVersionRef.current += 1;
    setScopeEpoch(scopeVersionRef.current);
    resetTransientState();
  }, [client, collaborationEnabled, databaseClient, resetTransientState, role, userId, workspaceId]);

  useEffect(() => {
    const isCurrentScope = scopeRef.current.client === client
      && scopeRef.current.databaseClient === databaseClient
      && scopeRef.current.workspaceId === workspaceId
      && scopeRef.current.userId === userId
      && scopeRef.current.collaborationEnabled === collaborationEnabled
      && scopeRef.current.role === role;
    if (!workspaceId || !collaborationEnabled) {
      if (isCurrentScope) setUnreadCount(0);
      return undefined;
    }
    const requestClient = client;
    const requestDatabaseClient = databaseClient;
    const requestWorkspaceId = workspaceId;
    const requestUserId = userId;
    const scopeVersion = scopeVersionRef.current;
    const controller = new AbortController();
    let active = true;
    const isCurrent = () => active
      && mountedRef.current
      && !controller.signal.aborted
      && scopeVersionRef.current === scopeVersion
      && scopeRef.current.client === requestClient
      && scopeRef.current.databaseClient === requestDatabaseClient
      && scopeRef.current.workspaceId === requestWorkspaceId
      && scopeRef.current.userId === requestUserId
      && scopeRef.current.collaborationEnabled
      && scopeRef.current.role === role;
    const loadUnreadCount = () => {
      void requestClient.getUnreadCount(controller.signal).then((count) => {
        if (isCurrent()) setUnreadCount(count);
      }).catch(() => {
        if (isCurrent()) setUnreadCount(0);
      });
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const idleHandle = idleWindow.requestIdleCallback?.(loadUnreadCount, { timeout: 500 });
    const timer = idleHandle === undefined ? window.setTimeout(loadUnreadCount, 100) : undefined;
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      controller.abort();
    };
  }, [client, collaborationEnabled, databaseClient, role, userId, workspaceId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      notificationTargetController.current?.abort();
      targetRequestVersionRef.current += 1;
    };
  }, []);

  const toggleNotifications = useCallback((opener: HTMLElement) => {
    if (!isCurrentCallbackScope() || !collaborationEnabled || !workspaceId) return;
    notificationOpenerRef.current = opener;
    setNotificationOpen((open) => !open);
  }, [collaborationEnabled, isCurrentCallbackScope, workspaceId]);

  const closeNotifications = useCallback(() => {
    if (isCurrentCallbackScope()) setNotificationOpen(false);
  }, [isCurrentCallbackScope]);

  const onNotificationRead = useCallback((count: number) => {
    if (!isCurrentCallbackScope()) return;
    setUnreadCount((current) => Math.max(0, current - count));
  }, [isCurrentCallbackScope]);

  const navigateNotificationTarget = useCallback((target: NotificationTarget) => {
    if (!isCurrentCallbackScope()) return;
    closeNotifications();
    setTargetError(null);
    notificationTargetController.current?.abort();
    const requestVersion = ++targetRequestVersionRef.current;
    const requestClient = client;
    const requestDatabaseClient = databaseClient;
    const requestWorkspaceId = workspaceId;
    const requestUserId = userId;
    const requestRole = role;
    const scopeVersion = scopeVersionRef.current;
    const requestNotesGeneration = callbackNotesGeneration;
    const requestNotes = callbackNotes;
    const requestDatabaseDataGeneration = callbackDatabaseDataGeneration;
    const requestDatabaseData = callbackDatabaseData;
    const isCurrent = (signal?: AbortSignal) => !signal?.aborted
      && mountedRef.current
      && requestVersion === targetRequestVersionRef.current
      && scopeVersionRef.current === scopeVersion
      && scopeRef.current.client === requestClient
      && scopeRef.current.databaseClient === requestDatabaseClient
      && scopeRef.current.workspaceId === requestWorkspaceId
      && scopeRef.current.userId === requestUserId
      && scopeRef.current.collaborationEnabled
      && scopeRef.current.role === requestRole;
    if (target.targetType === "note") {
      if (!isCurrent()
        || notesGenerationRef.current !== requestNotesGeneration
        || notesRef.current !== requestNotes) return;
      const scopedNotes = requestWorkspaceId
        ? requestNotes.filter((note) => note.workspace_id === requestWorkspaceId)
        : [];
      if (!scopedNotes.some((note) => note.id === target.targetId)) {
        setSelectedNoteId(null);
        setSelectedDatabaseRecordId(null);
        setResolvedNotificationRecord(null);
        setSelectedCommentId(null);
        setTargetError("无法定位通知中的笔记。");
        setCollaborationInitialSection("comments");
        transitionToDomain("collaboration");
        return;
      }
      setSelectedNoteId(target.targetId);
      setSelectedDatabaseRecordId(null);
      setResolvedNotificationRecord(null);
      setSelectedCommentId(target.commentId);
      setCollaborationInitialSection("comments");
      transitionToDomain("collaboration");
      return;
    }

    const selectTarget = (availableDatabases: Database[], database: Database, record: DatabaseRecord, signal?: AbortSignal) => {
      if (!isCurrent(signal)
        || databaseDataGenerationRef.current !== requestDatabaseDataGeneration
        || databaseDataRef.current !== requestDatabaseData
        || !requestWorkspaceId
        || database.workspace_id !== requestWorkspaceId
        || record.workspace_id !== requestWorkspaceId
        || record.id !== target.targetId
        || record.database_id !== database.id) return false;
      setTargetError(null);
      setDatabases(availableDatabases);
      setSelectedNoteId(null);
      setSelectedDatabaseId(database.id);
      setSelectedDatabaseRecordId(record.id);
      setResolvedNotificationRecord(record);
      setSelectedCommentId(target.commentId);
      setDatabaseError(null);
      setCollaborationInitialSection("comments");
      transitionToDomain("collaboration");
      return true;
    };
    const loadedRecord = requestDatabaseData.databaseRecords.find((candidate) => candidate.id === target.targetId
      && candidate.workspace_id === requestWorkspaceId
      && (!target.databaseId || candidate.database_id === target.databaseId));
    const scopedDatabases = filterWorkspaceDatabases(requestDatabaseData.databases, requestWorkspaceId);
    const loadedDatabase = loadedRecord
      ? scopedDatabases.find((candidate) => candidate.id === loadedRecord.database_id)
      : undefined;
    if (loadedRecord && loadedDatabase) {
      selectTarget(scopedDatabases, loadedDatabase, loadedRecord);
      return;
    }
    if (!requestWorkspaceId) return;
    const controller = new AbortController();
    notificationTargetController.current = controller;
    void resolveDatabaseNotificationTarget(requestDatabaseClient, target, requestWorkspaceId, controller.signal).then(({ database, databases: availableDatabases, record }) => {
      if (!selectTarget(availableDatabases, database, record, controller.signal)
        && isCurrent(controller.signal)
        && databaseDataGenerationRef.current === requestDatabaseDataGeneration
        && databaseDataRef.current === requestDatabaseData) {
        throw Object.assign(new Error("Database notification target was not found"), { code: "RECORD_NOT_FOUND", status: 404 });
      }
    }).catch((error: unknown) => {
      if (!isCurrent(controller.signal)
        || isAborted(error, controller.signal)
        || databaseDataGenerationRef.current !== requestDatabaseDataGeneration
        || databaseDataRef.current !== requestDatabaseData) return;
      setSelectedNoteId(null);
      setSelectedDatabaseRecordId(null);
      setResolvedNotificationRecord(null);
      setSelectedCommentId(null);
      setTargetError("无法定位通知中的数据库记录。");
      setDatabaseError("无法定位通知中的数据库记录。");
      setCollaborationInitialSection("comments");
      transitionToDomain("collaboration");
    }).finally(() => {
      if (notificationTargetController.current === controller) notificationTargetController.current = null;
    });
  }, [callbackDatabaseData, callbackDatabaseDataGeneration, callbackNotes, callbackNotesGeneration, client, closeNotifications, databaseClient, isCurrentCallbackScope, role, setCollaborationInitialSection, setDatabaseError, setDatabases, setResolvedNotificationRecord, setSelectedCommentId, setSelectedDatabaseId, setSelectedDatabaseRecordId, setSelectedNoteId, transitionToDomain, userId, workspaceId]);

  return {
    unreadCount: scopeMatches ? unreadCount : 0,
    notificationOpen: scopeMatches ? notificationOpen : false,
    notificationOpenerRef,
    targetError: scopeMatches ? targetError : null,
    toggleNotifications,
    closeNotifications,
    onNotificationRead,
    navigateNotificationTarget,
  };
}
