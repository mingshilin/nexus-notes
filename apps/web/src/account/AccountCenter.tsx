import type { AccountSession, Profile } from "@nexus/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProfilePanel } from "./ProfilePanel";
import { SecurityPanel } from "./SecurityPanel";
import type { AccountCenterProps, AccountTab } from "./index";

const tabs: Array<{ id: AccountTab; label: string }> = [
  { id: "profile", label: "个人资料" },
  { id: "security", label: "安全" },
  { id: "workspace", label: "工作区" },
  { id: "privacy", label: "数据与隐私" },
];

function isAbort(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

export function AccountCenter({ client, workspaces, activeWorkspaceId, onWorkspaceChange, onDeleted, onProfileChange, initialTab = "profile" }: AccountCenterProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileRetry, setProfileRetry] = useState(0);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const sessionsVersionRef = useRef(0);
  const sessionsControllerRef = useRef<AbortController | null>(null);
  const [activeTab, setActiveTab] = useState<AccountTab>(initialTab);

  useEffect(() => setActiveTab(initialTab), [initialTab]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setProfileLoading(true);
    setProfileError(null);
    void client.getProfile(controller.signal).then((next) => {
      if (!active || controller.signal.aborted) return;
      setProfile(next);
    }).catch((error: unknown) => {
      if (active && !isAbort(error, controller.signal)) setProfileError("个人资料加载失败，请重试。");
    }).finally(() => {
      if (active && !controller.signal.aborted) setProfileLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [client, profileRetry]);

  const invalidateSessions = useCallback(() => {
    sessionsVersionRef.current += 1;
    sessionsControllerRef.current?.abort();
    sessionsControllerRef.current = null;
  }, []);

  const loadSessions = useCallback(() => {
    invalidateSessions();
    const version = sessionsVersionRef.current;
    const controller = new AbortController();
    sessionsControllerRef.current = controller;
    setSessionsLoading(true);
    setSessionsError(null);
    void Promise.resolve().then(() => client.listSessions(controller.signal)).then((next) => {
      if (version !== sessionsVersionRef.current || controller.signal.aborted) return;
      setSessions(next);
    }).catch((error: unknown) => {
      if (version === sessionsVersionRef.current && !isAbort(error, controller.signal)) setSessionsError("会话加载失败，请重试。");
    }).finally(() => {
      if (version === sessionsVersionRef.current && !controller.signal.aborted) setSessionsLoading(false);
    });
  }, [client, invalidateSessions]);

  useEffect(() => {
    loadSessions();
    return invalidateSessions;
  }, [loadSessions, invalidateSessions]);

  const handleProfileChange = (next: Profile) => {
    setProfile(next);
    setProfileError(null);
    onProfileChange?.(next);
  };

  const refreshSessions = () => loadSessions();
  const handleSessionRevoked = (sessionId: string) => {
    setSessions((current) => current.filter((session) => session.id !== sessionId));
    loadSessions();
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
      <p className="product-domain-lead">管理个人资料和账户安全。工作区与数据设置将在后续阶段提供。</p>
      <div className="account-tabs" role="tablist" aria-label="账户中心">
        {tabs.map((tab) => <button key={tab.id} id={`account-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`account-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => setActiveTab(tab.id)} onKeyDown={moveTab}>{tab.label}</button>)}
      </div>
      <div className="account-panels">
        <div hidden={activeTab !== "profile"}><ProfilePanel client={client} profile={profile} loading={profileLoading} error={profileError} onRetry={() => setProfileRetry((retry) => retry + 1)} onProfileChange={handleProfileChange} /></div>
        <div hidden={activeTab !== "security"}><SecurityPanel client={client} profile={profile} sessions={sessions} loading={sessionsLoading} error={sessionsError} onRetry={refreshSessions} onSessionsRefresh={refreshSessions} onSessionRevokeStart={invalidateSessions} onSessionRevoked={handleSessionRevoked} onProfileChange={handleProfileChange} /></div>
        <section id="account-panel-workspace" role="tabpanel" aria-labelledby="account-tab-workspace" className="account-panel" hidden={activeTab !== "workspace"}><p className="eyebrow">WORKSPACE</p><h2>工作区</h2><p>工作区成员、权限和切换设置将在后续任务中提供。</p><p className="account-center-slot">工作区设置将在后续任务中提供。</p><span className="sr-only">当前工作区：{workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.name ?? "未选择"}</span></section>
        <section id="account-panel-privacy" role="tabpanel" aria-labelledby="account-tab-privacy" className="account-panel" hidden={activeTab !== "privacy"}><p className="eyebrow">DATA & PRIVACY</p><h2>数据与隐私</h2><p>数据导出、删除和隐私设置将在后续任务中提供。</p><p className="account-center-slot">数据与隐私设置将在后续任务中提供。</p></section>
      </div>
    </section>
  );
}
