import type {
  BoardMoveInput,
  CalendarAssignmentInput,
  Database,
  DatabaseProperty,
  DatabaseRecord,
  DatabaseView,
} from "@nexus/contracts";
import { useEffect, useState } from "react";

import { DatabasePaginationStore } from "../data/database-state";
import { DatabaseBoardView } from "./DatabaseBoardView";
import { DatabaseCalendarView } from "./DatabaseCalendarView";
import { DatabaseTableView } from "./DatabaseTableView";
import { DatabaseToolsDrawer } from "./DatabaseToolsDrawer";

const memoryStorage = {
  getItem: () => null,
  setItem: () => undefined,
};

export interface DatabaseWorkbenchProps {
  database: Database;
  properties: DatabaseProperty[];
  records: DatabaseRecord[];
  recordsNextCursor?: string | null;
  views: DatabaseView[];
  activeViewId?: string;
  paginationStore?: DatabasePaginationStore;
  onBoardMove?(input: BoardMoveInput): Promise<DatabaseRecord>;
  onCalendarAssign?(input: CalendarAssignmentInput): Promise<DatabaseRecord>;
  onTablePageRequest?(cursor: string | null): Promise<{ items: DatabaseRecord[]; next_cursor: string | null }>;
}

export function DatabaseWorkbench({
  database,
  properties,
  records: sourceRecords,
  recordsNextCursor = null,
  views,
  activeViewId,
  paginationStore,
  onBoardMove,
  onCalendarAssign,
  onTablePageRequest,
}: DatabaseWorkbenchProps) {
  const [records, setRecords] = useState(sourceRecords);
  const [nextCursor, setNextCursor] = useState<string | null>(recordsNextCursor);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [pageRequestPending, setPageRequestPending] = useState(false);
  const [selectedViewId, setSelectedViewId] = useState(activeViewId ?? views[0]?.id ?? "");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [store] = useState(() => paginationStore ?? new DatabasePaginationStore(
    typeof window === "undefined" ? memoryStorage : window.localStorage,
  ));
  const selectedView = views.find((view) => view.id === selectedViewId) ?? views[0];
  const persisted = selectedView ? store.read(database.workspace_id, database.id, selectedView.id) : null;
  const [page, setPage] = useState(persisted?.page ?? 1);

  useEffect(() => {
    setRecords(sourceRecords);
  }, [sourceRecords]);
  useEffect(() => {
    setNextCursor(recordsNextCursor);
  }, [database.id, recordsNextCursor]);
  useEffect(() => {
    if (activeViewId) setSelectedViewId(activeViewId);
  }, [activeViewId]);
  useEffect(() => {
    if (!selectedView) return;
    const state = store.read(database.workspace_id, database.id, selectedView.id);
    setPage(state?.page ?? 1);
    setCurrentCursor(state?.cursor ?? null);
    if (state?.cursor && onTablePageRequest) {
      setPageRequestPending(true);
      void onTablePageRequest(state.cursor).then((result) => {
        setRecords((current) => [...current, ...result.items]);
        setNextCursor(result.next_cursor);
      }).catch(() => undefined).finally(() => setPageRequestPending(false));
    }
  }, [database.id, database.workspace_id, onTablePageRequest, selectedView?.id, store]);

  if (!selectedView) return <section className="database-workbench"><p className="database-empty">尚未创建数据库视图。</p></section>;
  const pageSize = selectedView.config.page_size;
  const changePage = (nextPage: number) => {
    if (selectedView.type === "table" && nextPage > page && nextCursor && onTablePageRequest) {
      const requestCursor = nextCursor;
      setPageRequestPending(true);
      void onTablePageRequest(requestCursor).then((result) => {
        setRecords((current) => [...current, ...result.items]);
        setNextCursor(result.next_cursor);
        setCurrentCursor(requestCursor);
        setPage(nextPage);
        store.write(database.workspace_id, database.id, selectedView.id, { page: nextPage, pageSize, cursor: requestCursor });
      }).catch(() => undefined).finally(() => setPageRequestPending(false));
      return;
    }
    setPage(nextPage);
    store.write(database.workspace_id, database.id, selectedView.id, { page: nextPage, pageSize, cursor: currentCursor });
  };
  const changeView = (viewId: string) => {
    setSelectedViewId(viewId);
    setToolsOpen(false);
  };

  return (
    <section className="database-workbench">
      <header className="database-workbench-header">
        <div><p className="eyebrow">STRUCTURED DATABASE</p><h1>{database.name}</h1><p>{database.description}</p></div>
        <DatabaseToolsDrawer open={toolsOpen} views={views} activeViewId={selectedView.id} onOpenChange={setToolsOpen} onViewChange={changeView} />
      </header>
      <nav className="database-view-tabs" aria-label="数据库视图">
        {views.map((view) => <button className={view.id === selectedView.id ? "active" : ""} type="button" key={view.id} onClick={() => changeView(view.id)}>{view.name}</button>)}
      </nav>
      {selectedView.type === "table" ? (
        <DatabaseTableView properties={properties} records={records} page={page} pageSize={pageSize} onPageChange={changePage}
          hasNextPage={Boolean(nextCursor && onTablePageRequest) && !pageRequestPending} />
      ) : selectedView.type === "board" ? (
        <DatabaseBoardView properties={properties} records={records} view={selectedView} onRecordsChange={setRecords} onBoardMove={onBoardMove} />
      ) : (
        <DatabaseCalendarView properties={properties} records={records} view={selectedView} onRecordsChange={setRecords} onCalendarAssign={onCalendarAssign} />
      )}
    </section>
  );
}
