import type { BoardMoveInput, CalendarAssignmentInput, Database, DatabaseProperty, DatabaseRecord, DatabaseView } from "@nexus/contracts";
import { useEffect, useRef, useState } from "react";

import type { DatabaseClient } from "../data/database-client";
import { DatabasePaginationStore } from "../data/database-state";
import { DatabaseBoardView } from "./DatabaseBoardView";
import { DatabaseCalendarView } from "./DatabaseCalendarView";
import { DatabaseTableView } from "./DatabaseTableView";
import { DatabaseToolsDrawer } from "./DatabaseToolsDrawer";
import { executeView, visibleProperties } from "./database-view-utils";

const memoryStorage = { getItem: () => null, setItem: () => undefined };
type RecordPage = { items: DatabaseRecord[]; next_cursor: string | null };
export type RecordsPageRequest = (options: { cursor: string | null; limit: number }) => Promise<RecordPage>;

export interface DatabaseWorkbenchProps {
  database: Database;
  properties: DatabaseProperty[];
  records: DatabaseRecord[];
  recordsNextCursor?: string | null;
  views: DatabaseView[];
  activeViewId?: string;
  paginationStore?: DatabasePaginationStore;
  client?: DatabaseClient;
  onMutation?(): void;
  onBoardMove?(input: BoardMoveInput): Promise<DatabaseRecord>;
  onCalendarAssign?(input: CalendarAssignmentInput): Promise<DatabaseRecord>;
  onRecordsPageRequest?: RecordsPageRequest;
  /** @deprecated callers should use onRecordsPageRequest with an explicit bound. */
  onTablePageRequest?(cursor: string | null): Promise<RecordPage>;
}

