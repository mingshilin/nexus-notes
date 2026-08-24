import type { ReactNode } from "react";

import { AdaptiveWorkbench, type AdaptiveWorkbenchProps } from "../layout/AdaptiveWorkbench";
import type { ProductDomain } from "../navigation/ProductNavigation";

const domainLabels: Record<ProductDomain, string> = {
  notes: "笔记",
  databases: "数据库",
  knowledge: "知识整理",
  reminders: "提醒",
  collaboration: "协作",
  ai: "AI 助手",
  account: "账户中心",
};

export interface WorkspaceShellProps extends Omit<AdaptiveWorkbenchProps, "children"> {
  activeDomain: ProductDomain;
  requestedDomain: ProductDomain;
  domainPending: boolean;
  children: ReactNode;
}

export function WorkspaceShell({
  activeDomain,
  requestedDomain,
  domainPending,
  children,
  ...workbenchProps
}: WorkspaceShellProps) {
  const changingDomain = domainPending && requestedDomain !== activeDomain;
  return (
    <AdaptiveWorkbench {...workbenchProps}>
      <div
        className="workspace-domain-surface"
        data-domain={changingDomain ? requestedDomain : activeDomain}
        aria-busy={changingDomain || undefined}
      >
        {changingDomain ? (
          <section
            className="workspace-domain-loading-shell"
            role="status"
            aria-label={`正在打开${domainLabels[requestedDomain]}`}
          >
            <span className="workspace-domain-loading-mark" aria-hidden="true" />
            <p className="eyebrow">NEXUS NOTES</p>
            <h1>{domainLabels[requestedDomain]}</h1>
            <p>正在恢复最近内容…</p>
          </section>
        ) : children}
      </div>
    </AdaptiveWorkbench>
  );
}
