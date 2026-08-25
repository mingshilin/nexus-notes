import type { PushSubscriptionSummary, UserPreferences } from "@nexus/contracts";
import { useEffect, useState } from "react";
import type { ProfileClientLike } from "./index";
import { enableBrowserPush } from "./push-subscription-controller";

export function PreferencesPanel({ client, active }: { client: ProfileClientLike; active: boolean }) {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [draft, setDraft] = useState<UserPreferences | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<PushSubscriptionSummary[]>([]);
  const [pushPending, setPushPending] = useState(false);

  useEffect(() => {
    if (!active || !client.getPreferences) return undefined;
    const controller = new AbortController();
    setError(null);
    void client.getPreferences(controller.signal).then((value) => {
      if (!controller.signal.aborted) { setPreferences(value); setDraft(value); }
    }).catch(() => {
      if (!controller.signal.aborted) setError("偏好设置加载失败，请重试。");
    });
    return () => controller.abort();
  }, [active, client]);

  useEffect(() => {
    if (!active || !client.listPushSubscriptions) return undefined;
    const controller = new AbortController();
    void client.listPushSubscriptions(controller.signal).then((items) => {
      if (!controller.signal.aborted) setSubscriptions(items);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [active, client]);

  const enablePush = () => {
    if (!client.getPushPublicKey || !client.subscribePush || pushPending) return;
    setPushPending(true);
    setError(null);
    void enableBrowserPush({
      getPushPublicKey: client.getPushPublicKey.bind(client),
      subscribePush: client.subscribePush.bind(client),
    }).then((subscription) => {
      setSubscriptions((current) => [subscription, ...current.filter((item) => item.id !== subscription.id)]);
      if (draft) setDraft({ ...draft, push_reminders: true });
      setMessage("Web Push 已连接。保存偏好后将接收提醒。");
    }).catch(() => setError("无法启用 Web Push，请检查浏览器权限后重试。"))
      .finally(() => setPushPending(false));
  };

  const save = () => {
    if (!draft || !client.updatePreferences || pending) return;
    const controller = new AbortController();
    setPending(true);
    setError(null);
    setMessage(null);
    void client.updatePreferences({
      base_revision: preferences?.revision ?? draft.revision,
      default_domain: draft.default_domain,
      density: draft.density,
      reduced_motion: draft.reduced_motion,
      week_starts_on: draft.week_starts_on,
      date_format: draft.date_format,
      default_snooze_minutes: draft.default_snooze_minutes,
      email_reminders: draft.email_reminders,
      push_reminders: draft.push_reminders,
      in_app_reminders: draft.in_app_reminders,
      quiet_hours: draft.quiet_hours,
      show_push_title: draft.show_push_title,
    }, controller.signal).then((value) => {
      setPreferences(value);
      setDraft(value);
      setMessage("偏好设置已保存。");
    }).catch(() => setError("偏好设置保存失败，当前选择仍保留。"))
      .finally(() => setPending(false));
  };

  return (
    <section id="account-panel-preferences" role="tabpanel" aria-labelledby="account-tab-preferences" className="account-panel">
      <div className="account-panel-heading"><div><p className="eyebrow">PREFERENCES</p><h2>偏好与通知</h2><p>设置默认入口、界面密度、日期习惯和提醒投递渠道。</p></div></div>
      {!client.getPreferences ? <p className="account-muted">当前服务版本暂不支持偏好设置。</p> : null}
      {!draft && !error && client.getPreferences ? <p role="status">正在加载偏好设置…</p> : null}
      {draft ? <form className="account-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <div className="account-form-grid">
          <label>默认首页<select aria-label="默认首页" value={draft.default_domain} onChange={(event) => setDraft({ ...draft, default_domain: event.target.value as UserPreferences["default_domain"] })}><option value="notes">笔记</option><option value="databases">数据库</option><option value="knowledge">知识中心</option><option value="reminders">提醒</option><option value="ai">AI 助手</option></select></label>
          <label>界面密度<select aria-label="界面密度" value={draft.density} onChange={(event) => setDraft({ ...draft, density: event.target.value as UserPreferences["density"] })}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
          <label>周起始日<select aria-label="周起始日" value={draft.week_starts_on} onChange={(event) => setDraft({ ...draft, week_starts_on: Number(event.target.value) as 0 | 1 })}><option value={1}>周一</option><option value={0}>周日</option></select></label>
          <label>日期格式<select aria-label="日期格式" value={draft.date_format} onChange={(event) => setDraft({ ...draft, date_format: event.target.value as UserPreferences["date_format"] })}><option value="yyyy-MM-dd">2026-08-25</option><option value="yyyy年M月d日">2026年8月25日</option><option value="MM/dd/yyyy">08/25/2026</option><option value="dd/MM/yyyy">25/08/2026</option></select></label>
          <label>默认稍后提醒<select aria-label="默认稍后提醒" value={draft.default_snooze_minutes} onChange={(event) => setDraft({ ...draft, default_snooze_minutes: Number(event.target.value) })}><option value={10}>10 分钟</option><option value={60}>1 小时</option><option value={1440}>1 天</option></select></label>
        </div>
        <label className="account-check"><input type="checkbox" checked={draft.reduced_motion} onChange={(event) => setDraft({ ...draft, reduced_motion: event.target.checked })} />减少动效</label>
        <section className="account-subpanel"><h3>通知渠道</h3>
          <label className="account-check"><input type="checkbox" checked={draft.in_app_reminders} onChange={(event) => setDraft({ ...draft, in_app_reminders: event.target.checked })} />站内提醒</label>
          <label className="account-check"><input type="checkbox" checked={draft.email_reminders} onChange={(event) => setDraft({ ...draft, email_reminders: event.target.checked })} />邮件提醒</label>
          <label className="account-check"><input type="checkbox" checked={draft.push_reminders} onChange={(event) => setDraft({ ...draft, push_reminders: event.target.checked })} />Web Push</label>
          <label className="account-check"><input type="checkbox" checked={draft.show_push_title} onChange={(event) => setDraft({ ...draft, show_push_title: event.target.checked })} />锁屏显示提醒标题</label>
          {client.getPushPublicKey && client.subscribePush ? <div className="account-actions"><button type="button" disabled={pushPending || typeof Notification === "undefined" || !("serviceWorker" in navigator)} onClick={enablePush}>{pushPending ? "正在连接…" : "启用 Web Push"}</button>{client.testPush && subscriptions.some((item) => item.status === "active") ? <button type="button" disabled={pushPending} onClick={() => { setPushPending(true); void client.testPush!().then(() => setMessage("测试通知已加入发送队列。"), () => setError("测试通知发送失败。" )).finally(() => setPushPending(false)); }}>发送测试通知</button> : null}</div> : null}
          {subscriptions.length > 0 ? <ul className="account-session-list" aria-label="Push 设备">{subscriptions.map((item) => <li key={item.id}><span>{item.device_name}</span><small>{item.status === "active" ? "已启用" : "已停用"}</small>{item.status === "active" && client.disablePushSubscription ? <button type="button" onClick={() => { void client.disablePushSubscription!(item.id).then(() => setSubscriptions((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "disabled" } : entry))); }}>停用</button> : null}</li>)}</ul> : null}
        </section>
        <button type="submit" disabled={pending}>{pending ? "正在保存…" : "保存偏好设置"}</button>
      </form> : null}
      {message ? <p role="status" className="account-status">{message}</p> : null}
      {error ? <p role="alert" className="account-error">{error}</p> : null}
    </section>
  );
}
