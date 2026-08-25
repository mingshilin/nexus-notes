import type { BoardMoveInput, CalendarAssignmentInput, Database, DatabaseProperty, DatabaseRecord, DatabaseTemplate, DatabaseView } from "@nexus/contracts";
import { useEffect, useRef, useState } from "react";

import type { DatabaseClient } from "../data/database-client";
import type { CollaborationClient } from "../data/collaboration-client";
import { DatabasePaginationStore } from "../data/database-state";
import { useWorkbenchModalState } from "../layout/AdaptiveWorkbench";
import { DatabaseBoardView } from "./DatabaseBoardView";
import { DatabaseCalendarView } from "./DatabaseCalendarView";
import { DatabaseTableView } from "./DatabaseTableView";
import { DatabaseToolsDrawer } from "./DatabaseToolsDrawer";
import { executeView, replaceRecord, visibleProperties } from "./database-view-utils";

const memoryStorage = { getItem: () => null, setItem: () => undefined };
const COLLECTION_FETCH_SIZE = 100;
type RecordPage = { items: DatabaseRecord[]; next_cursor: string | null };
export type RecordsPageRequest = (options: { cursor: string | null; limit: number; viewId?: string; signal?: AbortSignal }) => Promise<RecordPage>;

export interface DatabaseWorkbenchProps {
  database: Database;
  databases?: Database[];
  properties: DatabaseProperty[];
  records: DatabaseRecord[];
  recordsNextCursor?: string | null;
  views: DatabaseView[];
  templates?: DatabaseTemplate[];
  activeViewId?: string;
  paginationStore?: DatabasePaginationStore;
  client?: DatabaseClient;
  collaborationClient?: CollaborationClient;
  onMutation?(): void;
  onBoardMove?(input: BoardMoveInput): Promise<DatabaseRecord>;
  onCalendarAssign?(input: CalendarAssignmentInput): Promise<DatabaseRecord>;
  onRecordsPageRequest?: RecordsPageRequest;
  /** @deprecated callers should use onRecordsPageRequest with an explicit bound. */
  onTablePageRequest?(cursor: string | null): Promise<RecordPage>;
}

function viewFingerprint(view: DatabaseView | undefined) {
  return view ? `${view.id}:${view.revision}:${JSON.stringify(view.config)}` : "no-view";
}

function recordSetFingerprint(records: readonly DatabaseRecord[]) {
  return records.map((record) => `${record.id}:${record.revision}`).join("|");
}

