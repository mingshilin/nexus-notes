import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CalendarConnectionSummary, CalendarEvent, CalendarEventsQuery } from "@nexus/contracts";

import type { KnowledgeClient } from "../data/knowledge-client";

type ExternalCalendarClient = Pick<
  KnowledgeClient,
  "listCalendarConnections" | "startCalendarConnection" | "listCalendarEvents" | "syncCalendarConnection" | "disconnectCalendarConnection"
>;

function currentRange(): CalendarEventsQuery {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function providerLabel(provider: CalendarConnectionSummary["provider"]) {
  return provider === "google" ? "Google 日历" : "Outlook 日历";
}

function statusLabel(status: CalendarConnectionSummary["status"]) {
  return status === "active" ? "已连接" : status === "error" ? "同步失败" : "已撤销";
}

function eventDate(event: CalendarEvent) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.starts_at));
}

export function ExternalCalendarPanel({ client }: { client: ExternalCalendarClient }) {
  const [connections, setConnections] = useState<CalendarConnectionSummary[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingProvider, setPendingProvider] = useState<"google" | "outlook" | null>(null);
  const [pendingConnection, setPendingConnection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const range = useMemo(currentRange, []);
  const mountedRef = useRef(true);
  const loadControllerRef = useRef<AbortController | null>(null);
  const actionControllerRef = useRef<AbortController | null>(null);
  const loadSequenceRef = useRef(0);
  const actionSequenceRef = useRef(0);

  const load = useCallback(() => {
    const sequence = ++loadSequenceRef.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoading(true);
    setError(null);
    void Promise.all([
      client.listCalendarConnections(controller.signal),
      client.listCalendarEvents(range, controller.signal),
    ]).then(([nextConnections, nextEvents]) => {
      if (controller.signal.aborted || !mountedRef.current || sequence !== loadSequenceRef.current) return;
      setConnections(nextConnections);
      setEvents(nextEvents);
    }).catch(() => {
      if (!controller.signal.aborted && mountedRef.current && sequence === loadSequenceRef.current) setError("外部日历状态暂时无法加载，请重试。");
    }).finally(() => {
      if (!controller.signal.aborted && mountedRef.current && sequence === loadSequenceRef.current) setLoading(false);
    });
  }, [client, range]);

  useEffect(() => {
    mountedRef.current = true;
    setPendingProvider(null);
    setPendingConnection(null);
    setError(null);
    setFeedback(null);
    setConnections([]);
    setEvents([]);
    load();
    return () => {
      mountedRef.current = false;
      loadControllerRef.current?.abort();
      actionControllerRef.current?.abort();
    };
  }, [load]);

  const beginAction = useCallback(() => {
    actionControllerRef.current?.abort();
    const controller = new AbortController();
    actionControllerRef.current = controller;
    const sequence = ++actionSequenceRef.current;
    return { controller, sequence };
  }, []);

  const isCurrentAction = useCallback((controller: AbortController, sequence: number) => (
    mountedRef.current && !controller.signal.aborted && actionControllerRef.current === controller && sequence === actionSequenceRef.current
  ), []);

  const connect = (provider: "google" | "outlook") => {
    const { controller, sequence } = beginAction();
    setPendingProvider(provider);
    setError(null);
    void client.startCalendarConnection(provider, controller.signal).then((result) => {
      if (!isCurrentAction(controller, sequence)) return;
      if (result.status === "unconfigured" || !result.authorization_url) {
        setFeedback(`${providerLabel(provider)}尚未配置，请联系管理员完成 OAuth 配置。`);
        return;
      }
      window.location.assign(result.authorization_url);
    }).catch(() => {
      if (isCurrentAction(controller, sequence)) setError(`${providerLabel(provider)}连接暂时无法开始。`);
    }).finally(() => {
      if (isCurrentAction(controller, sequence)) setPendingProvider(null);
    });
  };

  const sync = (connection: CalendarConnectionSummary) => {
    const { controller, sequence } = beginAction();
    setPendingConnection(connection.id);
    setError(null);
    void client.syncCalendarConnection(connection.id, range, controller.signal).then((result) => {
      if (!isCurrentAction(controller, sequence)) return [];
      setConnections((current) => current.map((item) => item.id === connection.id ? result.connection : item));
      setFeedback(`已导入 ${result.imported_count} 条日历事件。外部日历为只读导入，不会修改原日历。`);
      return client.listCalendarEvents(range, controller.signal);
    }).then((nextEvents) => {
      if (isCurrentAction(controller, sequence)) setEvents(nextEvents);
    }).catch(() => {
      if (isCurrentAction(controller, sequence)) setError("日历同步失败，可稍后重试。");
    }).finally(() => {
      if (isCurrentAction(controller, sequence)) setPendingConnection(null);
    });
  };

  const disconnect = (connection: CalendarConnectionSummary) => {
    const { controller, sequence } = beginAction();
    setPendingConnection(connection.id);
    void client.disconnectCalendarConnection(connection.id, controller.signal).then(() => {
      if (!isCurrentAction(controller, sequence)) return;
      setConnections((current) => current.map((item) => item.id === connection.id ? { ...item, status: "revoked", last_synced_at: null, last_error_code: null } : item));
      setEvents((current) => current.filter((event) => event.connection_id !== connection.id));
      setFeedback(`${providerLabel(connection.provider)}已断开。`);
    }).catch(() => {
      if (isCurrentAction(controller, sequence)) setError("断开日历失败，请重试。");
    }).finally(() => {
      if (isCurrentAction(controller, sequence)) setPendingConnection(null);
    });
  };

  return (
    <section className="knowledge-calendar-external" aria-labelledby="external-calendar-heading">
      <div className="knowledge-calendar-heading">
        <div><small>EXTERNAL CALENDAR</small><h2 id="external-calendar-heading">外部日历</h2></div>
        <button type="button" onClick={load} disabled={loading}>刷新</button>
      </div>
      <p className="knowledge-calendar-state">只读导入：Nexus Notes 不会写回、修改或删除 Google/Outlook 事件。</p>
      {loading ? <p className="knowledge-calendar-state" role="status">正在加载外部日历…</p> : null}
      {error ? <p className="knowledge-calendar-error" role="alert">{error}</p> : null}
      {feedback ? <p className="knowledge-calendar-feedback" role="status">{feedback}</p> : null}
      <div className="external-calendar-connect-actions">
        {(["google", "outlook"] as const).map((provider) => <button key={provider} type="button" disabled={pendingProvider !== null} onClick={() => connect(provider)}>{pendingProvider === provider ? "准备连接…" : `连接 ${providerLabel(provider)}`}</button>)}
      </div>
      <ul className="external-calendar-connections" aria-label="外部日历连接">
        {connections.map((connection) => <li key={connection.id} aria-label={`${providerLabel(connection.provider)} ${statusLabel(connection.status)}`}>
          <span><strong>{providerLabel(connection.provider)}</strong><small>{statusLabel(connection.status)}{connection.last_synced_at ? ` · ${eventDate({ starts_at: connection.last_synced_at } as CalendarEvent)}` : ""}</small></span>
          <div>
            {connection.status !== "revoked" ? <button type="button" disabled={pendingConnection !== null} onClick={() => sync(connection)}>{pendingConnection === connection.id ? "同步中…" : "同步"}</button> : null}
            {connection.status !== "revoked" ? <button type="button" disabled={pendingConnection !== null} onClick={() => disconnect(connection)}>断开</button> : null}
          </div>
        </li>)}
      </ul>
      {!loading && connections.length === 0 ? <p className="knowledge-calendar-state">尚未连接外部日历。</p> : null}
      {events.length > 0 ? <section aria-label="外部日历事件"><h3>已导入事件</h3><ul>{events.map((event) => <li key={event.id}><strong>{event.title || "未命名事件"}</strong><small>{eventDate(event)} · {providerLabel(event.provider)}</small></li>)}</ul></section> : null}
    </section>
  );
}