export function DatabaseWorkbench({
  database, properties, records: sourceRecords, recordsNextCursor = null, views, activeViewId, paginationStore, client, onMutation,
  onBoardMove, onCalendarAssign, onRecordsPageRequest, onTablePageRequest,
}: DatabaseWorkbenchProps) {
  const [records, setRecords] = useState(sourceRecords);
  const [nextCursor, setNextCursor] = useState<string | null>(recordsNextCursor);
  const [page, setPage] = useState(1);
  const [exactPage, setExactPage] = useState(false);
  const [pageRequestPending, setPageRequestPending] = useState(false);
  const [selectedViewId, setSelectedViewId] = useState(activeViewId ?? views[0]?.id ?? "");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [store] = useState(() => paginationStore ?? new DatabasePaginationStore(typeof window === "undefined" ? memoryStorage : window.localStorage));
  const cursors = useRef<Record<number, string | null>>({ 1: null });
  const cachedPages = useRef(new Map<number, RecordPage>());
  const activeRequest = useRef(0);
  const selectedView = views.find((view) => view.id === selectedViewId) ?? views[0];
  const pageSize = selectedView?.config.page_size ?? 50;
  const requestPage: RecordsPageRequest | undefined = onRecordsPageRequest ?? (onTablePageRequest ? ({ cursor }) => onTablePageRequest(cursor) : undefined);

  useEffect(() => {
    setRecords(sourceRecords); setNextCursor(recordsNextCursor); setExactPage(false);
    cachedPages.current = new Map([[1, { items: sourceRecords, next_cursor: recordsNextCursor }]]);
    cursors.current = { 1: null };
  }, [database.id, sourceRecords, recordsNextCursor]);

  useEffect(() => { if (activeViewId) setSelectedViewId(activeViewId); }, [activeViewId]);

  useEffect(() => {
    if (!selectedView) return;
    const saved = store.read(database.workspace_id, database.id, selectedView.id);
    const targetPage = saved?.page ?? 1;
    cursors.current = saved?.cursors ?? { 1: null };
    setPage(targetPage);
    if (targetPage === 1) { setExactPage(false); return; }
    const cursor = cursors.current[targetPage];
    if (cursor === undefined || !requestPage) { setPage(1); setExactPage(false); return; }
    const requestId = ++activeRequest.current;
    setPageRequestPending(true);
    void requestPage({ cursor, limit: selectedView.config.page_size }).then((result) => {
      if (activeRequest.current !== requestId) return;
      cachedPages.current.set(targetPage, result);
      cursors.current[targetPage + 1] = result.next_cursor;
      setRecords(result.items); setNextCursor(result.next_cursor); setExactPage(true);
    }).catch(() => { if (activeRequest.current === requestId) { setPage(1); setExactPage(false); } }).finally(() => { if (activeRequest.current === requestId) setPageRequestPending(false); });
  }, [database.id, database.workspace_id, requestPage, selectedView?.id, selectedView?.config.page_size, store]);

  // Board and calendar must not silently omit later cursor pages. Each request stays bounded by the saved view page size.
  useEffect(() => {
    if (!selectedView || selectedView.type === "table" || !requestPage || !recordsNextCursor) return;
    let cancelled = false;
    const load = async () => {
      let cursor: string | null = recordsNextCursor;
      const seen = new Set(sourceRecords.map((record) => record.id));
      while (cursor && !cancelled) {
        const result = await requestPage({ cursor, limit: selectedView.config.page_size });
        if (cancelled) return;
        setRecords((current) => [...current, ...result.items.filter((record) => !seen.has(record.id) && Boolean(seen.add(record.id)))]);
        cursor = result.next_cursor;
        setNextCursor(cursor);
      }
    };
    void load().catch(() => undefined);
    return () => { cancelled = true; };
  }, [recordsNextCursor, requestPage, selectedView?.id, selectedView?.type, selectedView?.config.page_size, sourceRecords]);

  if (!selectedView) return <section className="database-workbench"><p className="database-empty">尚未创建数据库视图。</p></section>;
  const configuredRecords = executeView(records, selectedView);
  const configuredProperties = visibleProperties(properties, selectedView);
  const changePage = (nextPage: number) => {
    if (nextPage < 1 || pageRequestPending) return;
    if (!exactPage && nextPage <= Math.ceil(configuredRecords.length / pageSize)) {
      setPage(nextPage);
      store.write(database.workspace_id, database.id, selectedView.id, { page: nextPage, pageSize, cursors: cursors.current });
      return;
    }
    const cached = cachedPages.current.get(nextPage);
    if (cached) {
      setRecords(cached.items); setNextCursor(cached.next_cursor); setExactPage(nextPage !== 1); setPage(nextPage);
      store.write(database.workspace_id, database.id, selectedView.id, { page: nextPage, pageSize, cursors: cursors.current });
      return;
    }
    const cursor = cursors.current[nextPage] ?? cachedPages.current.get(page)?.next_cursor;
    if (cursor === undefined || cursor === null || !requestPage) return;
    cursors.current[nextPage] = cursor;
    const requestId = ++activeRequest.current;
    setPageRequestPending(true);
    void requestPage({ cursor, limit: pageSize }).then((result) => {
      if (activeRequest.current !== requestId) return;
      cachedPages.current.set(nextPage, result);
      cursors.current[nextPage + 1] = result.next_cursor;
      setRecords(result.items); setNextCursor(result.next_cursor); setExactPage(true); setPage(nextPage);
      store.write(database.workspace_id, database.id, selectedView.id, { page: nextPage, pageSize, cursors: cursors.current });
    }).catch(() => undefined).finally(() => { if (activeRequest.current === requestId) setPageRequestPending(false); });
  };
  const changeView = (viewId: string) => { setSelectedViewId(viewId); setToolsOpen(false); };

  return <section className="database-workbench">
    <header className="database-workbench-header"><div><p className="eyebrow">STRUCTURED DATABASE</p><h1>{database.name}</h1><p>{database.description}</p></div>
      <DatabaseToolsDrawer open={toolsOpen} views={views} activeViewId={selectedView.id} databaseId={database.id} client={client} onOpenChange={setToolsOpen} onViewChange={changeView} onMutation={onMutation} />
    </header>
    <nav className="database-view-tabs" aria-label="数据库视图">{views.map((view) => <button className={view.id === selectedView.id ? "active" : ""} type="button" key={view.id} onClick={() => changeView(view.id)}>{view.name}</button>)}</nav>
    {selectedView.type === "table" ? <DatabaseTableView properties={configuredProperties} records={configuredRecords} page={page} pageSize={pageSize} exactPage={exactPage} onPageChange={changePage} hasNextPage={Boolean(nextCursor && requestPage) && !pageRequestPending} /> : null}
    {selectedView.type === "board" ? <DatabaseBoardView properties={properties} records={configuredRecords} view={selectedView} onRecordsChange={setRecords} onBoardMove={onBoardMove} /> : null}
    {selectedView.type === "calendar" ? <DatabaseCalendarView properties={properties} records={configuredRecords} view={selectedView} onRecordsChange={setRecords} onCalendarAssign={onCalendarAssign} /> : null}
  </section>;
}
