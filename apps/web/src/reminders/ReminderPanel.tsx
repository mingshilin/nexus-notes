import { useEffect, useState, type FormEvent } from "react";
import type {
  CreateReminderInput,
  Note,
  RecurrenceEnd,
  Reminder,
  ReminderDelivery,
  ReminderChannel,
  ReminderListQuery,
  ReminderRecurrence,
  UpdateReminderInput,
} from "@nexus/contracts";

import type { KnowledgeClient } from "../data/knowledge-client";
import type { NotesClient } from "../data/notes-client";
import { useReminderWorkspaceData, type ReminderWorkspaceClient } from "./use-reminder-workspace-data";

type ReminderClient = Pick<KnowledgeClient, "createReminder" | "updateReminder" | "snoozeReminder" | "deleteReminder"> & ReminderWorkspaceClient;
type NoteLookupClient = Pick<NotesClient, "list">;
type RepeatMode = "none" | ReminderRecurrence["frequency"];
type EndMode = RecurrenceEnd["type"];
type ReminderGroup = "overdue" | "today" | "upcoming" | "completed";

const weekdays = [
  ["MO", "周一"], ["TU", "周二"], ["WE", "周三"], ["TH", "周四"],
  ["FR", "周五"], ["SA", "周六"], ["SU", "周日"],
] as const;
const groupLabels: Record<ReminderGroup, string> = {
  overdue: "逾期",
  today: "今天",
  upcoming: "未来",
  completed: "已完成",
};

function localDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ];
  return `${parts.join("-")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function sameLocalDate(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function reminderGroup(reminder: Reminder, now: Date): ReminderGroup {
  if (reminder.status !== "pending") return "completed";
  const effectiveAt = new Date(reminder.snoozed_until ?? reminder.remind_at);
  if (effectiveAt.getTime() < now.getTime()) return "overdue";
  return sameLocalDate(effectiveAt, now) ? "today" : "upcoming";
}

function statusLabel(status: Reminder["status"]) {
  return status === "pending" ? "待处理" : status === "sent" ? "已发送" : "已完成";
}

function defaultTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function deliveryChannelLabel(channel: ReminderDelivery["channel"]) {
  return channel === "in_app" ? "站内" : channel === "email" ? "Email" : "Push";
}

function deliveryStatusLabel(status: ReminderDelivery["status"]) {
  return status === "queued" ? "已排队" : status === "sent" ? "已发送" : status === "failed" ? "失败" : "已取消";
}

export function ReminderPanel({
  client,
  notesClient,
  now = () => new Date(),
  defaultTimezone: preferredTimezone = defaultTimezone(),
}: {
  client: ReminderClient;
  notesClient?: NoteLookupClient;
  now?: () => Date;
  defaultTimezone?: string;
}) {
  const {
    reminders,
    setReminders,
    nextCursor,
    search,
    setSearch,
    debouncedSearch,
    statusFilter,
    setStatusFilter,
    selectedIds,
    setSelectedIds,
    loading,
    refreshing,
    error,
    setError,
    feedback,
    setFeedback,
    failedBulkIds,
    setFailedBulkIds,
    retryRequest,
    setRetryRequest,
    loadMore,
    deliveryOpenId,
    deliveryItems,
    deliveryLoadingId,
    deliveryErrors,
    deliveryRetryId,
    toggleDeliveryStatus,
    retryDelivery,
  } = useReminderWorkspaceData({ client });
  const [pending, setPending] = useState(false);

  const [editing, setEditing] = useState<Reminder | null>(null);
  const [title, setTitle] = useState("");
  const [remindAt, setRemindAt] = useState("");
  const [timezone, setTimezone] = useState(preferredTimezone);
  const [channels, setChannels] = useState<ReminderChannel[]>(["in_app"]);
  const [deliveryEnabled, setDeliveryEnabled] = useState(true);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("none");
  const [repeatInterval, setRepeatInterval] = useState(1);
  const [weekdaysSelected, setWeekdaysSelected] = useState<string[]>([]);
  const [monthDay, setMonthDay] = useState<string>("last");
  const [endMode, setEndMode] = useState<EndMode>("never");
  const [endDate, setEndDate] = useState("");
  const [endCount, setEndCount] = useState(2);
  const [noteQuery, setNoteQuery] = useState("");
  const [noteOptions, setNoteOptions] = useState<Note[]>([]);
  const [noteId, setNoteId] = useState("");
  const [notesLoading, setNotesLoading] = useState(false);

  useEffect(() => {
    if (!notesClient) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setNotesLoading(true);
      void notesClient.list({ query: noteQuery.trim() || undefined, status: "active", limit: 25, signal: controller.signal }).then((page) => {
        if (!controller.signal.aborted) setNoteOptions(page.items);
      }).catch(() => {
        if (!controller.signal.aborted) setNoteOptions([]);
      }).finally(() => {
        if (!controller.signal.aborted) setNotesLoading(false);
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [noteQuery, notesClient]);

  const recurrenceEnd = (): RecurrenceEnd => {
    if (endMode === "until") return { type: "until", date: endDate };
    if (endMode === "count") return { type: "count", count: endCount };
    return { type: "never" };
  };

  const recurrence = (): ReminderRecurrence | null => {
    const ends = recurrenceEnd();
    if (repeatMode === "daily") return { frequency: "daily", interval: repeatInterval, ends };
    if (repeatMode === "weekly") return { frequency: "weekly", interval: repeatInterval, weekdays: weekdaysSelected as Array<typeof weekdays[number][0]>, ends };
    if (repeatMode === "monthly") return {
      frequency: "monthly", interval: repeatInterval,
      month_day: monthDay === "last" ? "last" : Number(monthDay), ends,
    };
    return null;
  };

  const resetForm = () => {
    setEditing(null);
    setTitle("");
    setRemindAt("");
    setTimezone(preferredTimezone);
    setChannels(["in_app"]);
    setDeliveryEnabled(true);
    setRepeatMode("none");
    setRepeatInterval(1);
    setWeekdaysSelected([]);
    setMonthDay("last");
    setEndMode("never");
    setEndDate("");
    setEndCount(2);
    setNoteQuery("");
    setNoteId("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError("请输入提醒标题。");
      return;
    }
    const parsed = new Date(remindAt);
    if (!remindAt || Number.isNaN(parsed.getTime())) {
      setError("请选择有效的提醒时间。");
      return;
    }
    if (channels.length === 0) {
      setError("至少选择一个投递渠道。");
      return;
    }
    if (repeatMode === "weekly" && weekdaysSelected.length === 0) {
      setError("每周重复至少选择一天。");
      return;
    }
    if (endMode === "until" && !endDate) {
      setError("请选择重复结束日期。");
      return;
    }
    const input: CreateReminderInput = {
      title: title.trim(),
      note_id: noteId || null,
      remind_at: parsed.toISOString(),
      timezone,
      channels,
      recurrence: recurrence(),
      delivery_enabled: deliveryEnabled,
    };
    setPending(true);
    setError(null);
    const request = editing
      ? client.updateReminder(editing.id, { ...input, base_revision: editing.revision } satisfies UpdateReminderInput)
      : client.createReminder(input);
    void request.then((saved) => {
      setReminders((current) => editing
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [saved, ...current]);
      setFeedback(editing ? "提醒已更新。" : "提醒已创建。");
      resetForm();
    }).catch(() => setError(editing ? "提醒更新失败，当前输入仍保留。" : "提醒创建失败，当前输入仍保留。"))
      .finally(() => setPending(false));
  };

  const beginEdit = (reminder: Reminder) => {
    setEditing(reminder);
    setTitle(reminder.title || "未命名提醒");
    setRemindAt(localDateTime(reminder.remind_at));
    setTimezone(reminder.timezone || preferredTimezone);
    setChannels([...reminder.channels]);
    setDeliveryEnabled(reminder.delivery_enabled_at !== null);
    setNoteId(reminder.note_id ?? "");
    setRepeatMode(reminder.recurrence?.frequency ?? "none");
    setRepeatInterval(reminder.recurrence?.interval ?? 1);
    setWeekdaysSelected(reminder.recurrence?.frequency === "weekly" ? [...reminder.recurrence.weekdays] : []);
    setMonthDay(reminder.recurrence?.frequency === "monthly" ? String(reminder.recurrence.month_day) : "last");
    setEndMode(reminder.recurrence?.ends.type ?? "never");
    setEndDate(reminder.recurrence?.ends.type === "until" ? reminder.recurrence.ends.date : "");
    setEndCount(reminder.recurrence?.ends.type === "count" ? reminder.recurrence.ends.count : 2);
    setError(null);
    setFeedback(null);
  };

  const updateOne = (reminder: Reminder, input: UpdateReminderInput, success: string) => {
    setPending(true);
    setError(null);
    return client.updateReminder(reminder.id, input).then((updated) => {
      setReminders((current) => current.map((item) => item.id === updated.id ? updated : item));
      setFeedback(success);
      setRetryRequest(null);
      return updated;
    }).catch(() => {
      setError("提醒状态更新失败，当前提醒仍保留。");
      setRetryRequest({ reminder, input, success });
      return undefined;
    }).finally(() => setPending(false));
  };

  const completeReminderBatch = (ids: readonly string[]) => {
    const selected = reminders.filter((reminder) => ids.includes(reminder.id) && reminder.status === "pending");
    if (selected.length === 0) return;
    setPending(true);
    setError(null);
    setFeedback(null);
    void Promise.allSettled(selected.map((reminder) => client.updateReminder(reminder.id, {
      base_revision: reminder.revision,
      status: "dismissed",
    }))).then((settled) => {
      const updated = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const failedIds = settled.flatMap((result, index) => result.status === "rejected" ? [selected[index]!.id] : []);
      const byId = new Map(updated.map((item) => [item.id, item]));
      setReminders((current) => current.map((item) => byId.get(item.id) ?? item));
      setSelectedIds(new Set(failedIds));
      setFailedBulkIds(failedIds);
      if (failedIds.length) setError(`${updated.length} 条完成，${failedIds.length} 条未完成；成功结果已保留，可重试失败项。`);
      else setFeedback(`已完成 ${updated.length} 条提醒。重复提醒系列已结束。`);
    })
      .finally(() => setPending(false));
  };

  const completeSelected = () => completeReminderBatch([...selectedIds]);

  const snooze = (reminder: Reminder, minutes: 10 | 60 | 1440) => {
    setPending(true);
    setError(null);
    void client.snoozeReminder(reminder.id, { base_revision: reminder.revision, minutes }).then((updated) => {
      setReminders((current) => current.map((item) => item.id === updated.id ? updated : item));
      setFeedback("已稍后提醒；重复规则锚点保持不变。");
    }).catch(() => setError("稍后提醒失败，原提醒时间未改变。"))
      .finally(() => setPending(false));
  };

  const remove = (reminder: Reminder) => {
    setPending(true);
    setError(null);
    void client.deleteReminder(reminder.id, { base_revision: reminder.revision }).then(() => {
      setReminders((current) => current.filter((item) => item.id !== reminder.id));
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(reminder.id);
        return next;
      });
      setFeedback("提醒已删除。");
    }).catch(() => setError("提醒删除失败，当前提醒仍保留。"))
      .finally(() => setPending(false));
  };

  const grouped = reminders.reduce<Record<ReminderGroup, Reminder[]>>((result, reminder) => {
    result[reminderGroup(reminder, now())].push(reminder);
    return result;
  }, { overdue: [], today: [], upcoming: [], completed: [] });

  return (
    <section className="product-domain-page reminder-page" aria-labelledby="reminder-heading">
      <div className="reminder-page-heading">
        <div><p className="eyebrow">REMINDERS</p><h1 id="reminder-heading">提醒中心</h1></div>
        <p className="product-domain-lead">按本地时间安排事项，并通过站内、邮件或 Web Push 投递。</p>
      </div>

      <form className="reminder-create-form reminder-editor" onSubmit={submit}>
        <div className="reminder-editor-title"><h2>{editing ? "编辑提醒" : "新建提醒"}</h2>{editing ? <button type="button" onClick={resetForm}>取消编辑</button> : null}</div>
        <label>提醒标题<input aria-label="提醒标题" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <div className="reminder-form-grid">
          <label>提醒时间<input aria-label="提醒时间" type="datetime-local" value={remindAt} onChange={(event) => setRemindAt(event.target.value)} /></label>
          <label>时区<input aria-label="提醒时区" maxLength={64} value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label>
        </div>
        {notesClient ? <div className="reminder-note-picker">
          <label>搜索关联笔记<input role="searchbox" aria-label="搜索关联笔记" value={noteQuery} onChange={(event) => setNoteQuery(event.target.value)} /></label>
          <label>关联笔记<select aria-label="关联笔记" value={noteId} onChange={(event) => setNoteId(event.target.value)}>
            <option value="">不关联笔记</option>
            {noteOptions.map((note) => <option key={note.id} value={note.id}>{note.title.trim() || "未命名笔记"}</option>)}
          </select></label>
          {notesLoading ? <small role="status">正在搜索笔记…</small> : null}
        </div> : null}
        <fieldset className="reminder-channel-options"><legend>投递渠道</legend>
          {(["in_app", "email", "push"] as const).map((channel) => <label key={channel}>
            <input type="checkbox" checked={channels.includes(channel)} onChange={() => setChannels((current) => current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel])} />
            {channel === "in_app" ? "站内" : channel === "email" ? "Email" : "Push"}
          </label>)}
          <label><input type="checkbox" checked={deliveryEnabled} onChange={(event) => setDeliveryEnabled(event.target.checked)} />启用投递</label>
        </fieldset>
        <div className="reminder-repeat-grid">
          <label>重复规则<select aria-label="重复规则" value={repeatMode} onChange={(event) => setRepeatMode(event.target.value as RepeatMode)}>
            <option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option>
          </select></label>
          {repeatMode !== "none" ? <label>重复间隔<input aria-label="重复间隔" type="number" min={1} max={repeatMode === "daily" ? 30 : 12} value={repeatInterval} onChange={(event) => setRepeatInterval(Math.max(1, Number(event.target.value) || 1))} /></label> : null}
          {repeatMode === "monthly" ? <label>每月日期<select aria-label="每月日期" value={monthDay} onChange={(event) => setMonthDay(event.target.value)}><option value="last">月末</option>{Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 日</option>)}</select></label> : null}
          {repeatMode !== "none" ? <label>结束方式<select aria-label="结束方式" value={endMode} onChange={(event) => setEndMode(event.target.value as EndMode)}><option value="never">永不</option><option value="until">指定日期</option><option value="count">指定次数</option></select></label> : null}
          {repeatMode !== "none" && endMode === "until" ? <label>结束日期<input aria-label="结束日期" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label> : null}
          {repeatMode !== "none" && endMode === "count" ? <label>重复次数<input aria-label="重复次数" type="number" min={2} max={999} value={endCount} onChange={(event) => setEndCount(Math.max(2, Number(event.target.value) || 2))} /></label> : null}
        </div>
        {repeatMode === "weekly" ? <fieldset className="reminder-weekdays"><legend>重复星期</legend>{weekdays.map(([value, label]) => <label key={value}><input type="checkbox" checked={weekdaysSelected.includes(value)} onChange={() => setWeekdaysSelected((current) => current.includes(value) ? current.filter((day) => day !== value) : [...current, value])} />{label}</label>)}</fieldset> : null}
        <button type="submit" disabled={pending}>{pending ? "处理中…" : editing ? "保存提醒" : "创建提醒"}</button>
      </form>

      <div className="reminder-toolbar">
        <label>搜索提醒<input role="searchbox" aria-label="搜索提醒" maxLength={160} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>状态筛选<select aria-label="状态筛选" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ReminderListQuery["status"])}>
          <option value="all">全部</option><option value="pending">待处理</option><option value="overdue">逾期</option><option value="today">今天</option><option value="upcoming">未来</option><option value="completed">已完成</option>
        </select></label>
        <button type="button" disabled={pending || selectedIds.size === 0} onClick={completeSelected}>完成所选</button>
      </div>
      {error ? <div className="reminder-error-row"><p className="reminder-error" role="alert">{error}</p>{failedBulkIds.length ? <button type="button" disabled={pending} onClick={() => completeReminderBatch(failedBulkIds)}>重试未完成提醒</button> : retryRequest ? <button type="button" disabled={pending} onClick={() => { void updateOne(retryRequest.reminder, retryRequest.input, retryRequest.success); }}>重试提醒</button> : null}</div> : null}
      {feedback ? <p className="reminder-feedback" aria-live="polite">{feedback}</p> : null}
      {loading ? <p className="reminder-state" role="status">正在加载提醒…</p> : null}
      {refreshing ? <p className="reminder-state" role="status">正在刷新提醒…</p> : null}
      {!loading && reminders.length === 0 ? <p className="reminder-state">暂无提醒。</p> : null}

      <div className="reminder-groups">
        {(Object.keys(groupLabels) as ReminderGroup[]).map((group) => <section className={`reminder-group reminder-group-${group}`} key={group} aria-labelledby={`reminder-group-${group}`}>
          <div className="reminder-group-heading"><h2 id={`reminder-group-${group}`}>{groupLabels[group]}</h2><span>{grouped[group].length}</span></div>
          <ul className="reminder-list" aria-label={`${groupLabels[group]}提醒`}>
            {grouped[group].map((reminder) => <li key={reminder.id} aria-label={reminder.title || reminder.id}>
              <label className="reminder-select"><input type="checkbox" aria-label={`选择${reminder.title || reminder.id}`} disabled={reminder.status !== "pending"} checked={selectedIds.has(reminder.id)} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(reminder.id)) next.delete(reminder.id); else next.add(reminder.id); return next; })} /></label>
              <div className="reminder-summary"><strong>{reminder.title || "未命名提醒"}</strong><time dateTime={reminder.snoozed_until ?? reminder.remind_at}>{new Date(reminder.snoozed_until ?? reminder.remind_at).toLocaleString()}</time><small>{reminder.note_id ? `关联笔记：${reminder.note_id}` : "未关联笔记"} · {statusLabel(reminder.status)} · {reminder.timezone || "UTC"}</small></div>
              <div className="reminder-item-actions">
                {reminder.status === "pending" ? <><button type="button" disabled={pending} aria-label="稍后 10 分钟" onClick={() => snooze(reminder, 10)}>稍后 10 分钟</button><button type="button" disabled={pending} onClick={() => { void updateOne(reminder, { base_revision: reminder.revision, status: "dismissed" }, "提醒已完成；重复系列已结束。"); }}>完成</button></> : null}
                {client.listReminderDeliveries ? <button type="button" disabled={pending} aria-expanded={deliveryOpenId === reminder.id} aria-label="查看投递状态" onClick={() => toggleDeliveryStatus(reminder.id)}>投递状态</button> : null}
                <button type="button" disabled={pending} aria-label="编辑" onClick={() => beginEdit(reminder)}>编辑</button>
                <button type="button" disabled={pending} aria-label="删除" onClick={() => remove(reminder)}>删除</button>
              </div>
              {deliveryOpenId === reminder.id ? <div className="reminder-delivery-status" role="region" aria-label={`${reminder.title || "未命名提醒"}投递状态`}>
                {deliveryLoadingId === reminder.id ? <p className="reminder-state" role="status">正在加载投递状态…</p> : null}
                {deliveryErrors[reminder.id] ? <p className="reminder-error" role="alert">{deliveryErrors[reminder.id]}</p> : null}
                {!deliveryLoadingId && !deliveryErrors[reminder.id] && (deliveryItems[reminder.id] ?? []).length === 0 ? <p className="reminder-state">暂无投递记录。</p> : null}
                {(deliveryItems[reminder.id] ?? []).map((item) => <div className="reminder-delivery-row" key={item.id}>
                  <span><strong>{deliveryChannelLabel(item.channel)}</strong><small>{deliveryStatusLabel(item.status)} · 尝试 {item.attempt_count}{item.last_error_code ? ` · ${item.last_error_code}` : ""}</small></span>
                  {item.status === "failed" && client.retryReminderDelivery ? <button type="button" disabled={deliveryRetryId !== null} aria-label={`重试 ${deliveryChannelLabel(item.channel)} 投递`} onClick={() => retryDelivery(reminder.id, item.id)}>{deliveryRetryId === `${reminder.id}:${item.id}` ? "重试中…" : "重试"}</button> : null}
                </div>)}
              </div> : null}
            </li>)}
          </ul>
        </section>)}
      </div>
      {nextCursor ? <button className="reminder-load-more" type="button" disabled={refreshing} onClick={loadMore}>{refreshing ? "加载中…" : "加载更多提醒"}</button> : null}
    </section>
  );
}
