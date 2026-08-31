import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Database, DatabaseRecord } from "@nexus/contracts";

import type { DatabaseBootstrap, DatabaseBundle, DatabaseClient } from "../data/database-client";
import type { RecordsPageRequest } from "../databases/DatabaseWorkbench";

export interface UseDatabaseWorkspaceDataParams {
  client: DatabaseClient;
  workspaceId?: string;
  active: boolean;
  webClipperOpen: boolean;
  refreshVersion: number;
  resolvedNotificationRecord: DatabaseRecord | null;
}

export interface DatabaseWorkspaceDataState {
  databases: Database[];
  setDatabases: Dispatch<SetStateAction<Database[]>>;
  selectedDatabaseId: string | null;
  setSelectedDatabaseId: Dispatch<SetStateAction<string | null>>;
  databaseBundle: DatabaseBundle | null;
  setDatabaseBundle: Dispatch<SetStateAction<DatabaseBundle | null>>;
  databaseRecords: DatabaseRecord[];
  setDatabaseRecords: Dispatch<SetStateAction<DatabaseRecord[]>>;
  databaseRecordsNextCursor: string | null;
  setDatabaseRecordsNextCursor: Dispatch<SetStateAction<string | null>>;
  databaseLoading: boolean;
  databaseError: string | null;
  setDatabaseError: Dispatch<SetStateAction<string | null>>;
  requestDatabasePage: RecordsPageRequest;
  abortDatabaseRequests(): void;
}

