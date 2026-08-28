import { lazy, Suspense } from "react";
import type { BoardMoveInput, CalendarAssignmentInput, Database, DatabaseRecord } from "@nexus/contracts";

import type { CollaborationClient } from "../../data/collaboration-client";
import type { DatabaseBundle, DatabaseClient } from "../../data/database-client";
import type { RecordsPageRequest } from "../../databases/DatabaseWorkbench";
import { loadDatabaseWorkbench } from "../workspace-domain-loader";
import type { WorkspaceDomainProps } from "./NotesDomain";

const LazyDatabaseWorkbench = lazy(async () => {
  const module = await loadDatabaseWorkbench();
  return { default: module.DatabaseWorkbench };
});

export interface DatabaseDomainSelection {
  bundle: DatabaseBundle | null;
  databases: Database[];
  records: DatabaseRecord[];
  recordsNextCursor: string | null;
  loading: boolean;
  error: string | null;
  firstDatabaseName: string;
  creatingFirstDatabase: boolean;
}

export interface DatabaseDomainCallbacks {
  onFirstDatabaseNameChange(value: string): void;
  onCreateFirstDatabase(): void;
  onMutation(): void;
  onRecordsPageRequest: RecordsPageRequest;
  onBoardMove(input: BoardMoveInput): Promise<DatabaseRecord>;
  onCalendarAssign(input: CalendarAssignmentInput): Promise<DatabaseRecord>;
}

export interface DatabaseDomainClient {
  database: DatabaseClient;
  collaboration: CollaborationClient;
}

export type DatabaseDomainProps = WorkspaceDomainProps<DatabaseDomainClient, DatabaseDomainSelection, DatabaseDomainCallbacks>;

export function DatabaseDomain({ client, workspaceId, selectedEntity, callbacks }: DatabaseDomainProps) {
  const { bundle, databases, records, recordsNextCursor, loading, error, firstDatabaseName, creatingFirstDatabase } = selectedEntity;
  if (bundle && workspaceId) {
    return (
      <Suspense fallback={<p className="database-empty" role="status">正在准备数据库视图…</p>}>
        <LazyDatabaseWorkbench
          database={bundle.database}
          databases={databases}
          properties={bundle.properties}
          records={records}
          recordsNextCursor={recordsNextCursor}
          views={bundle.views}
          templates={bundle.templates}
          client={client.database}
          collaborationClient={client.collaboration}
          onMutation={callbacks.onMutation}
          onRecordsPageRequest={callbacks.onRecordsPageRequest}
          onBoardMove={callbacks.onBoardMove}
          onCalendarAssign={callbacks.onCalendarAssign}
        />
      </Suspense>
    );
  }

  return (
    <section className="database-workbench">
      {loading ? <p className="database-empty" role="status">正在加载数据库内容…</p> : null}
      {error ? <p className="database-operation-error" role="alert">{error}</p> : null}
      {!loading && !error && databases.length === 0 && workspaceId ? (
        <section className="database-first-create" aria-label="创建第一个数据库">
          <p className="eyebrow">STRUCTURED DATABASE</p>
          <h1>创建第一个数据库</h1>
          <p>从一个轻量的表格开始，之后可随时添加属性、视图和协作规则。</p>
          <label>数据库名称<input aria-label="数据库名称" value={firstDatabaseName} onChange={(event) => callbacks.onFirstDatabaseNameChange(event.target.value)} /></label>
          <button type="button" disabled={!firstDatabaseName.trim() || creatingFirstDatabase} onClick={callbacks.onCreateFirstDatabase}>{creatingFirstDatabase ? "创建中…" : "创建数据库"}</button>
        </section>
      ) : null}
      {!loading && !error && databases.length > 0 && !bundle ? <p className="database-empty">请选择数据库。</p> : null}
    </section>
  );
}
