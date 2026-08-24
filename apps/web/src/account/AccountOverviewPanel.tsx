import type { AccountOverview } from "@nexus/contracts";
import { useEffect, useState } from "react";
import type { ProfileClientLike } from "./index";

export function AccountOverviewPanel({ client, active }: { client: ProfileClientLike; active: boolean }) {
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !client.getOverview) return undefined;
    const controller = new AbortController();
    setError(null);
    void client.getOverview(controller.signal).then((value) => {
      if (!controller.signal.aborted) setOverview(value);
    }).catch(() => {
      if (!controller.signal.aborted) setError("账户总览加载失败，请重试。");
    });
    return () => controller.abort();
  }, [active, client]);

  return (
    <section id="account-panel-overview" role="tabpanel" aria-labelledby="account-tab-overview" className="account-panel">
      <div className="account-panel-heading"><div><p className="eyebrow">OVERVIEW</p><h2>总览</h2><p>快速查看账户完整度、用量、安全与最近活动。</p></div></div>
      {!client.getOverview ? <p className="account-muted">当前服务版本暂不支持账户总览。</p> : null}
      {!overview && !error && client.getOverview ? <p role="status">正在加载账户总览…</p> : null}
      {error ? <p role="alert" className="account-error">{error}</p> : null}
      {overview ? <>
        <div className="account-overview-grid">
          <article><strong>{overview.counts.notes} 条笔记</strong><span>{overview.counts.databases} 个数据库</span></article>
          <article><strong>{overview.counts.workspaces} 个工作区</strong><span>{overview.counts.sessions} 个有效会话</span></article>
          <article><strong>{overview.counts.upcoming_reminders} 条即将到期提醒</strong><span>{overview.profile_complete ? "资料已完善" : "资料待完善"}</span></article>
          <article><strong>{overview.ai_configured ? "AI 已配置" : "AI 未配置"}</strong><span>可在 AI 助手中管理个人 provider</span></article>
        </div>
        <section className="account-subpanel" aria-labelledby="recent-account-activity"><h3 id="recent-account-activity">最近安全活动</h3>
          {overview.recent_activity.length > 0 ? <ul className="account-activity-list">{overview.recent_activity.map((item) => <li key={item.id}><strong>{item.event}</strong><small>{new Date(item.created_at).toLocaleString("zh-CN")}</small></li>)}</ul> : <p className="account-muted">暂无活动记录。</p>}
        </section>
      </> : null}
    </section>
  );
}