function isAborted(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function pageLimit(bundle: DatabaseBundle | null) {
  const configured = bundle?.views[0]?.config.page_size;
  return typeof configured === "number" && Number.isFinite(configured) ? configured : 50;
}

function scopeBootstrap(bootstrap: DatabaseBootstrap, workspaceId: string): DatabaseBootstrap {
  const items = bootstrap.items.filter((database) => database.workspace_id === workspaceId);
  const selectedId = bootstrap.selected_database_id;
  const selectedDatabase = selectedId ? items.find((database) => database.id === selectedId) : undefined;
  const sourceBundle = bootstrap.bundle;
  const bundle = sourceBundle
    && selectedDatabase
    && sourceBundle.database.workspace_id === workspaceId
    && sourceBundle.database.id === selectedId
    ? {
        ...sourceBundle,
        properties: sourceBundle.properties.filter((property) => property.workspace_id === workspaceId && property.database_id === selectedId),
        views: sourceBundle.views.filter((view) => view.workspace_id === workspaceId && view.database_id === selectedId),
        templates: sourceBundle.templates.filter((template) => template.workspace_id === workspaceId && template.database_id === selectedId),
      }
    : null;
  if (!bundle || !selectedId) {
    return { items, selected_database_id: null, bundle: null, records: { items: [], next_cursor: null } };
  }
  return {
    items,
    selected_database_id: selectedId,
    bundle,
    records: {
      items: bootstrap.records.items.filter((record) => record.workspace_id === workspaceId && record.database_id === selectedId),
      next_cursor: bootstrap.records.next_cursor,
    },
  };
}

export function runVerifiedDatabaseMutation<T>(
  activeDatabaseId: string | null,
  mutation: (databaseId: string) => Promise<T>,
) {
  if (!activeDatabaseId) return Promise.reject(new Error("当前数据库不可用。"));
  return mutation(activeDatabaseId);
}

export function useDatabaseWorkspaceData({
  client,
  workspaceId,
  active,
  webClipperOpen,
  refreshVersion,
  resolvedNotificationRecord,
}: UseDatabaseWorkspaceDataParams): DatabaseWorkspaceDataState {
  const [databases, setDatabases] = useState<Database[]>([]);
  const [selectedDatabaseId, setSelectedDatabaseIdState] = useState<string | null>(null);
  const [databaseBundle, setDatabaseBundle] = useState<DatabaseBundle | null>(null);
  const [databaseRecords, setDatabaseRecords] = useState<DatabaseRecord[]>([]);
  const [databaseRecordsNextCursor, setDatabaseRecordsNextCursor] = useState<string | null>(null);
  const [databaseLoading, setDatabaseLoading] = useState(false);
  const [databaseError, setDatabaseError] = useState<string | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const workspaceRef = useRef<string | undefined>(workspaceId);
  const clientRef = useRef(client);
  const selectedDatabaseIdRef = useRef<string | null>(selectedDatabaseId);
  const selectionSyncRef = useRef<string | null>(null);
  const lastRequestKeyRef = useRef<string | null>(null);
  selectedDatabaseIdRef.current = selectedDatabaseId;

  const setSelectedDatabaseId: Dispatch<SetStateAction<string | null>> = useCallback((value) => {
    const current = selectedDatabaseIdRef.current;
    const next = typeof value === "function" ? value(current) : value;
    if (next !== current) {
      selectedDatabaseIdRef.current = next;
      setDatabaseBundle(null);
      setDatabaseRecords([]);
      setDatabaseRecordsNextCursor(null);
      setDatabaseError(null);
    }
    setSelectedDatabaseIdState(next);
  }, []);

  const abortDatabaseRequests = useCallback(() => {
    requestGenerationRef.current += 1;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
  }, []);

  useEffect(() => {
    const workspaceChanged = workspaceRef.current !== workspaceId || clientRef.current !== client;
    workspaceRef.current = workspaceId;
    clientRef.current = client;
    const effectiveSelectedDatabaseId = workspaceChanged ? null : selectedDatabaseId;
    const effectiveBundle = workspaceChanged ? null : databaseBundle;
    const effectiveNotificationRecord = resolvedNotificationRecord?.workspace_id === workspaceId
      ? resolvedNotificationRecord
      : null;

    if (workspaceChanged) {
      abortDatabaseRequests();
      selectionSyncRef.current = null;
      lastRequestKeyRef.current = null;
      setDatabases([]);
      setSelectedDatabaseId(null);
      setDatabaseBundle(null);
      setDatabaseRecords([]);
      setDatabaseRecordsNextCursor(null);
      setDatabaseLoading(false);
      setDatabaseError(null);
    }

    if (!active || !workspaceId) {
      abortDatabaseRequests();
      lastRequestKeyRef.current = null;
      setDatabaseLoading(false);
      if (!workspaceId) {
        setDatabases([]);
        setSelectedDatabaseId(null);
        setDatabaseBundle(null);
        setDatabaseRecords([]);
        setDatabaseRecordsNextCursor(null);
        setDatabaseError("未选择工作区，无法加载数据库。");
      }
      return undefined;
    }

    const selectedRecordIdentity = effectiveNotificationRecord
      ? `${effectiveNotificationRecord.database_id}:${effectiveNotificationRecord.id}`
      : "";
    const requestKey = [
      workspaceId,
      effectiveSelectedDatabaseId ?? "",
      refreshVersion,
      selectedRecordIdentity,
    ].join("\u0000");

    // bootstrap adopts its own selected id. The resulting state update must not
    // immediately issue the same request a second time.
    if (
      selectionSyncRef.current === effectiveSelectedDatabaseId
      && effectiveSelectedDatabaseId !== null
      && effectiveBundle?.database.id === effectiveSelectedDatabaseId
    ) {
      selectionSyncRef.current = null;
      lastRequestKeyRef.current = requestKey;
      return undefined;
    }
    if (lastRequestKeyRef.current === requestKey) return undefined;
    lastRequestKeyRef.current = requestKey;

    abortDatabaseRequests();
    const controller = new AbortController();
    const generation = requestGenerationRef.current;
    activeRequestRef.current = controller;
    const hasVisibleData = !workspaceChanged && (databases.length > 0 || databaseBundle !== null || databaseRecords.length > 0);
    setDatabaseLoading(!hasVisibleData);
    setDatabaseError(null);

    void client.bootstrap({
      databaseId: effectiveSelectedDatabaseId ?? undefined,
      limit: pageLimit(effectiveBundle),
      signal: controller.signal,
    }).then((bootstrap: DatabaseBootstrap) => {
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      const scopedBootstrap = scopeBootstrap(bootstrap, workspaceId);
      selectionSyncRef.current = scopedBootstrap.selected_database_id;
      setDatabases(scopedBootstrap.items);
      setSelectedDatabaseId(scopedBootstrap.selected_database_id);
      setDatabaseBundle(scopedBootstrap.bundle);
      const targetRecord = scopedBootstrap.bundle
        && effectiveNotificationRecord?.database_id === scopedBootstrap.bundle.database.id
        && !scopedBootstrap.records.items.some((record) => record.id === effectiveNotificationRecord.id)
        ? effectiveNotificationRecord
        : null;
      const records = targetRecord ? [targetRecord, ...scopedBootstrap.records.items] : scopedBootstrap.records.items;
      setDatabaseRecords(records);
      setDatabaseRecordsNextCursor(scopedBootstrap.records.next_cursor);
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal) && generation === requestGenerationRef.current) {
        setDatabaseError("数据库内容暂时无法加载，保留最近可用数据。");
      }
    }).finally(() => {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
      if (!controller.signal.aborted && generation === requestGenerationRef.current) setDatabaseLoading(false);
    });

    return () => {
      if (activeRequestRef.current === controller) {
        controller.abort();
        activeRequestRef.current = null;
      }
    };
  }, [
    abortDatabaseRequests,
    active,
    client,
    databaseBundle,
    databaseRecords.length,
    databases.length,
    refreshVersion,
    resolvedNotificationRecord,
    selectedDatabaseId,
    workspaceId,
  ]);

  useEffect(() => {
    if (!webClipperOpen || !workspaceId) return undefined;
    const controller = new AbortController();
    const generation = requestGenerationRef.current;
    void client.listDatabases(controller.signal).then((items) => {
      if (!controller.signal.aborted
        && generation === requestGenerationRef.current
        && clientRef.current === client
        && workspaceRef.current === workspaceId) {
        setDatabases(items.filter((database) => database.workspace_id === workspaceId));
      }
    }).catch(() => {
      // The clipper remains usable for Inbox and Daily when discovery is unavailable.
    });
    return () => controller.abort();
  }, [client, webClipperOpen, workspaceId]);

  const requestDatabasePage: RecordsPageRequest = useCallback(({ cursor, limit, viewId, signal }) => {
    const requestDatabaseId = databaseBundle
      && databaseBundle.database.workspace_id === workspaceId
      && selectedDatabaseId !== null
      && databaseBundle.database.id === selectedDatabaseId
      ? databaseBundle.database.id
      : null;
    if (!workspaceId || !requestDatabaseId) return Promise.resolve({ items: [], next_cursor: null });
    return client.listRecords(requestDatabaseId, { cursor: cursor ?? undefined, viewId, limit, signal });
  }, [client, databaseBundle, selectedDatabaseId, workspaceId]);

  useEffect(() => () => abortDatabaseRequests(), [abortDatabaseRequests]);

  return {
    databases,
    setDatabases,
    selectedDatabaseId,
    setSelectedDatabaseId,
    databaseBundle,
    setDatabaseBundle,
    databaseRecords,
    setDatabaseRecords,
    databaseRecordsNextCursor,
    setDatabaseRecordsNextCursor,
    databaseLoading,
    databaseError,
    setDatabaseError,
    requestDatabasePage,
    abortDatabaseRequests,
  };
}
