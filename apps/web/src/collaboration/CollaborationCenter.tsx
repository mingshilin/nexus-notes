import type {
  ActivityEntry,
  AuditEntry,
  CollaborationComment,
  Notification,
  PresenceParticipant,
  PublicShare,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceRoleContract,
} from "@nexus/contracts";
import { Bell, Link2, MessageSquare, ShieldCheck, Users, X } from "lucide-react";
import {
  createElement,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import type { CollaborationClient, PresenceConnection } from "../data/collaboration-client";
import { useWorkbenchModalState } from "../layout/AdaptiveWorkbench";

type Section = "people" | "comments" | "shares" | "activity";
type PresenceStatus = "connecting" | "connected" | "unavailable";
type OneTimeLink = { kind: "invitation" | "share"; url: string; opener: HTMLElement | null };
export type CollaborationCommentTarget = { type: "note" | "database_record"; id: string; label: string };
export type CollaborationShareTarget = { type: "note" | "database_view"; id: string; label: string };
export interface NotificationTarget {
  targetType: "note" | "database_record";
  targetId: string;
  commentId: string | null;
  databaseId?: string;
}

const sensitiveMetadataKey = /(content|password|token|code|cookie|authorization|attachment.*bytes|body|secret)/iu;

function errorDetails(error: unknown) {
  return error && typeof error === "object" ? error as { status?: number; code?: string; name?: string } : {};
}

export function collaborationErrorMessage(error: unknown) {
  const { status, code, name } = errorDetails(error);
  if (status === 403 || code === "FORBIDDEN") return "权限不足，无法完成此操作。";
  if (status === 409 || code === "REVISION_CONFLICT" || code === "CONFLICT") return "数据已发生冲突，请刷新后重试。";
  if (status === 429 || code === "RATE_LIMITED") return "操作过于频繁，请稍后重试。";
  if (code === "NETWORK_ERROR" || name === "TypeError") return "网络连接异常，请检查连接后重试。";
  return "协作服务暂时不可用，请稍后重试。";
}

function commandId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `comment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function oneTimeUrl(kind: OneTimeLink["kind"], token: string) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const path = kind === "share" ? `/share/${encodeURIComponent(token)}` : `/invite/${encodeURIComponent(token)}`;
  return `${origin}${path}`;
}

function upsertById<T extends { id: string }>(items: T[], next: T) {
  return items.some((item) => item.id === next.id)
    ? items.map((item) => item.id === next.id ? next : item)
    : [next, ...items];
}

function ModalDialog({
  label,
  opener,
  onClose,
  className = "collaboration-dialog",
  backdropClassName = "",
  children,
}: {
  label: string;
  opener: HTMLElement | null;
  onClose(): void;
  className?: string;
  backdropClassName?: string;
  children(closeRef: { current: HTMLButtonElement | null }): ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const setWorkbenchModalOpen = useWorkbenchModalState();

  useEffect(() => {
    setWorkbenchModalOpen(true);
    const viewport = window.visualViewport;
    const updateKeyboardInset = () => {
      const height = viewport?.height ?? window.innerHeight;
      const offset = viewport?.offsetTop ?? 0;
      document.documentElement.style.setProperty("--collaboration-keyboard", `${Math.max(0, window.innerHeight - height - offset)}px`);
    };
    updateKeyboardInset();
    viewport?.addEventListener("resize", updateKeyboardInset);
    viewport?.addEventListener("scroll", updateKeyboardInset);
    closeRef.current?.focus();
    return () => {
      viewport?.removeEventListener("resize", updateKeyboardInset);
      viewport?.removeEventListener("scroll", updateKeyboardInset);
      document.documentElement.style.removeProperty("--collaboration-keyboard");
      setWorkbenchModalOpen(false);
      opener?.focus();
    };
  }, [opener, setWorkbenchModalOpen]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
    if (focusable.length === 0) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={`collaboration-dialog-backdrop ${backdropClassName}`.trim()} onMouseDown={onClose}>
      <section
        className={className}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-scroll-owner="dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children(closeRef)}
      </section>
    </div>,
    document.body,
  );
}

function OneTimeLinkDialog({ value, onClose }: { value: OneTimeLink; onClose(): void }) {
  const label = value.kind === "share" ? "一次性分享链接" : "一次性邀请链接";
  return <ModalDialog label={label} opener={value.opener} onClose={onClose}>
    {(closeRef) => <>
      <header>
        <div><p className="eyebrow">ONE-TIME LINK</p><h2>{label}</h2></div>
        <button ref={closeRef} type="button" aria-label="关闭" onClick={onClose}><X aria-hidden="true" size={17} /></button>
      </header>
      <p>此链接仅显示一次。关闭后无法再次查看，请仅通过可信渠道发送。</p>
      <a className="collaboration-one-time-link" href={value.url}>{value.url}</a>
    </>}
  </ModalDialog>;
}

function Metadata({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value);
  if (!entries.length) return <span className="collaboration-metadata-empty">无附加信息</span>;
  return <dl className="collaboration-metadata">{entries.map(([key, raw]) => {
    const hidden = sensitiveMetadataKey.test(key);
    const safeValue = hidden
      ? "[已隐藏]"
      : raw === null || ["string", "number", "boolean"].includes(typeof raw)
        ? String(raw)
        : "[结构化数据]";
    return <div key={key}><dt>{key}</dt><dd>{safeValue}</dd></div>;
  })}</dl>;
}

function PresenceSummary({ status, participants }: { status: PresenceStatus; participants: PresenceParticipant[] }) {
  if (status === "unavailable") return <p className="collaboration-presence unavailable">实时协作暂不可用，编辑不受影响。</p>;
  if (status === "connecting") return <p className="collaboration-presence">正在连接实时协作…</p>;
  if (!participants.length) return <p className="collaboration-presence connected">实时协作已连接。</p>;
  return <div className="collaboration-presence connected" aria-label="实时协作者">
    <span>{participants.length} 人在线</span>
    {participants.map((participant) => <span className="presence-person" key={participant.user_id}>
      {participant.display_name}{participant.state === "typing" ? " 正在输入" : ""}
    </span>)}
  </div>;
}

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

export interface CollaborationCenterProps {
  client: CollaborationClient;
  workspaceId: string;
  userId: string;
  role: WorkspaceRoleContract;
  initialSection?: Section;
  activeTarget?: Pick<CollaborationCommentTarget, "type" | "id">;
  selectedCommentId?: string | null;
  commentTargets?: CollaborationCommentTarget[];
  shareTargets?: CollaborationShareTarget[];
}

function targetKey(target: { type: string; id: string }) {
  return `${target.type}:${target.id}`;
}

export function CollaborationCenter({
  client,
  workspaceId,
  userId,
  role,
  initialSection = "people",
  activeTarget,
  selectedCommentId = null,
  commentTargets = [],
  shareTargets = [],
}: CollaborationCenterProps) {
  const setWorkbenchModalOpen = useWorkbenchModalState();
  const [section, setSection] = useState<Section>(initialSection);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [comments, setComments] = useState<CollaborationComment[]>([]);
  const [shares, setShares] = useState<PublicShare[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [baseLoading, setBaseLoading] = useState(true);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus>("connecting");
  const [participants, setParticipants] = useState<PresenceParticipant[]>([]);
  const presenceConnection = useRef<PresenceConnection | null>(null);
  const [oneTimeLink, setOneTimeLink] = useState<OneTimeLink | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const initialCommentTarget = commentTargets.find((target) => activeTarget && target.type === activeTarget.type && target.id === activeTarget.id)
    ?? commentTargets[0];
  const [commentTargetKey, setCommentTargetKey] = useState(initialCommentTarget ? targetKey(initialCommentTarget) : "");
  const [commentBody, setCommentBody] = useState("");
  const [mentionUserIds, setMentionUserIds] = useState<string[]>([]);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [shareTargetKey, setShareTargetKey] = useState(shareTargets[0] ? targetKey(shareTargets[0]) : "");
  const [sharePassword, setSharePassword] = useState("");
  const [shareExpiry, setShareExpiry] = useState("");
  const canManage = role === "owner";
  const canEdit = role !== "viewer";
  const commentTarget = commentTargets.find((target) => targetKey(target) === commentTargetKey);
  const shareTarget = shareTargets.find((target) => targetKey(target) === shareTargetKey);
  const targetType = commentTarget?.type ?? "note";
  const targetId = commentTarget?.id ?? "";

  useEffect(() => setSection(initialSection), [initialSection]);

  useEffect(() => {
    const preferred = commentTargets.find((target) => activeTarget && target.type === activeTarget.type && target.id === activeTarget.id);
    if (preferred) setCommentTargetKey(targetKey(preferred));
    else if (!commentTargets.some((target) => targetKey(target) === commentTargetKey)) setCommentTargetKey(commentTargets[0] ? targetKey(commentTargets[0]) : "");
  }, [activeTarget, commentTargetKey, commentTargets]);

  useEffect(() => {
    if (!shareTargets.some((target) => targetKey(target) === shareTargetKey)) setShareTargetKey(shareTargets[0] ? targetKey(shareTargets[0]) : "");
  }, [shareTargetKey, shareTargets]);

  useEffect(() => {
    const controller = new AbortController();
    setBaseLoading(true);
    setError(null);
    void Promise.allSettled([
      client.listMembers(controller.signal),
      canManage ? client.listInvitations(controller.signal) : Promise.resolve([]),
    ]).then(([memberResult, invitationResult]) => {
      if (controller.signal.aborted) return;
      if (memberResult.status === "fulfilled") setMembers(memberResult.value);
      if (invitationResult.status === "fulfilled") setInvitations(invitationResult.value);
      const rejected = [memberResult, invitationResult].find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") setError(collaborationErrorMessage(rejected.reason));
    }).finally(() => {
      if (!controller.signal.aborted) setBaseLoading(false);
    });
    return () => controller.abort();
  }, [canManage, client, workspaceId]);

  useEffect(() => () => setWorkbenchModalOpen(false), [setWorkbenchModalOpen]);

  useEffect(() => {
    const connection = client.connectPresence({
      onStatus: setPresenceStatus,
      onParticipants: setParticipants,
    });
    presenceConnection.current = connection;
    connection.sendPresence("active");
    return () => {
      connection.disconnect();
      presenceConnection.current = null;
    };
  }, [client, workspaceId]);

  useEffect(() => {
    if (section === "people") return undefined;
    const controller = new AbortController();
    setSectionLoading(true);
    setError(null);
    const request = section === "comments"
      ? commentTarget
        ? client.listComments(commentTarget.type, commentTarget.id, controller.signal).then(setComments)
        : Promise.resolve().then(() => setComments([]))
      : section === "shares"
        ? canEdit
          ? client.listShares({ signal: controller.signal }).then(setShares)
          : Promise.resolve().then(() => setShares([]))
        : canManage
          ? Promise.all([client.listActivity({ limit: 50, signal: controller.signal }), client.listAudit({ limit: 50, signal: controller.signal })])
            .then(([activityPage, auditPage]) => { setActivity(activityPage.items); setAudit(auditPage.items); })
          : client.listActivity({ limit: 50, signal: controller.signal }).then((activityPage) => { setActivity(activityPage.items); setAudit([]); });
    void request.catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(collaborationErrorMessage(reason));
    }).finally(() => {
      if (!controller.signal.aborted) setSectionLoading(false);
    });
    return () => controller.abort();
  }, [canEdit, canManage, client, commentTarget, section]);

  const run = async (command: () => Promise<void>, success: string) => {
    if (pending) return;
    setPending(true);
    setError(null);
    setFeedback(null);
    try {
      await command();
      setFeedback(success);
    } catch (reason) {
      setError(collaborationErrorMessage(reason));
    } finally {
      setPending(false);
    }
  };

  const updateMemberRole = (member: WorkspaceMember, nextRole: "editor" | "viewer") => run(async () => {
    const updated = await client.updateMemberRole(member.user_id, { role: nextRole, base_revision: member.revision });
    setMembers((current) => current.map((item) => item.user_id === updated.user_id ? updated : item));
  }, "成员角色已更新。");

  const removeMember = (member: WorkspaceMember) => run(async () => {
    await client.removeMember(member.user_id, member.revision);
    setMembers((current) => current.filter((item) => item.user_id !== member.user_id));
  }, "成员已移除。");

  const transferOwnership = (member: WorkspaceMember) => run(async () => {
    const updated = await client.transferOwnership(member.user_id, member.revision);
    setMembers((current) => current.map((item) => item.user_id === updated.user_id ? updated : item));
  }, "所有权已移交。");

  const submitInvitation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const opener = event.currentTarget.querySelector<HTMLButtonElement>("button[type='submit']");
    void run(async () => {
      const result = await client.createInvitation({ email: inviteEmail.trim(), role: inviteRole, expires_in_hours: 72 });
      setInvitations((current) => upsertById(current, result.invitation));
      setInviteEmail("");
      setWorkbenchModalOpen(true);
      setOneTimeLink({ kind: "invitation", url: oneTimeUrl("invitation", result.token), opener });
    }, "邀请已创建。");
  };

  const revokeInvitation = (invitation: WorkspaceInvitation) => run(async () => {
    const updated = await client.revokeInvitation(invitation.id, invitation.revision);
    setInvitations((current) => current.map((item) => item.id === updated.id ? updated : item));
  }, "邀请已撤销。");

  const reloadComments = async () => {
    if (!commentTarget) return;
    const next = await client.listComments(targetType, targetId);
    setComments(next);
  };

  const submitComment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      const created = await client.createComment({
        target_type: targetType,
        target_id: targetId.trim(),
        body: commentBody.trim(),
        mention_user_ids: mentionUserIds,
        idempotency_key: commandId(),
      });
      setComments((current) => upsertById(current, created));
      setCommentBody("");
      setMentionUserIds([]);
      presenceConnection.current?.sendTyping(targetType, targetId, false);
    }, "评论已发表。");
  };

  const updateComment = (comment: CollaborationComment) => run(async () => {
    const updated = await client.updateComment(comment.id, { body: editingBody.trim(), mention_user_ids: comment.mention_user_ids, base_revision: comment.revision });
    setComments((current) => current.map((item) => item.id === updated.id ? updated : item));
    setEditingCommentId(null);
    setEditingBody("");
  }, "评论已更新。");

  const deleteComment = (comment: CollaborationComment) => run(async () => {
    await client.deleteComment(comment.id, comment.revision);
    setComments((current) => current.filter((item) => item.id !== comment.id));
  }, "评论已删除。");

  const submitShare = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!shareTarget) return;
    const opener = event.currentTarget.querySelector<HTMLButtonElement>("button[type='submit']");
    void run(async () => {
      const result = await client.createShare({
        entity_type: shareTarget.type,
        entity_id: shareTarget.id,
        ...(sharePassword ? { password: sharePassword } : {}),
        ...(shareExpiry ? { expires_in_hours: Number(shareExpiry) } : {}),
      });
      setShares((current) => upsertById(current, result.share));
      setSharePassword("");
      setShareExpiry("");
      setWorkbenchModalOpen(true);
      setOneTimeLink({ kind: "share", url: oneTimeUrl("share", result.token), opener });
    }, "公开分享已创建。");
  };

  const revokeShare = (share: PublicShare) => run(async () => {
    const updated = await client.revokeShare(share.id, share.revision);
    setShares((current) => current.map((item) => item.id === updated.id ? updated : item));
  }, "公开分享已撤销。");

  const sectionLabels: readonly [Section, string, typeof Users][] = [
    ["people", "成员与邀请", Users],
    ["comments", "评论与提及", MessageSquare],
    ["shares", "公开分享", Link2],
    ["activity", canManage ? "活动与审计" : "活动记录", ShieldCheck],
  ];

  return <section className="collaboration-center" aria-labelledby="collaboration-title">
    <header className="collaboration-hero">
      <div><p className="eyebrow">WORKSPACE / COLLABORATION</p><h1 id="collaboration-title">协作中心</h1><p>管理成员、讨论、公开链接与工作区安全记录。</p></div>
      <PresenceSummary status={presenceStatus} participants={participants} />
    </header>
    <nav className="collaboration-tabs" aria-label="协作中心分区">{sectionLabels.map(([id, label, Icon]) => <button className={section === id ? "active" : ""} key={id} type="button" onClick={() => setSection(id)}><Icon aria-hidden="true" size={16} />{label}</button>)}</nav>
    {baseLoading ? <p className="collaboration-loading" role="status">正在加载协作数据…</p> : null}
    {sectionLoading ? <p className="collaboration-loading">正在加载此分区…</p> : null}
    {error ? <p className="collaboration-error" role="alert">{error}</p> : null}
    {feedback ? <p className="collaboration-feedback" role="status">{feedback}</p> : null}

    {!baseLoading && section === "people" ? <div className="collaboration-grid">
      <section className="collaboration-card"><header><div><small>TEAM</small><h2>工作区成员</h2></div><span>{members.length}</span></header>
        {members.length === 0 ? <p className="collaboration-empty">当前工作区还没有其他成员。</p> : <div className="collaboration-list">{members.map((member) => <article key={member.user_id}>
          <div className="collaboration-avatar" aria-hidden="true">{member.display_name.slice(0, 1).toUpperCase()}</div>
          <div className="collaboration-person"><strong>{member.display_name}</strong><span>{member.email}</span></div>
          {canManage ? <label className="collaboration-role"><span className="sr-only">{member.display_name} 的角色</span><select aria-label={`${member.display_name} 的角色`} value={member.role} disabled={pending || member.user_id === userId || member.role === "owner"} onChange={(event) => void updateMemberRole(member, event.target.value as "editor" | "viewer")}><option value="owner">所有者</option><option value="editor">编辑者</option><option value="viewer">查看者</option></select></label> : null}
          {canManage ? <div className="collaboration-row-actions"><button type="button" disabled={pending || member.user_id === userId || member.role === "owner"} onClick={() => void transferOwnership(member)}>移交所有权给 {member.display_name}</button><button className="danger" type="button" disabled={pending || member.user_id === userId || member.role === "owner"} onClick={() => void removeMember(member)}>移除 {member.display_name}</button></div> : null}
        </article>)}</div>}
      </section>
      <section className="collaboration-card"><header><div><small>INVITE</small><h2>待处理邀请</h2></div><span>{invitations.filter((item) => item.status === "pending").length}</span></header>
        {canManage ? <form className="collaboration-form invitation-form" onSubmit={submitInvitation}><label>邀请邮箱<input aria-label="邀请邮箱" type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label><label>邀请角色<select aria-label="邀请角色" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "editor" | "viewer")}><option value="viewer">查看者</option><option value="editor">编辑者</option></select></label><button type="submit" disabled={pending || !inviteEmail.trim()}>发送邀请</button></form> : <p className="collaboration-permission">只有所有者可以发送或撤销邀请。</p>}
        {canManage && invitations.length === 0 ? <p className="collaboration-empty">暂无待处理邀请。</p> : null}
        {canManage && invitations.length > 0 ? <div className="collaboration-list compact">{invitations.map((invitation) => <article key={invitation.id}><div className="collaboration-person"><strong>{invitation.email}</strong><span>{invitation.role} · {invitation.status}</span></div><button type="button" disabled={pending || invitation.status !== "pending"} onClick={() => void revokeInvitation(invitation)}>撤销邀请 {invitation.email}</button></article>)}</div> : null}
      </section>
    </div> : null}

    {!sectionLoading && section === "comments" ? <section className="collaboration-card collaboration-comments"><header><div><small>THREAD</small><h2>评论与提及</h2></div><button type="button" disabled={!commentTarget} onClick={() => void run(reloadComments, "评论已刷新。")}>刷新</button></header>
      <label className="collaboration-target-select">评论目标<select aria-label="评论目标" value={commentTargetKey} disabled={!commentTargets.length} onChange={(event) => setCommentTargetKey(event.target.value)}>{commentTargets.map((target) => <option key={targetKey(target)} value={targetKey(target)}>{target.label}</option>)}</select></label>
      {!commentTarget ? <p className="collaboration-empty">请先在笔记或数据库中选择可评论对象。</p> : null}
      {canEdit && commentTarget ? <form className="collaboration-form comment-form" onSubmit={submitComment}><label className="wide">评论内容<textarea aria-label="评论内容" required value={commentBody} onFocus={() => presenceConnection.current?.sendTyping(targetType, targetId, true)} onBlur={() => presenceConnection.current?.sendTyping(targetType, targetId, false)} onChange={(event) => { setCommentBody(event.target.value); presenceConnection.current?.sendTyping(targetType, targetId, true); }} /></label><fieldset className="wide"><legend>提及成员</legend>{members.map((member) => <label className="mention-choice" key={member.user_id}><input type="checkbox" aria-label={`提及 ${member.display_name}`} checked={mentionUserIds.includes(member.user_id)} onChange={(event) => setMentionUserIds((current) => event.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))} />{member.display_name}</label>)}</fieldset><button type="submit" disabled={pending || !commentBody.trim()}>发表评论</button></form> : null}
      {commentTarget && comments.length === 0 ? <p className="collaboration-empty">此对象还没有评论。</p> : null}
      {commentTarget && comments.length > 0 ? <div className="comment-list">{comments.map((comment) => <article key={comment.id} aria-current={comment.id === selectedCommentId ? "true" : undefined}><header><strong>{comment.author_display_name}</strong><time>{new Date(comment.created_at).toLocaleString()}</time></header>{editingCommentId === comment.id ? <textarea aria-label={`编辑 ${comment.author_display_name} 的评论`} value={editingBody} onChange={(event) => setEditingBody(event.target.value)} /> : <p>{comment.body}</p>}<footer>{comment.mention_user_ids.length ? <span>提及 {comment.mention_user_ids.map((id) => members.find((member) => member.user_id === id)?.display_name ?? id).join("、")}</span> : <span />}{canEdit && (canManage || comment.author_user_id === userId) ? <div>{editingCommentId === comment.id ? <button type="button" disabled={!editingBody.trim() || pending} onClick={() => void updateComment(comment)}>保存评论</button> : <button type="button" onClick={() => { setEditingCommentId(comment.id); setEditingBody(comment.body); }}>编辑评论</button>}<button className="danger" type="button" disabled={pending} onClick={() => void deleteComment(comment)}>删除评论</button></div> : null}</footer></article>)}</div> : null}
    </section> : null}

    {!sectionLoading && section === "shares" ? <section className="collaboration-card collaboration-shares"><header><div><small>PUBLIC ACCESS</small><h2>公开分享</h2></div><span>{shares.filter((item) => item.status === "active").length} 个有效</span></header>
      {!canEdit ? <p className="collaboration-permission">查看者无法访问公开分享管理。</p> : null}
      {canEdit ? <form className="collaboration-form share-form" onSubmit={submitShare}><label>分享对象<select aria-label="分享对象" value={shareTargetKey} disabled={!shareTargets.length} onChange={(event) => setShareTargetKey(event.target.value)}>{shareTargets.map((target) => <option key={targetKey(target)} value={targetKey(target)}>{target.label}</option>)}</select></label><label>分享密码<input aria-label="分享密码" type="password" minLength={8} autoComplete="new-password" value={sharePassword} onChange={(event) => setSharePassword(event.target.value)} /></label><label>有效小时<input aria-label="有效小时" type="number" min="1" max="8760" value={shareExpiry} onChange={(event) => setShareExpiry(event.target.value)} /></label><button type="submit" disabled={pending || !shareTarget || Boolean(sharePassword && sharePassword.length < 8)}>创建分享</button></form> : null}
      {shares.length === 0 ? <p className="collaboration-empty">尚未创建公开分享。</p> : <div className="share-list">{shares.map((share) => <article key={share.id}><div><strong>{share.entity_id}</strong><span>{share.entity_type} · {share.status}{share.password_required ? " · 密码保护" : ""}</span></div><button className="danger" type="button" aria-label={`撤销分享 ${share.entity_id}`} disabled={!canEdit || pending || share.status !== "active"} onClick={() => void revokeShare(share)}>撤销</button></article>)}</div>}
    </section> : null}

    {!sectionLoading && section === "activity" ? <div className="collaboration-grid"><section className="collaboration-card"><header><div><small>ACTIVITY</small><h2>活动记录</h2></div></header>{activity.length === 0 ? <p className="collaboration-empty">暂无活动记录。</p> : <div className="audit-list">{activity.map((entry) => <article key={entry.id}><header><strong>{entry.action}</strong><time>{new Date(entry.created_at).toLocaleString()}</time></header><p>{entry.target_type}{entry.target_id ? ` / ${entry.target_id}` : ""}</p><Metadata value={entry.metadata} /></article>)}</div>}</section>{canManage ? <section className="collaboration-card"><header><div><small>AUDIT</small><h2>审计日志</h2></div></header>{audit.length === 0 ? <p className="collaboration-empty">暂无审计日志。</p> : <div className="audit-list">{audit.map((entry) => <article key={entry.id}><header><strong>{entry.action}</strong><span>{entry.outcome}</span></header><p>{entry.target_type}{entry.target_id ? ` / ${entry.target_id}` : ""}</p><Metadata value={entry.metadata} /></article>)}</div>}</section> : null}</div> : null}
    {oneTimeLink ? <OneTimeLinkDialog value={oneTimeLink} onClose={() => setOneTimeLink(null)} /> : null}
  </section>;
}

export function notificationButtonLabel(unreadCount: number) {
  return `通知，${unreadCount} 条未读`;
}

export function NotificationButton({ unreadCount, onClick }: { unreadCount: number; onClick(opener: HTMLElement): void }) {
  return <button className="notification-button" type="button" aria-label={notificationButtonLabel(unreadCount)} onClick={(event) => onClick(event.currentTarget)}><Bell aria-hidden="true" size={18} />{unreadCount > 0 ? <span>{unreadCount}</span> : null}</button>;
}