export function DatabaseWorkbench({
  database, databases = [database], properties, records: sourceRecords, recordsNextCursor = null, views, templates, activeViewId, paginationStore, client, onMutation,
  collaborationClient, onBoardMove, onCalendarAssign, onRecordsPageRequest, onTablePageRequest,
}: DatabaseWorkbenchProps) {
  const [records, setRecords] = useState(sourceRecords);
  const [nextCursor, setNextCursor] = useState<string | null>(recordsNextCursor);
  const [page, setPage] = useState(1);
  const [exactPage, setExactPage] = useState(false);
  const [pageRequestPending, setPageRequestPending] = useState(false);
  const [collectionPending, setCollectionPending] = useState(false);
  const [selectedViewId, setSelectedViewId] = useState(activeViewId ?? views[0]?.id ?? "");
  const [toolsOpen, setToolsOpen] = useState(false);
  const setWorkbenchModalOpen = useWorkbenchModalState();
  const [store] = useState(() => paginationStore ?? new DatabasePaginationStore(typeof window === "undefined" ? memoryStorage : window.localStorage));
  const cursors = useRef<Record<number, string | null>>({ 1: null });
  const cachedPages = useRef(new Map<number, RecordPage>());
  const activeRequest = useRef(0);
  const requestAbort = useRef<AbortController | null>(null);
  const collectionRequest = useRef(0);
  const collectionAbort = useRef<AbortController | null>(null);
  const lastViewFingerprint = useRef<string | null>(null);
  const bulkOperations = useRef(new Map<string, string>());
  const bulkQueue = useRef(Promise.resolve());
  const mutationQueues = useRef(new Map<string, Promise<void>>());
  const confirmedRecords = useRef(new Map<string, DatabaseRecord>());
  const latestRecords = useRef(sourceRecords);
  const selectedView = views.find((view) => view.id === selectedViewId) ?? views[0];
  const selectedFingerprint = viewFingerprint(selectedView);
  const collectionIdentity = `${database.id}:${selectedFingerprint}`;
  const activeCollectionIdentity = useRef(collectionIdentity);
  activeCollectionIdentity.current = collectionIdentity;
  const sourceFingerprint = recordSetFingerprint(sourceRecords);
  const pageSize = selectedView?.config.page_size ?? 50;
  const requestPage: RecordsPageRequest | undefined = onRecordsPageRequest ?? (onTablePageRequest ? ({ cursor }) => onTablePageRequest(cursor) : undefined);

  useEffect(() => {
    latestRecords.current = sourceRecords;
    setRecords(sourceRecords);
    setNextCursor(recordsNextCursor);
    setExactPage(false);
    cachedPages.current = new Map([[1, { items: sourceRecords, next_cursor: recordsNextCursor }]]);
    cursors.current = { 1: null };
  }, [database.id, recordsNextCursor, sourceFingerprint]);

  useEffect(() => {
    if (activeViewId) setSelectedViewId(activeViewId);
    else if (selectedViewId && !views.some((view) => view.id === selectedViewId)) setSelectedViewId(views[0]?.id ?? "");
  }, [activeViewId, selectedViewId, views]);

  useEffect(() => () => {
    requestAbort.current?.abort();
    collectionAbort.current?.abort();
    setWorkbenchModalOpen(false);
  }, [setWorkbenchModalOpen]);

  useEffect(() => {
    if (!selectedView) return;
    const previous = lastViewFingerprint.current;
    const changed = previous !== null && previous !== selectedFingerprint;
    lastViewFingerprint.current = selectedFingerprint;
    requestAbort.current?.abort();
    collectionAbort.current?.abort();
    collectionRequest.current += 1;
    setCollectionPending(false);
    const controller = new AbortController();
    requestAbort.current = controller;
    cachedPages.current = new Map([[1, { items: sourceRecords, next_cursor: recordsNextCursor }]]);
    cursors.current = { 1: null };

    if (changed && requestPage) {
      const requestId = ++activeRequest.current;
      setPage(1);
      setExactPage(true);
      setPageRequestPending(true);
      void requestPage({ cursor: null, limit: selectedView.config.page_size, viewId: selectedView.id, signal: controller.signal }).then((result) => {
        if (controller.signal.aborted || activeRequest.current !== requestId) return;
        cachedPages.current.set(1, result);
        cursors.current[2] = result.next_cursor;
        latestRecords.current = result.items;
        setRecords(result.items);
        setNextCursor(result.next_cursor);
      }).catch(() => undefined).finally(() => {
        if (activeRequest.current === requestId) setPageRequestPending(false);
      });
      return () => controller.abort();
    }

    const saved = store.read(database.workspace_id, database.id, selectedView.id, selectedView.config.page_size, selectedFingerprint)
      ?? store.read(database.workspace_id, database.id, selectedView.id, selectedView.config.page_size);
    const targetPage = saved?.page ?? 1;
    cursors.current = saved?.cursors ?? { 1: null };
    setPage(targetPage);
    if (targetPage === 1 || !requestPage) { setExactPage(false); return () => controller.abort(); }
    const cursor = cursors.current[targetPage];
    if (cursor === undefined) { setPage(1); setExactPage(false); return () => controller.abort(); }
    const requestId = ++activeRequest.current;
    setPageRequestPending(true);
    void requestPage({ cursor, limit: selectedView.config.page_size, viewId: selectedView.id, signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || activeRequest.current !== requestId) return;
      cachedPages.current.set(targetPage, result);
      cursors.current[targetPage + 1] = result.next_cursor;
      latestRecords.current = result.items;
      setRecords(result.items); setNextCursor(result.next_cursor); setExactPage(true);
    }).catch(() => { if (!controller.signal.aborted && activeRequest.current === requestId) { setPage(1); setExactPage(false); } }).finally(() => {
      if (activeRequest.current === requestId) setPageRequestPending(false);
    });
    return () => controller.abort();
  }, [database.id, database.workspace_id, recordsNextCursor, requestPage, selectedFingerprint, selectedView, sourceFingerprint, store]);

  const publishRecords = (next: DatabaseRecord[]) => {
    latestRecords.current = next;
    setRecords(next);
  };
  const changeToolsOpen = (open: boolean) => {
    setToolsOpen(open);
    setWorkbenchModalOpen(open);
  };
  const coordinateRecordMutation = ({ record_id, values, command }: {
    record_id: string;
    values: Record<string, unknown>;
    command(baseRevision: number): Promise<DatabaseRecord>;
  }) => {
    const record = latestRecords.current.find((candidate) => candidate.id === record_id);
    if (!record) return Promise.resolve();
    if (!confirmedRecords.current.has(record_id)) confirmedRecords.current.set(record_id, record);
    const token = crypto.randomUUID();
    bulkOperations.current.set(record_id, token);
    publishRecords(replaceRecord(latestRecords.current, {
      ...record,
      revision: record.revision + 1,
      values: { ...record.values, ...values },
    }));
    const execute = async () => {
      const confirmed = confirmedRecords.current.get(record_id) ?? record;
      try {
        const saved = await command(confirmed.revision);
        confirmedRecords.current.set(record_id, saved);
        if (bulkOperations.current.get(record_id) === token) publishRecords(replaceRecord(latestRecords.current, saved));
      } catch (error) {
        if (bulkOperations.current.get(record_id) === token) publishRecords(replaceRecord(latestRecords.current, confirmed));
        throw error;
      }
    };
    const previous = mutationQueues.current.get(record_id) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(execute);
    mutationQueues.current.set(record_id, queued);
    return queued.finally(() => {
      if (mutationQueues.current.get(record_id) !== queued) return;
      mutationQueues.current.delete(record_id);
      if (bulkOperations.current.get(record_id) === token) bulkOperations.current.delete(record_id);
      if (!bulkOperations.current.has(record_id)) confirmedRecords.current.delete(record_id);
    });
  };

  if (!selectedView) {
    return <section className="database-workbench" aria-hidden={toolsOpen || undefined} inert={toolsOpen || undefined}>
      <header className="database-workbench-header"><div><p className="eyebrow">STRUCTURED DATABASE</p><h1>{database.name}</h1><p>{database.description}</p></div>
        <DatabaseToolsDrawer open={toolsOpen} views={views} activeViewId="" database={database} databases={databases} databaseId={database.id} properties={properties} records={records} templates={templates} client={client} collaborationClient={collaborationClient} onOpenChange={changeToolsOpen} onViewChange={setSelectedViewId} onMutation={onMutation} />
      </header>
      <p className="database-empty">尚未创建数据库视图。请先添加属性或创建视图。</p>
    </section>;
  }

  const configuredRecords = executeView(records, selectedView);
  const configuredProperties = visibleProperties(properties, selectedView);
  const changePage = (nextPage: number) => {
    if (nextPage < 1 || pageRequestPending) return;
    if (!exactPage && nextPage <= Math.ceil(configuredRecords.length / pageSize)) {
      setPage(nextPage);
      store.write(database.workspace_id, database.id, selectedView.id, { page: nextPage, pageSize, cursors: cursors.current }, selectedFingerprint);
      return;
    }
    const cached = cachedPages.current.get(nextPage);
    if (cached) {
      latestRecords.current = cached.items;
      setRecords(cached.items); setNextCursor(cached.next_cursor); setExactPage(nextPage !== 1); setPage(nextPage);
      store.write(database.workspace_id, database.id, selectedView.id, { page: nextPage, pageSize, cursors: cursors.current }, selectedFingerprint);
      return;
    }
    const cursor = cursors.current[nextPage] ?? cachedPages.current.get(page)?.next_cursor;
    if (cursor === undefined || cursor === null || !requestPage) return;
    cursors.current[nextPage] = cursor;
    const requestId = ++activeRequest.current;
    requestAbort.current?.abort();
    const controller = new AbortController();
    requestAbort.current = controller;
    setPageRequestPending(true);
    void requestPage({ cursor, limit: pageSize, viewId: selectedView.id, signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || activeRequest.current !== requestId) return;
      cachedPages.current.set(nextPage, result);
      cursors.current[nextPage + 1] = result.next_cursor;
      latestRecords.current = result.items;
      setRecords(result.items); setNextCursor(result.next_cursor); setExactPage(true); setPage(nextPage);
      store.write(database.workspace_id, database.id, selectedView.id, { page: nextPage, pageSize, cursors: cursors.current }, selectedFingerprint);
    }).catch(() => undefined).finally(() => { if (activeRequest.current === requestId) setPageRequestPending(false); });
  };
  const loadMoreCollection = () => {
    if (!requestPage || !nextCursor || collectionPending) return;
    const cursor = nextCursor;
    const requestId = ++collectionRequest.current;
    const identity = collectionIdentity;
    collectionAbort.current?.abort();
    const controller = new AbortController();
    collectionAbort.current = controller;
    setCollectionPending(true);
    void requestPage({ cursor, limit: COLLECTION_FETCH_SIZE, viewId: selectedView.id }).then((result) => {
      if (controller.signal.aborted || collectionRequest.current !== requestId || activeCollectionIdentity.current !== identity) return;
      setRecords((current) => {
        const seen = new Set(current.map((record) => record.id));
        const next = [...current, ...result.items.filter((record) => !seen.has(record.id) && Boolean(seen.add(record.id)))];
        latestRecords.current = next;
        return next;
      });
      setNextCursor(result.next_cursor);
    }).catch(() => undefined).finally(() => {
      if (collectionRequest.current === requestId) setCollectionPending(false);
    });
  };
  const changeView = (viewId: string) => {
    collectionAbort.current?.abort();
    collectionRequest.current += 1;
    setCollectionPending(false);
    setSelectedViewId(viewId);
    changeToolsOpen(false);
  };
  const previewBulkEdit = async (mutations: { record_id: string; base_revision: number; values: Record<string, unknown> }[]) => {
    if (!client) return;
    const original = new Map(latestRecords.current.map((record) => [record.id, record]));
    const tokens = new Map<string, string>();
    for (const mutation of mutations) { const token = crypto.randomUUID(); tokens.set(mutation.record_id, token); bulkOperations.current.set(mutation.record_id, token); }
    const optimistic = latestRecords.current.map((record) => {
      const mutation = mutations.find((candidate) => candidate.record_id === record.id);
      return mutation ? { ...record, revision: record.revision + 1, values: { ...record.values, ...mutation.values } } : record;
    });
    publishRecords(optimistic);
    const execute = async () => {
      try {
        const prepared = mutations.map((mutation) => ({
          ...mutation,
          base_revision: (confirmedRecords.current.get(mutation.record_id) ?? original.get(mutation.record_id))?.revision ?? mutation.base_revision,
        }));
        const result = await client.bulkEdit(database.id, { mutations: prepared });
        setRecords((current) => {
          const next = current.map((record) => {
            const saved = result.items.find((item) => item.id === record.id);
            const token = tokens.get(record.id);
            if (!saved || !token || bulkOperations.current.get(record.id) !== token) return record;
            bulkOperations.current.delete(record.id);
            confirmedRecords.current.set(record.id, saved);
            return saved;
          });
          latestRecords.current = next;
          return next;
        });
      } catch (error) {
        setRecords((current) => {
          const next = current.map((record) => {
            const token = tokens.get(record.id); const snapshot = confirmedRecords.current.get(record.id) ?? original.get(record.id);
            if (!token || !snapshot || bulkOperations.current.get(record.id) !== token) return record;
            bulkOperations.current.delete(record.id);
            return snapshot;
          });
          latestRecords.current = next;
          return next;
        });
        throw error;
      }
    };
    const blockers = mutations.map((mutation) => mutationQueues.current.get(mutation.record_id)).filter((pending): pending is Promise<void> => Boolean(pending));
    const queued = bulkQueue.current.catch(() => undefined).then(() => Promise.all(blockers.map((pending) => pending.catch(() => undefined)))).then(execute);
    bulkQueue.current = queued;
    return queued.finally(() => {
      for (const mutation of mutations) {
        if (!bulkOperations.current.has(mutation.record_id) && !mutationQueues.current.has(mutation.record_id)) confirmedRecords.current.delete(mutation.record_id);
      }
    });
  };

  return <section className="database-workbench" aria-hidden={toolsOpen || undefined} inert={toolsOpen || undefined}>
    <header className="database-workbench-header"><div><p className="eyebrow">STRUCTURED DATABASE</p><h1>{database.name}</h1><p>{database.description}</p></div>
      <DatabaseToolsDrawer open={toolsOpen} views={views} activeViewId={selectedView.id} database={database} databases={databases} databaseId={database.id} properties={properties} records={records} templates={templates} client={client} collaborationClient={collaborationClient} onOpenChange={changeToolsOpen} onViewChange={changeView} onMutation={onMutation} onBulkPreview={previewBulkEdit} />
    </header>
    <nav className="database-view-tabs" aria-label="数据库视图">{views.map((view) => <button className={view.id === selectedView.id ? "active" : ""} type="button" key={view.id} onClick={() => changeView(view.id)}>{view.name}</button>)}</nav>
    {selectedView.type === "table" ? <DatabaseTableView properties={configuredProperties} records={configuredRecords} page={page} pageSize={pageSize} exactPage={exactPage} onPageChange={changePage} hasNextPage={Boolean(nextCursor && requestPage) && !pageRequestPending} /> : null}
    {selectedView.type === "board" ? <DatabaseBoardView properties={properties} records={configuredRecords} sourceRevisionKey={sourceFingerprint} view={selectedView} onRecordsChange={publishRecords} onBoardMove={onBoardMove} onRecordMutation={coordinateRecordMutation} canLoadMore={Boolean(nextCursor && requestPage)} loadMorePending={collectionPending} onLoadMore={loadMoreCollection} /> : null}
    {selectedView.type === "calendar" ? <DatabaseCalendarView properties={properties} records={configuredRecords} sourceRevisionKey={sourceFingerprint} view={selectedView} onRecordsChange={publishRecords} onCalendarAssign={onCalendarAssign} onRecordMutation={coordinateRecordMutation} canLoadMore={Boolean(nextCursor && requestPage)} loadMorePending={collectionPending} onLoadMore={loadMoreCollection} /> : null}
  </section>;
}
