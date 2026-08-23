import { useEffect, useState, type FormEvent } from "react";
import type { Reminder } from "@nexus/contracts";
import { KnowledgeClient } from "../data/knowledge-client";

type ReminderClient = Pick<KnowledgeClient, "listReminders" | "createReminder" | "updateReminder">;

function statusLabel(status: Reminder["status"]) {
  return status === "pending" ? "待处理" : status === "sent" ? "已发送" : "已完成";
}

export function ReminderPanel({ client }: { client: ReminderClient }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [remindAt, setRemindAt] = useState("");
  const [noteId, setNoteId] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void client.listReminders(false, controller.signal).then((items) => {
      if (!controller.signal.aborted) setReminders(items);
    }).catch(() => {
      if (!controller.signal.aborted) setError("提醒暂时无法加载，请稍后重试。");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [client]);

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (!remindAt) {
      setError("请选择提醒时间。");
      return;
    }
    const parsed = new Date(remindAt);
    if (Number.isNaN(parsed.getTime())) {
      setError("提醒时间格式无效。");
      return;
    }
    setPending(true);
    setError(null);
    void client.createReminder({ note_id: noteId.trim() || null, remind_at: parsed.toISOString() }).then((reminder) => {
      setReminders((current) => [reminder, ...current]);
      setRemindAt("");
      setNoteId("");
      setFeedback("提醒已创建。");
    }).catch(() => setError("提醒创建失败，请重试。当前输入仍保留。")).finally(() => setPending(false));
  };

  const dismiss = (reminder: Reminder) => {
    setPending(true);
    setError(null);
    void client.updateReminder(reminder.id, { base_revision: reminder.revision, status: "dismissed" }).then((updated) => {
      setReminders((current) => current.map((item) => item.id === updated.id ? updated : item));
      setFeedback(`提醒 ${reminder.id} 已完成。`);
    }).catch(() => setError("提醒状态更新失败，请重试。当前提醒仍保留。")).finally(() => setPending(false));
  };

  return (
    <section className="product-domain-page reminder-page" aria-labelledby="reminder-heading">
      <p className="eyebrow">REMINDERS</p>
      <h1 id="reminder-heading">提醒中心</h1>
      <p className="product-domain-lead">把需要跟进的事项放到明确的时间点，并保留可恢复的状态。</p>
      <form className="reminder-create-form" onSubmit={create}>
        <label>提醒时间<input aria-label="提醒时间" type="datetime-local" value={remindAt} onChange={(event) => setRemindAt(event.target.value)} /></label>
        <label>关联笔记 ID<input aria-label="关联笔记 ID" value={noteId} onChange={(event) => setNoteId(event.target.value)} placeholder="可选" /></label>
        <button type="submit" disabled={pending}>{pending ? "处理中…" : "创建提醒"}</button>
      </form>
      {error ? <p className="reminder-error" role="alert">{error}</p> : null}
      {feedback ? <p className="reminder-feedback" aria-live="polite">{feedback}</p> : null}
      {loading ? <p className="reminder-state" role="status">正在加载提醒…</p> : null}
      {!loading && reminders.length === 0 ? <p className="reminder-state">暂无提醒。</p> : null}
      <ul className="reminder-list" aria-label="提醒列表">
        {reminders.map((reminder) => <li key={reminder.id} aria-label={reminder.id}>
          <div><strong>{reminder.remind_at}</strong><small>{reminder.note_id ? `关联笔记：${reminder.note_id}` : "未关联笔记"} · {statusLabel(reminder.status)}</small></div>
          {reminder.status === "pending" ? <button type="button" disabled={pending} aria-label={`完成 ${reminder.id}`} onClick={() => dismiss(reminder)}>完成</button> : null}
        </li>)}
      </ul>
    </section>
  );
}
