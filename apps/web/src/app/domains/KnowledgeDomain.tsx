import type { ReactNode } from "react";
import { lazy, Suspense } from "react";
import type { WorkspaceRoleContract } from "@nexus/contracts";

import type { KnowledgeClient } from "../../data/knowledge-client";
import { loadKnowledgeCalendarPanel, loadKnowledgeGraphPanel, loadKnowledgeSearchPanel } from "../workspace-domain-loader";
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

export interface KnowledgeDomainSelection {
  recoveryContent: ReactNode;
}

export type KnowledgeDomainProps = WorkspaceDomainProps<KnowledgeClient, KnowledgeDomainSelection, Record<string, never>>;

export function KnowledgeDomain({ client, selectedEntity }: KnowledgeDomainProps) {
  return (
    <section className="product-domain-page knowledge-domain-page">
      <p className="eyebrow">KNOWLEDGE CENTER</p>
      <h1>知识恢复</h1>
      <p className="product-domain-lead">搜索、保存查询，并集中处理附件 OCR 状态与知识诊断。</p>
      <Suspense fallback={<p className="knowledge-search-state" role="status">正在加载知识工具…</p>}>
        <LazyKnowledgeSearchPanel client={client} />
        <LazyKnowledgeGraphPanel client={client} />
        <LazyKnowledgeCalendarPanel client={client} />
      </Suspense>
      {selectedEntity.recoveryContent}
    </section>
  );
}
