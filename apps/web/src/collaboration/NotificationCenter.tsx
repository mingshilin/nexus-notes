import type { Notification } from "@nexus/contracts";
import { Bell, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { CollaborationClient } from "../data/collaboration-client";
import { ModalDialog } from "./CollaborationModal";
import { collaborationErrorMessage, type NotificationTarget } from "./collaboration-types";

export interface NotificationCenterProps {
  client: CollaborationClient;
  open: boolean;
  unreadCount: number;
  opener?: HTMLElement | null;
  onClose(): void;
  onNotificationRead?(count: number): void;
  onDeepLink?(target: NotificationTarget): void;
}

export function notificationTargetFromDeepLink(deepLink: string, payload: Record<string, unknown> = {}): NotificationTarget | null {
  const url = new URL(deepLink, "https://nexus.invalid");
  const note = url.pathname.match(/^\/notes\/([^/]+)\/?$/u);
  const routedRecord = url.pathname.match(/^\/databases\/([^/]+)\/records\/([^/]+)\/?$/u);
  const legacyRecord = url.pathname.match(/^\/databases\/records\/([^/]+)\/?$/u);
  const match = note ?? routedRecord?.slice(1) ?? legacyRecord;
  if (!match?.[1]) return null;
  const databaseId = routedRecord?.[1]
    ? decodeURIComponent(routedRecord[1])
    : typeof payload.database_id === "string" && payload.database_id
      ? payload.database_id
      : undefined;
  return {
    targetType: note ? "note" : "database_record",
    targetId: decodeURIComponent(routedRecord?.[2] ?? match[1]),
    commentId: url.searchParams.get("comment"),
    ...(databaseId ? { databaseId } : {}),
  };
}

export function NotificationCenter({ client, open, unreadCount, opener = null, onClose, onNotificationRead, onDeepLink }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSelectedIds(new Set());
    void client.listNotifications({ limit: 25, signal: controller.signal }).then((page) => {
      if (controller.signal.aborted) return;
      setNotifications(page.items);
      setNextCursor(page.next_cursor);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(collaborationErrorMessage(reason));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [client, open]);

  if (!open) return null;
  const markRead = (ids: string[], readAt: string) => {
    setNotifications((current) => current.map((item) => ids.includes(item.id) ? { ...item, read_at: readAt } : item));
    setSelectedIds((current) => new Set([...current].filter((id) => !ids.includes(id))));
    onNotificationRead?.(ids.length);
  };
  const run = async (command: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await command();
    } catch (reason) {
      setError(collaborationErrorMessage(reason));
    } finally {
      setPending(false);
    }
  };
  const openNotification = async (notification: Notification) => {
    const target = notificationTargetFromDeepLink(notification.deep_link, notification.payload);
    if (target) onDeepLink?.(target);
    try {
      if (!notification.read_at) {
        const result = await client.readNotification(notification.id, notification.revision);
        markRead([notification.id], result.read_at);
      }
    } catch (reason) {
      setError(collaborationErrorMessage(reason));
    }
  };
  const loadMore = () => run(async () => {
    if (!nextCursor) return;
    const page = await client.listNotifications({ cursor: nextCursor, limit: 25 });
    setNotifications((current) => {
      const existing = new Set(current.map((item) => item.id));
      return [...current, ...page.items.filter((item) => !existing.has(item.id))];
    });
    setNextCursor(page.next_cursor);
  });
  const readSelected = () => run(async () => {
    const selected = notifications.filter((item) => selectedIds.has(item.id) && !item.read_at);
    if (!selected.length) return;
    const result = await client.readNotifications({
      notification_ids: selected.map((item) => item.id),
      base_revisions: Object.fromEntries(selected.map((item) => [item.id, item.revision])),
    });
    markRead(result.notification_ids, result.read_at);
  });
  const readAll = () => run(async () => {
    const result = await client.readAllNotifications();
    setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? result.read_at })));
    setSelectedIds(new Set());
    onNotificationRead?.(result.count);
  });

  return <ModalDialog
    label="通知中心"
    opener={opener}
    onClose={onClose}
    className="collaboration-dialog notification-center"
    backdropClassName="notification-center-backdrop"
  >
    {(closeRef) => <>
      <header><div><p className="eyebrow">INBOX</p><h2>通知中心</h2></div><button ref={closeRef} type="button" aria-label="关闭通知中心" onClick={onClose}><X size={17} /></button></header>
      <div className="notification-actions">
        <button type="button" disabled={pending || selectedIds.size === 0} onClick={() => void readSelected()}>将所选通知标为已读</button>
        <button type="button" disabled={pending || (unreadCount <= 0 && !nextCursor && notifications.every((item) => item.read_at))} onClick={() => void readAll()}>全部标为已读</button>
      </div>
      {loading ? <p role="status">正在加载通知…</p> : null}
      {error ? <p role="alert" className="collaboration-error">{error}</p> : null}
      {!loading && !error && notifications.length === 0 ? <p className="collaboration-empty">暂无通知。</p> : null}
      <div className="notification-list">{notifications.map((notification) => <article className={notification.read_at ? "read" : "unread"} key={notification.id}>
        <div><label><input type="checkbox" aria-label={`选择通知 ${notification.id}`} disabled={Boolean(notification.read_at) || pending} checked={selectedIds.has(notification.id)} onChange={(event) => setSelectedIds((current) => {
          const next = new Set(current);
          if (event.target.checked) next.add(notification.id); else next.delete(notification.id);
          return next;
        })} /><strong>{notification.type}</strong></label><time>{new Date(notification.created_at).toLocaleString()}</time></div>
        <div className="notification-row-actions">
          <a href={notification.deep_link} onClick={(event) => { event.preventDefault(); void openNotification(notification); }}>打开 {notification.type}</a>
          {!notification.read_at ? <button type="button" aria-label={`标记通知 ${notification.id} 已读`} disabled={pending} onClick={() => void run(async () => {
            const result = await client.readNotification(notification.id, notification.revision);
            markRead(result.notification_ids, result.read_at);
          })}>标记已读</button> : null}
        </div>
      </article>)}</div>
      {nextCursor ? <button className="notification-load-more" type="button" disabled={pending} onClick={() => void loadMore()}>加载更多通知</button> : null}
    </>}
  </ModalDialog>;
}

export function notificationButtonLabel(unreadCount: number) {
  return `通知，${unreadCount} 条未读`;
}

export function NotificationButton({ unreadCount, onClick }: { unreadCount: number; onClick(opener: HTMLElement): void }) {
  return <button className="notification-button" type="button" aria-label={notificationButtonLabel(unreadCount)} onClick={(event) => onClick(event.currentTarget)}><Bell aria-hidden="true" size={18} />{unreadCount > 0 ? <span>{unreadCount}</span> : null}</button>;
}
