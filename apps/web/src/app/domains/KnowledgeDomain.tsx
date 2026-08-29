import { lazy, Suspense, useState, type ReactNode } from "react";
import type { WorkspaceRoleContract } from "@nexus/contracts";

import type { KnowledgeClient } from "../../data/knowledge-client";
import type { DatabaseClient } from "../../data/database-client";
import type { CollaborationClient } from "../../data/collaboration-client";
import { loadExternalCalendarPanel, loadKnowledgeCalendarPanel, loadKnowledgeGraphPanel, loadKnowledgeSearchPanel } from "../workspace-domain-loader";
import type { WorkspaceDomainProps } from "./NotesDomain";

const LazyKnowledgeSearchPanel = lazy(async () => {
  const module = await loadKnowledgeSearchPanel();
  return { default: module.KnowledgeSearchPanel };
});
const LazyKnowledgeGraphPanel = lazy(async () => {
  const module = await loadKnowledgeGraphPanel();
  return { default: module.KnowledgeGraphPanel };
});
const LazyKnowledgeCalendarPanel = lazy(async () => {
  const module = await loadKnowledgeCalendarPanel();
  return { default: module.KnowledgeCalendarPanel };
});
const LazyExternalCalendarPanel = lazy(async () => {
  const module = await loadExternalCalendarPanel();
  return { default: module.ExternalCalendarPanel };
});

export interface KnowledgeDomainSelection {
  recoveryContent: ReactNode;
}

export type KnowledgeDomainClient = KnowledgeClient | {
  knowledge: KnowledgeClient;
  databases?: Pick<DatabaseClient, "listDatabases">;
  collaboration?: Pick<CollaborationClient, "listMembers">;
};
export type KnowledgeDomainProps = WorkspaceDomainProps<KnowledgeDomainClient, KnowledgeDomainSelection, Record<string, never>>;

function KnowledgeToolDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="knowledge-tool-disclosure" aria-label={label}>
      <button
        type="button"
        className="knowledge-tool-disclosure-trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? `收起${label}` : `展开${label}`}
      </button>
      {open ? children : null}
    </section>
  );
}

function KnowledgeToolFallback({ label }: { label: string }) {
  return <p className="knowledge-search-state" role="status" aria-label={`正在加载${label}`}>正在加载{label}…</p>;
}

export function KnowledgeDomain({ client, selectedEntity }: KnowledgeDomainProps) {
  const knowledge = "knowledge" in client ? client.knowledge : client;
  const databases = "knowledge" in client ? client.databases : undefined;
  const collaboration = "knowledge" in client ? client.collaboration : undefined;
  const externalCalendar = "listCalendarConnections" in knowledge
    && "startCalendarConnection" in knowledge
    && "listCalendarEvents" in knowledge
    && "syncCalendarConnection" in knowledge
    && "disconnectCalendarConnection" in knowledge;
  return (
    <section className="product-domain-page knowledge-domain-page">
      <p className="eyebrow">KNOWLEDGE CENTER</p>
      <h1>知识恢复</h1>
      <p className="product-domain-lead">搜索、保存查询，并集中处理附件 OCR 状态与知识诊断。</p>
      <Suspense fallback={<KnowledgeToolFallback label="知识搜索" />}>
        <LazyKnowledgeSearchPanel client={knowledge} databasesClient={databases} collaborationClient={collaboration} />
      </Suspense>
      <KnowledgeToolDisclosure label="知识图谱">
        <Suspense fallback={<KnowledgeToolFallback label="知识图谱" />}>
          <LazyKnowledgeGraphPanel client={knowledge} />
        </Suspense>
      </KnowledgeToolDisclosure>
      <KnowledgeToolDisclosure label="知识日历">
        <Suspense fallback={<KnowledgeToolFallback label="知识日历" />}>
          <LazyKnowledgeCalendarPanel client={knowledge} />
        </Suspense>
      </KnowledgeToolDisclosure>
      {externalCalendar ? <KnowledgeToolDisclosure label="外部日历"><Suspense fallback={<KnowledgeToolFallback label="外部日历" />}><LazyExternalCalendarPanel client={knowledge} /></Suspense></KnowledgeToolDisclosure> : null}
      {selectedEntity.recoveryContent}
    </section>
  );
}
