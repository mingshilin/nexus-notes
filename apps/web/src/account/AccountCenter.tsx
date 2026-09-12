import type { Profile } from "@nexus/contracts";
import { useEffect, useState } from "react";
import { ProfilePanel } from "./ProfilePanel";
import { SecurityPanel } from "./SecurityPanel";
import { WorkspacePanel } from "./WorkspacePanel";
import { DataPrivacyPanel } from "./DataPrivacyPanel";
import type { AccountCenterProps, AccountTab } from "./index";
import { AccountOverviewPanel } from "./AccountOverviewPanel";
import { PreferencesPanel } from "./PreferencesPanel";
import { AIActionHistoryPanel } from "../ai/AIActionHistoryPanel";
import { AITrustedModePanel } from "../ai/AITrustedModePanel";
import { useAccountCenterData } from "./use-account-center-data";

const tabs: Array<{ id: AccountTab; label: string }> = [
  { id: "overview", label: "总览" },
  { id: "profile", label: "个人资料" },
  { id: "security", label: "安全" },
  { id: "workspace", label: "工作区" },
  { id: "preferences", label: "偏好与通知" },
  { id: "privacy", label: "数据与隐私" },
  { id: "ai", label: "AI 控制" },
];

export function AccountCenter({ client, cacheScope, ai, collaboration, operations, workspaces, activeWorkspaceId, currentUserId, onWorkspaceChange, onCreateWorkspace, onPrepareDelete, onDeleteFailed, onDeleted, onProfileChange, initialTab = "profile" }: AccountCenterProps) {
  const resolvedCacheScope = cacheScope ?? `${currentUserId ?? "anonymous"}:${activeWorkspaceId ?? ""}`;
  const accountData = useAccountCenterData({ client: client as never, cacheScope: resolvedCacheScope });
  const [activeTab, setActiveTab] = useState<AccountTab>(initialTab);

  useEffect(() => setActiveTab(initialTab), [initialTab]);

  const handleProfileChange = (next: Profile) => {
    if (accountData.setProfile(next)) onProfileChange?.(next);
  };

  const refreshSessions = () => accountData.refreshSessions();
  const handleSessionRevoked = (sessionId: string) => {
    if (accountData.setSessions((current) => current.filter((session) => session.id !== sessionId))) accountData.refreshSessions();
  };
  const handleSessionRevokeFailed = () => {
    accountData.refreshSessions();
  };

  const moveTab = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const current = tabs.findIndex((tab) => tab.id === activeTab);
    if (!(event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End")) return;
    event.preventDefault();
    const index = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[index]!;
    setActiveTab(next.id);
    document.getElementById(`account-tab-${next.id}`)?.focus();
  };

  return (
    <section className="product-domain-page account-center-shell" aria-labelledby="account-center-heading">
      <p className="eyebrow">ACCOUNT CENTER</p>
      <h1 id="account-center-heading">账户中心</h1>
      <p className="product-domain-lead">管理个人资料、账户安全、工作区与数据隐私。</p>
      <div className="account-tabs" role="tablist" aria-label="账户中心">
        {tabs.map((tab) => <button key={tab.id} id={`account-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`account-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => setActiveTab(tab.id)} onKeyDown={moveTab}>{tab.label}</button>)}
      </div>
      <div className="account-panels">
        <div hidden={activeTab !== "overview"}><AccountOverviewPanel client={client} active={activeTab === "overview"} onOpenAiControls={() => setActiveTab("ai")} /></div>
        <div hidden={activeTab !== "profile"}><ProfilePanel key={`profile-${resolvedCacheScope}-${accountData.scopeVersion}`} client={client} profile={accountData.profile} loading={accountData.profileLoading} error={accountData.profileError} onRetry={accountData.retryProfile} onProfileChange={handleProfileChange} /></div>
        <div hidden={activeTab !== "security"}><SecurityPanel key={`security-${resolvedCacheScope}-${accountData.scopeVersion}`} active={activeTab === "security"} client={client} profile={accountData.profile} sessions={accountData.sessions} loading={accountData.sessionsLoading} error={accountData.sessionsError} onRetry={refreshSessions} onSessionsRefresh={refreshSessions} onSessionRevokeStart={accountData.invalidateSessions} onSessionRevokeFailed={handleSessionRevokeFailed} onSessionRevoked={handleSessionRevoked} onProfileChange={handleProfileChange} /></div>
        <div hidden={activeTab !== "workspace"}><WorkspacePanel workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} client={collaboration} currentUserId={currentUserId} onWorkspaceChange={onWorkspaceChange} onCreateWorkspace={onCreateWorkspace} /></div>
        <div hidden={activeTab !== "preferences"}><PreferencesPanel client={client} active={activeTab === "preferences"} /></div>
        <div hidden={activeTab !== "privacy"}><DataPrivacyPanel active={activeTab === "privacy"} client={client} operations={operations} activeWorkspaceId={activeWorkspaceId} onPrepareDelete={onPrepareDelete} onDeleteFailed={onDeleteFailed} onDeleted={onDeleted} /></div>
        <div hidden={activeTab !== "ai"}>
          <section id="account-panel-ai" role="tabpanel" aria-labelledby="account-tab-ai" className="account-panel">
            {!ai || !activeWorkspaceId || typeof ai.getAiTrustedMode !== "function" || typeof ai.updateAiTrustedMode !== "function" || typeof ai.listAiActionHistory !== "function" ? <p className="account-muted">当前服务版本或工作区暂不支持 AI 控制。</p> : <>
              <AITrustedModePanel client={ai} workspaceId={activeWorkspaceId} active={activeTab === "ai"} />
              <AIActionHistoryPanel client={ai} workspaceId={activeWorkspaceId} active={activeTab === "ai"} />
            </>}
          </section>
        </div>
      </div>
    </section>
  );
}
