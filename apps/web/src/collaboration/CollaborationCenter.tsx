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
} from "react";
import { createPortal } from "react-dom";

import type { CollaborationClient, PresenceConnection } from "../data/collaboration-client";
import { useWorkbenchModalState } from "../layout/AdaptiveWorkbench";

type Section = "people" | "comments" | "shares" | "activity";
type PresenceStatus = "connecting" | "connected" | "unavailable";
type OneTimeLink = { kind: "invitation" | "share"; url: string; opener: HTMLElement | null };

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

function OneTimeLinkDialog({ value, onClose }: { value: OneTimeLink; onClose(): void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const label = value.kind === "share" ? "一次性分享链接" : "一次性邀请链接";

  useEffect(() => {
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
      value.opener?.focus();
    };
  }, [value.opener]);

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
    <div className="collaboration-dialog-backdrop" onMouseDown={onClose}>
      <section
        className="collaboration-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-scroll-owner="dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div><p className="eyebrow">ONE-TIME LINK</p><h2>{label}</h2></div>
          <button ref={closeRef} type="button" aria-label="关闭" onClick={onClose}><X aria-hidden="true" size={17} /></button>
        </header>
        <p>此链接仅显示一次。关闭后无法再次查看，请仅通过可信渠道发送。</p>
        <a className="collaboration-one-time-link" href={value.url}>{value.url}</a>
      </section>
    </div>,
    document.body,
  );
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
  onClose(): void;
  onNotificationRead?(notification: Notification): void;
  onDeepLink?(deepLink: string): void;
}

export function NotificationCenter({ client, open, onClose, onNotificationRead, onDeepLink }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void client.listNotifications({ limit: 25, signal: controller.signal }).then((page) => {
      if (!controller.signal.aborted) setNotifications(page.items);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(collaborationErrorMessage(reason));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [client, open]);

  if (!open) return null;
  const openNotification = async (notification: Notification) => {
    try {
      if (!notification.read_at) {
        const result = await client.readNotification(notification.id, notification.revision);
        setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: result.read_at } : item));
        onNotificationRead?.(notification);
      }
      onDeepLink?.(notification.deep_link);
    } catch (reason) {
      setError(collaborationErrorMessage(reason));
    }
  };

  return <aside className="notification-center" aria-label="通知中心">
    <header><div><p className="eyebrow">INBOX</p><h2>通知中心</h2></div><button type="button" aria-label="关闭通知中心" onClick={onClose}><X size={17} /></button></header>
    {loading ? <p role="status">正在加载通知…</p> : null}
    {error ? <p role="alert" className="collaboration-error">{error}</p> : null}
    {!loading && !error && notifications.length === 0 ? <p className="collaboration-empty">暂无通知。</p> : null}
    <div className="notification-list">{notifications.map((notification) => <article className={notification.read_at ? "read" : "unread"} key={notification.id}>
      <div><strong>{notification.type}</strong><time>{new Date(notification.created_at).toLocaleString()}</time></div>
      <a href={notification.deep_link} onClick={(event) => { event.preventDefault(); void openNotification(notification); }}>打开 {notification.type}</a>
    </article>)}</div>
  </aside>;
}

export interface CollaborationCenterProps {
  client: CollaborationClient;
  workspaceId: string;
  userId: string;
  role: WorkspaceRoleContract;
  initialSection?: Section;
}

