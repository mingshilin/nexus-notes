import type { CalendarFeed, CalendarFeedItem, CalendarFeedQuery } from "@nexus/contracts";
import { useEffect, useState } from "react";
import type { KnowledgeClient } from "../data/knowledge-client";

type CalendarClient = Pick<KnowledgeClient, "getCalendarFeed">;

function defaultRange(): CalendarFeedQuery {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function kindLabel(kind: CalendarFeedItem["kind"]) {
  return kind === "daily_note" ? "每日笔记" : kind === "reminder" ? "提醒" : "数据库记录";
}

export function KnowledgeCalendarPanel({
  client,
  initialRange = defaultRange(),
}: {
  client: CalendarClient;
  initialRange?: CalendarFeedQuery;
}) {
  const [range, setRange] = useState<CalendarFeedQuery>(initialRange);
  const [feed, setFeed] = useState<CalendarFeed>({ items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void client.getCalendarFeed(range, controller.signal).then((nextFeed) => {
      if (!controller.signal.aborted) setFeed(nextFeed);
    }).catch(() => {
      if (!controller.signal.aborted) setError("日历暂时无法加载，请检查网络后重试。");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [client, range, requestVersion]);

  const itemsByDate = feed.items.reduce<Map<string, CalendarFeedItem[]>>((groups, item) => {
    const items = groups.get(item.date) ?? [];
    items.push(item);
    groups.set(item.date, items);
    return groups;
  }, new Map());

  return (
    <section className="knowledge-calendar" aria-labelledby="knowledge-calendar-heading">
      <div className="knowledge-calendar-heading">
        <div><small>CALENDAR FEED</small><h2 id="knowledge-calendar-heading">日历总览</h2></div>
        <button type="button" onClick={() => setRequestVersion((version) => version + 1)} disabled={loading}>刷新</button>
      </div>
      <div className="knowledge-calendar-range">
        <label>开始日期<input aria-label="日历开始日期" type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} /></label>
        <label>结束日期<input aria-label="日历结束日期" type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} /></label>
      </div>
      {loading ? <p className="knowledge-calendar-state" role="status">正在加载日历…</p> : null}
      {error ? <div className="knowledge-calendar-error" role="alert"><span>{error}</span><button type="button" aria-label="重试日历" onClick={() => setRequestVersion((version) => version + 1)}>重试</button></div> : null}
      {!loading && !error && feed.items.length === 0 ? <p className="knowledge-calendar-state">当前范围暂无安排。</p> : null}
      <div className="knowledge-calendar-days">
        {[...itemsByDate.entries()].map(([date, items]) => (
          <section className="knowledge-calendar-day" key={date} aria-label={date}>
            <h3>{date}</h3>
            <ul>
              {items.map((item) => <li key={`${item.kind}:${item.id}`}><strong>{item.title || "未命名项目"}</strong><small>{kindLabel(item.kind)}{item.status ? ` · ${item.status}` : ""}</small></li>)}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