export function CollaborationCenter({ client, workspaceId, userId, role, initialSection = "people" }: CollaborationCenterProps) {
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
  const [targetType, setTargetType] = useState<"note" | "database_record">("note");
  const [targetId, setTargetId] = useState("note-1");
  const [commentBody, setCommentBody] = useState("");
  const [mentionUserIds, setMentionUserIds] = useState<string[]>([]);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [shareEntityType, setShareEntityType] = useState<"note" | "database_view">("note");
  const [shareEntityId, setShareEntityId] = useState("");
  const [sharePassword, setSharePassword] = useState("");
  const [shareExpiry, setShareExpiry] = useState("");
  const canManage = role === "owner";
  const canEdit = role !== "viewer";

  useEffect(() => {
    const controller = new AbortController();
    setBaseLoading(true);
    setError(null);
    void Promise.allSettled([
      client.listMembers(controller.signal),
      client.listInvitations(controller.signal),
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
  }, [client, workspaceId]);

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
      ? client.listComments(targetType, targetId, controller.signal).then(setComments)
      : section === "shares"
        ? client.listShares({ signal: controller.signal }).then(setShares)
        : Promise.all([client.listActivity({ limit: 50, signal: controller.signal }), client.listAudit({ limit: 50, signal: controller.signal })])
          .then(([activityPage, auditPage]) => { setActivity(activityPage.items); setAudit(auditPage.items); });
    void request.catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(collaborationErrorMessage(reason));
    }).finally(() => {
      if (!controller.signal.aborted) setSectionLoading(false);
    });
    return () => controller.abort();
  }, [client, section]);

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
    const opener = event.currentTarget.querySelector<HTMLButtonElement>("button[type='submit']");
    void run(async () => {
      const result = await client.createShare({
        entity_type: shareEntityType,
        entity_id: shareEntityId.trim(),
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
    ["activity", "活动与审计", ShieldCheck],
  ];

  return <section className="collaboration-center" aria-labelledby="collaboration-title">
    <header className="collaboration-hero">
      <div><p className="eyebrow">WORKSPACE / COLLABORATION</p><h1 id="collaboration-title">协作中心</h1><p>管理成员、讨论、公开链接与工作区安全记录。</p></div>
      <PresenceSummary status={presenceStatus} participants={participants} />
    </header>
    <nav className="collaboration-tabs" aria-label="协作中心分区">{sectionLabels.map(([id, label, Icon]) => <button className={section === id ? "active" : ""} key={id} type="button" disabled={id === "activity" && !canManage} onClick={() => setSection(id)}><Icon aria-hidden="true" size={16} />{label}</button>)}</nav>
    {baseLoading ? <p className="collaboration-loading" role="status">正在加载协作数据…</p> : null}
    {sectionLoading ? <p className="collaboration-loading">正在加载此分区…</p> : null}
    {error ? <p className="collaboration-error" role="alert">{error}</p> : null}
    {feedback ? <p className="collaboration-feedback" role="status">{feedback}</p> : null}

    {!baseLoading && section === "people" ? <div className="collaboration-grid">
      <section className="collaboration-card"><header><div><small>TEAM</small><h2>工作区成员</h2></div><span>{members.length}</span></header>
        {members.length === 0 ? <p className="collaboration-empty">当前工作区还没有其他成员。</p> : <div className="collaboration-list">{members.map((member) => <article key={member.user_id}>
          <div className="collaboration-avatar" aria-hidden="true">{member.display_name.slice(0, 1).toUpperCase()}</div>
          <div className="collaboration-person"><strong>{member.display_name}</strong><span>{member.email}</span></div>
          <label className="collaboration-role"><span className="sr-only">{member.display_name} 的角色</span><select aria-label={`${member.display_name} 的角色`} value={member.role} disabled={!canManage || pending || member.user_id === userId || member.role === "owner"} onChange={(event) => void updateMemberRole(member, event.target.value as "editor" | "viewer")}><option value="owner">所有者</option><option value="editor">编辑者</option><option value="viewer">查看者</option></select></label>
          <div className="collaboration-row-actions"><button type="button" disabled={!canManage || pending || member.user_id === userId || member.role === "owner"} onClick={() => void transferOwnership(member)}>移交所有权给 {member.display_name}</button><button className="danger" type="button" disabled={!canManage || pending || member.user_id === userId || member.role === "owner"} onClick={() => void removeMember(member)}>移除 {member.display_name}</button></div>
        </article>)}</div>}
      </section>
      <section className="collaboration-card"><header><div><small>INVITE</small><h2>待处理邀请</h2></div><span>{invitations.filter((item) => item.status === "pending").length}</span></header>
        {canManage ? <form className="collaboration-form invitation-form" onSubmit={submitInvitation}><label>邀请邮箱<input aria-label="邀请邮箱" type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label><label>邀请角色<select aria-label="邀请角色" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "editor" | "viewer")}><option value="viewer">查看者</option><option value="editor">编辑者</option></select></label><button type="submit" disabled={pending || !inviteEmail.trim()}>发送邀请</button></form> : <p className="collaboration-permission">只有所有者可以发送或撤销邀请。</p>}
        {invitations.length === 0 ? <p className="collaboration-empty">暂无待处理邀请。</p> : <div className="collaboration-list compact">{invitations.map((invitation) => <article key={invitation.id}><div className="collaboration-person"><strong>{invitation.email}</strong><span>{invitation.role} · {invitation.status}</span></div><button type="button" disabled={!canManage || pending || invitation.status !== "pending"} onClick={() => void revokeInvitation(invitation)}>撤销邀请 {invitation.email}</button></article>)}</div>}
      </section>
    </div> : null}

    {!sectionLoading && section === "comments" ? <section className="collaboration-card collaboration-comments"><header><div><small>THREAD</small><h2>评论与提及</h2></div><button type="button" disabled={!targetId.trim()} onClick={() => void run(reloadComments, "评论已刷新。")}>刷新</button></header>
      <form className="collaboration-form comment-form" onSubmit={submitComment}><label>目标类型<select value={targetType} onChange={(event) => setTargetType(event.target.value as "note" | "database_record")}><option value="note">笔记</option><option value="database_record">数据库记录</option></select></label><label>目标 ID<input aria-label="目标 ID" required value={targetId} onChange={(event) => setTargetId(event.target.value)} /></label><label className="wide">评论内容<textarea aria-label="评论内容" required value={commentBody} onFocus={() => presenceConnection.current?.sendTyping(targetType, targetId, true)} onBlur={() => presenceConnection.current?.sendTyping(targetType, targetId, false)} onChange={(event) => { setCommentBody(event.target.value); presenceConnection.current?.sendTyping(targetType, targetId, true); }} /></label><fieldset className="wide"><legend>提及成员</legend>{members.map((member) => <label className="mention-choice" key={member.user_id}><input type="checkbox" aria-label={`提及 ${member.display_name}`} checked={mentionUserIds.includes(member.user_id)} onChange={(event) => setMentionUserIds((current) => event.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))} />{member.display_name}</label>)}</fieldset><button type="submit" disabled={!canEdit || pending || !targetId.trim() || !commentBody.trim()}>发表评论</button></form>
      {comments.length === 0 ? <p className="collaboration-empty">此对象还没有评论。</p> : <div className="comment-list">{comments.map((comment) => <article key={comment.id}><header><strong>{comment.author_display_name}</strong><time>{new Date(comment.created_at).toLocaleString()}</time></header>{editingCommentId === comment.id ? <textarea aria-label={`编辑 ${comment.author_display_name} 的评论`} value={editingBody} onChange={(event) => setEditingBody(event.target.value)} /> : <p>{comment.body}</p>}<footer>{comment.mention_user_ids.length ? <span>提及 {comment.mention_user_ids.map((id) => members.find((member) => member.user_id === id)?.display_name ?? id).join("、")}</span> : <span />}{comment.author_user_id === userId ? <div>{editingCommentId === comment.id ? <button type="button" disabled={!editingBody.trim() || pending} onClick={() => void updateComment(comment)}>保存评论</button> : <button type="button" onClick={() => { setEditingCommentId(comment.id); setEditingBody(comment.body); }}>编辑评论</button>}<button className="danger" type="button" disabled={pending} onClick={() => void deleteComment(comment)}>删除评论</button></div> : null}</footer></article>)}</div>}
    </section> : null}

    {!sectionLoading && section === "shares" ? <section className="collaboration-card collaboration-shares"><header><div><small>PUBLIC ACCESS</small><h2>公开分享</h2></div><span>{shares.filter((item) => item.status === "active").length} 个有效</span></header>
      <form className="collaboration-form share-form" onSubmit={submitShare}><label>分享对象类型<select value={shareEntityType} disabled={!canEdit} onChange={(event) => setShareEntityType(event.target.value as "note" | "database_view")}><option value="note">笔记</option><option value="database_view">数据库视图</option></select></label><label>分享对象 ID<input aria-label="分享对象 ID" required disabled={!canEdit} value={shareEntityId} onChange={(event) => setShareEntityId(event.target.value)} /></label><label>分享密码<input aria-label="分享密码" type="password" minLength={8} autoComplete="new-password" disabled={!canEdit} value={sharePassword} onChange={(event) => setSharePassword(event.target.value)} /></label><label>有效小时<input aria-label="有效小时" type="number" min="1" max="8760" disabled={!canEdit} value={shareExpiry} onChange={(event) => setShareExpiry(event.target.value)} /></label><button type="submit" disabled={!canEdit || pending || !shareEntityId.trim() || Boolean(sharePassword && sharePassword.length < 8)}>创建分享</button></form>
      {shares.length === 0 ? <p className="collaboration-empty">尚未创建公开分享。</p> : <div className="share-list">{shares.map((share) => <article key={share.id}><div><strong>{share.entity_id}</strong><span>{share.entity_type} · {share.status}{share.password_required ? " · 密码保护" : ""}</span></div><button className="danger" type="button" aria-label={`撤销分享 ${share.entity_id}`} disabled={!canEdit || pending || share.status !== "active"} onClick={() => void revokeShare(share)}>撤销</button></article>)}</div>}
    </section> : null}

    {!sectionLoading && section === "activity" && canManage ? <div className="collaboration-grid"><section className="collaboration-card"><header><div><small>ACTIVITY</small><h2>活动记录</h2></div></header>{activity.length === 0 ? <p className="collaboration-empty">暂无活动记录。</p> : <div className="audit-list">{activity.map((entry) => <article key={entry.id}><header><strong>{entry.action}</strong><time>{new Date(entry.created_at).toLocaleString()}</time></header><p>{entry.target_type}{entry.target_id ? ` / ${entry.target_id}` : ""}</p><Metadata value={entry.metadata} /></article>)}</div>}</section><section className="collaboration-card"><header><div><small>AUDIT</small><h2>审计日志</h2></div></header>{audit.length === 0 ? <p className="collaboration-empty">暂无审计日志。</p> : <div className="audit-list">{audit.map((entry) => <article key={entry.id}><header><strong>{entry.action}</strong><span>{entry.outcome}</span></header><p>{entry.target_type}{entry.target_id ? ` / ${entry.target_id}` : ""}</p><Metadata value={entry.metadata} /></article>)}</div>}</section></div> : null}
    {oneTimeLink ? <OneTimeLinkDialog value={oneTimeLink} onClose={() => { setWorkbenchModalOpen(false); setOneTimeLink(null); }} /> : null}
  </section>;
}

export function NotificationButton({ unreadCount, onClick }: { unreadCount: number; onClick(): void }) {
  return <button className="notification-button" type="button" aria-label={`通知，${unreadCount} 条未读`} onClick={onClick}><Bell aria-hidden="true" size={18} />{unreadCount > 0 ? <span>{unreadCount}</span> : null}</button>;
}
