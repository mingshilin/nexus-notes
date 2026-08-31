import type {
  CollaborationComment,
  PresenceParticipant,
  PublicShare,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceRoleContract,
} from "@nexus/contracts";
import { Link2, MessageSquare, ShieldCheck, Users, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import type { CollaborationClient, PresenceConnection } from "../data/collaboration-client";
import { useWorkbenchModalState } from "../layout/AdaptiveWorkbench";
import { ModalDialog } from "./CollaborationModal";
import {
  collaborationErrorMessage,
  type CollaborationCommentTarget,
  type CollaborationShareTarget,
} from "./collaboration-types";
import {
  invalidateCollaborationCache,
  useCollaborationCenterData,
  type CollaborationCacheInvalidation,
  type CollaborationCacheResource,
  type CollaborationSection,
} from "./use-collaboration-center-data";

type Section = CollaborationSection;
type PresenceStatus = "connecting" | "connected" | "unavailable";
type OneTimeLink = { kind: "invitation" | "share"; url: string; opener: HTMLElement | null; scopeKey: string };
type ActiveCommand = CollaborationCacheInvalidation;

const sensitiveMetadataKey = /(content|password|token|code|cookie|authorization|attachment.*bytes|body|secret)/iu;

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

function interactionScopeKey(section: Section, commentTargetKey: string, shareTargetKey: string) {
  return `${section}|${commentTargetKey}|${shareTargetKey}`;
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
  const [commandError, setCommandError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
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
  const data = useCollaborationCenterData({
    client,
    cacheScope: `${userId}:${workspaceId}`,
    canManage,
    canEdit,
    section,
    commentTarget,
  });
  const { members, invitations, comments, shares, activity, audit, baseLoading, sectionLoading, refreshing } = data;
  const error = commandError ?? data.error;
  const commandControllerRef = useRef<AbortController | null>(null);
  const commandVersionRef = useRef(0);
  const presenceVersionRef = useRef(0);
  const scopeRef = useRef({ client, workspaceId, userId, canManage, canEdit });
  const interactionScopeRef = useRef({ section, commentTargetKey, shareTargetKey });
  const activeCommandRef = useRef<ActiveCommand | null>(null);
  const pendingOneTimeLinksRef = useRef(new Map<string, OneTimeLink>());
  const oneTimeLinkScopeRef = useRef<string | null>(null);
  const currentInteractionKey = interactionScopeKey(section, commentTargetKey, shareTargetKey);

  useLayoutEffect(() => {
    const previousLinkScope = oneTimeLinkScopeRef.current;
    if (previousLinkScope && previousLinkScope !== currentInteractionKey) {
      oneTimeLinkScopeRef.current = null;
      setOneTimeLink(null);
      setWorkbenchModalOpen(false);
    }
    interactionScopeRef.current = { section, commentTargetKey, shareTargetKey };
  }, [commentTargetKey, currentInteractionKey, section, setWorkbenchModalOpen, shareTargetKey]);

  useEffect(() => {
    const pendingLink = pendingOneTimeLinksRef.current.get(currentInteractionKey);
    if (!pendingLink || oneTimeLinkScopeRef.current === currentInteractionKey) return;
    oneTimeLinkScopeRef.current = currentInteractionKey;
    setOneTimeLink(pendingLink);
    setWorkbenchModalOpen(true);
  }, [currentInteractionKey, setWorkbenchModalOpen]);

  useLayoutEffect(() => {
    if (scopeRef.current.client === client
      && scopeRef.current.workspaceId === workspaceId
      && scopeRef.current.userId === userId
      && scopeRef.current.canManage === canManage
      && scopeRef.current.canEdit === canEdit) return;
    const activeCommand = activeCommandRef.current;
    if (activeCommand) invalidateCollaborationCache(activeCommand);
    activeCommandRef.current = null;
    scopeRef.current = { client, workspaceId, userId, canManage, canEdit };
    commandVersionRef.current += 1;
    commandControllerRef.current?.abort();
    commandControllerRef.current = null;
    pendingRef.current = false;
    setPending(false);
    setCommandError(null);
    setFeedback(null);
    setOneTimeLink(null);
    oneTimeLinkScopeRef.current = null;
    pendingOneTimeLinksRef.current.clear();
    setWorkbenchModalOpen(false);
    setInviteEmail("");
    setCommentBody("");
    setMentionUserIds([]);
    setEditingCommentId(null);
    setEditingBody("");
    setSharePassword("");
    setShareExpiry("");
  }, [canEdit, canManage, client, setWorkbenchModalOpen, userId, workspaceId]);

  useEffect(() => setSection(initialSection), [initialSection]);

  useEffect(() => {
    const preferred = commentTargets.find((target) => activeTarget && target.type === activeTarget.type && target.id === activeTarget.id);
    if (preferred) setCommentTargetKey(targetKey(preferred));
    else if (!commentTargets.some((target) => targetKey(target) === commentTargetKey)) setCommentTargetKey(commentTargets[0] ? targetKey(commentTargets[0]) : "");
  }, [activeTarget, commentTargetKey, commentTargets]);

  useEffect(() => {
    const preferred = shareTargets.find((target) => activeTarget && target.type === activeTarget.type && target.id === activeTarget.id);
    if (preferred) setShareTargetKey(targetKey(preferred));
    else if (!shareTargets.some((target) => targetKey(target) === shareTargetKey)) setShareTargetKey(shareTargets[0] ? targetKey(shareTargets[0]) : "");
  }, [activeTarget, shareTargetKey, shareTargets]);

  useEffect(() => () => setWorkbenchModalOpen(false), [setWorkbenchModalOpen]);

  useEffect(() => () => {
    const activeCommand = activeCommandRef.current;
    if (activeCommand) invalidateCollaborationCache(activeCommand);
    activeCommandRef.current = null;
    commandVersionRef.current += 1;
    commandControllerRef.current?.abort();
    commandControllerRef.current = null;
    pendingOneTimeLinksRef.current.clear();
    oneTimeLinkScopeRef.current = null;
  }, []);

  useEffect(() => {
    const presenceVersion = ++presenceVersionRef.current;
    const requestClient = client;
    const requestWorkspaceId = workspaceId;
    const requestUserId = userId;
    const isCurrentPresence = () => presenceVersionRef.current === presenceVersion
      && scopeRef.current.client === requestClient
      && scopeRef.current.workspaceId === requestWorkspaceId
      && scopeRef.current.userId === requestUserId;
    setPresenceStatus("connecting");
    setParticipants([]);
    const connection = client.connectPresence({
      onStatus: (status) => { if (isCurrentPresence()) setPresenceStatus(status); },
      onParticipants: (next) => { if (isCurrentPresence()) setParticipants(next); },
    });
    presenceConnection.current = connection;
    connection.sendPresence("active");
    return () => {
      if (presenceVersionRef.current === presenceVersion) presenceVersionRef.current += 1;
      connection.disconnect();
      presenceConnection.current = null;
    };
  }, [client, userId, workspaceId]);

  const run = async (command: (signal: AbortSignal, isCurrent: () => boolean) => Promise<boolean | void>, success: string, resource?: { resource: CollaborationCacheResource; commentTarget?: Pick<CollaborationCommentTarget, "type" | "id"> }) => {
    if (pendingRef.current) return;
    const requestClient = client;
    const requestWorkspaceId = workspaceId;
    const requestUserId = userId;
    const requestCanManage = canManage;
    const requestCanEdit = canEdit;
    const requestInteractionScope = interactionScopeRef.current;
    const commandScope: ActiveCommand | null = resource ? {
      client: requestClient,
      cacheScope: `${requestUserId}:${requestWorkspaceId}`,
      canManage: requestCanManage,
      canEdit: requestCanEdit,
      resource: resource.resource,
      commentTarget: resource.commentTarget,
    } : null;
    const version = ++commandVersionRef.current;
    const controller = new AbortController();
    commandControllerRef.current?.abort();
    commandControllerRef.current = controller;
    activeCommandRef.current = commandScope;
    pendingRef.current = true;
    setPending(true);
    setCommandError(null);
    setFeedback(null);
    const isCurrentWorkspace = () => !controller.signal.aborted
      && commandVersionRef.current === version
      && scopeRef.current.client === requestClient
      && scopeRef.current.workspaceId === requestWorkspaceId
      && scopeRef.current.userId === requestUserId
      && scopeRef.current.canManage === requestCanManage
      && scopeRef.current.canEdit === requestCanEdit;
    const isCurrent = () => isCurrentWorkspace()
      && interactionScopeRef.current.section === requestInteractionScope.section
      && interactionScopeRef.current.commentTargetKey === requestInteractionScope.commentTargetKey
      && interactionScopeRef.current.shareTargetKey === requestInteractionScope.shareTargetKey;
    try {
      const committed = await command(controller.signal, isCurrent);
      if (isCurrent() && committed !== false) setFeedback(success);
    } catch (reason) {
      if (isCurrent()) setCommandError(collaborationErrorMessage(reason));
    } finally {
      const ownsController = commandControllerRef.current === controller;
      if (ownsController) commandControllerRef.current = null;
      if (activeCommandRef.current === commandScope) activeCommandRef.current = null;
      if (ownsController && isCurrentWorkspace()) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  };

  const updateMemberRole = (member: WorkspaceMember, nextRole: "editor" | "viewer") => run(async (signal) => {
    const updated = await client.updateMemberRole(member.user_id, { role: nextRole, base_revision: member.revision }, signal);
    return data.setMembers((current) => current.map((item) => item.user_id === updated.user_id ? updated : item));
  }, "成员角色已更新。", { resource: "members" });

  const removeMember = (member: WorkspaceMember) => run(async (signal) => {
    await client.removeMember(member.user_id, member.revision, signal);
    return data.setMembers((current) => current.filter((item) => item.user_id !== member.user_id));
  }, "成员已移除。", { resource: "members" });

  const transferOwnership = (member: WorkspaceMember) => run(async (signal) => {
    const updated = await client.transferOwnership(member.user_id, member.revision, signal);
    return data.setMembers((current) => current.map((item) => item.user_id === updated.user_id ? updated : item));
  }, "所有权已移交。", { resource: "members" });

  const submitInvitation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const opener = event.currentTarget.querySelector<HTMLButtonElement>("button[type='submit']");
    void run(async (signal, isCurrent) => {
      const result = await client.createInvitation({ email: inviteEmail.trim(), role: inviteRole, expires_in_hours: 72 }, signal);
      if (!data.setInvitations((current) => upsertById(current, result.invitation))) return false;
      const link: OneTimeLink = { kind: "invitation", url: oneTimeUrl("invitation", result.token), opener, scopeKey: currentInteractionKey };
      pendingOneTimeLinksRef.current.set(link.scopeKey, link);
      if (!isCurrent()) return false;
      setInviteEmail("");
      setWorkbenchModalOpen(true);
      oneTimeLinkScopeRef.current = link.scopeKey;
      setOneTimeLink(link);
      return true;
    }, "邀请已创建。", { resource: "invitations" });
  };

  const revokeInvitation = (invitation: WorkspaceInvitation) => run(async (signal) => {
    const updated = await client.revokeInvitation(invitation.id, invitation.revision, signal);
    return data.setInvitations((current) => current.map((item) => item.id === updated.id ? updated : item));
  }, "邀请已撤销。", { resource: "invitations" });

  const retryError = data.sectionError
    ? data.retrySection
    : data.baseError
      ? data.retryBase
      : null;

  const submitComment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async (signal, isCurrent) => {
      const created = await client.createComment({
        target_type: targetType,
        target_id: targetId.trim(),
        body: commentBody.trim(),
        mention_user_ids: mentionUserIds,
        idempotency_key: commandId(),
      }, signal);
      if (!data.setComments((current) => upsertById(current, created))) return false;
      if (!isCurrent()) return false;
      setCommentBody("");
      setMentionUserIds([]);
      presenceConnection.current?.sendTyping(targetType, targetId, false);
      return true;
    }, "评论已发表。", { resource: "comments", commentTarget });
  };

  const updateComment = (comment: CollaborationComment) => run(async (signal, isCurrent) => {
    const updated = await client.updateComment(comment.id, { body: editingBody.trim(), mention_user_ids: comment.mention_user_ids, base_revision: comment.revision }, signal);
    if (!data.setComments((current) => current.map((item) => item.id === updated.id ? updated : item))) return false;
    if (!isCurrent()) return false;
    setEditingCommentId(null);
    setEditingBody("");
    return true;
  }, "评论已更新。", { resource: "comments", commentTarget });

  const deleteComment = (comment: CollaborationComment) => run(async (signal) => {
    await client.deleteComment(comment.id, comment.revision, signal);
    return data.setComments((current) => current.filter((item) => item.id !== comment.id));
  }, "评论已删除。", { resource: "comments", commentTarget });

  const submitShare = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!shareTarget) return;
    const opener = event.currentTarget.querySelector<HTMLButtonElement>("button[type='submit']");
    void run(async (signal, isCurrent) => {
      const result = await client.createShare({
        entity_type: shareTarget.type,
        entity_id: shareTarget.id,
        ...(sharePassword ? { password: sharePassword } : {}),
        ...(shareExpiry ? { expires_in_hours: Number(shareExpiry) } : {}),
      }, signal);
      if (!data.setShares((current) => upsertById(current, result.share))) return false;
      const link: OneTimeLink = { kind: "share", url: oneTimeUrl("share", result.token), opener, scopeKey: currentInteractionKey };
      pendingOneTimeLinksRef.current.set(link.scopeKey, link);
      if (!isCurrent()) return false;
      setSharePassword("");
      setShareExpiry("");
      setWorkbenchModalOpen(true);
      oneTimeLinkScopeRef.current = link.scopeKey;
      setOneTimeLink(link);
      return true;
    }, "公开分享已创建。", { resource: "shares" });
  };

  const revokeShare = (share: PublicShare) => run(async (signal) => {
    const updated = await client.revokeShare(share.id, share.revision, signal);
    return data.setShares((current) => current.map((item) => item.id === updated.id ? updated : item));
  }, "公开分享已撤销。", { resource: "shares" });

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
    {error ? <div className="collaboration-error-row"><p className="collaboration-error" role="alert">{error}</p>{retryError ? <button type="button" onClick={retryError} disabled={pending}>重试协作数据</button> : null}</div> : null}
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

    {section === "comments" ? <section className="collaboration-card collaboration-comments"><header><div><small>THREAD</small><h2>评论与提及</h2></div><button type="button" disabled={!commentTarget || sectionLoading || refreshing} onClick={data.retrySection}>刷新</button></header>
      <label className="collaboration-target-select">评论目标<select aria-label="评论目标" value={commentTargetKey} disabled={!commentTargets.length} onChange={(event) => setCommentTargetKey(event.target.value)}>{commentTargets.map((target) => <option key={targetKey(target)} value={targetKey(target)}>{target.label}</option>)}</select></label>
      {!commentTarget ? <p className="collaboration-empty">请先在笔记或数据库中选择可评论对象。</p> : null}
      {canEdit && commentTarget ? <form className="collaboration-form comment-form" onSubmit={submitComment}><label className="wide">评论内容<textarea aria-label="评论内容" required value={commentBody} onFocus={() => presenceConnection.current?.sendTyping(targetType, targetId, true)} onBlur={() => presenceConnection.current?.sendTyping(targetType, targetId, false)} onChange={(event) => { setCommentBody(event.target.value); presenceConnection.current?.sendTyping(targetType, targetId, true); }} /></label><fieldset className="wide"><legend>提及成员</legend>{members.map((member) => <label className="mention-choice" key={member.user_id}><input type="checkbox" aria-label={`提及 ${member.display_name}`} checked={mentionUserIds.includes(member.user_id)} onChange={(event) => setMentionUserIds((current) => event.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))} />{member.display_name}</label>)}</fieldset><button type="submit" disabled={pending || !commentBody.trim()}>发表评论</button></form> : null}
      {commentTarget && comments.length === 0 ? <p className="collaboration-empty">此对象还没有评论。</p> : null}
      {commentTarget && comments.length > 0 ? <div className="comment-list">{comments.map((comment) => <article key={comment.id} aria-current={comment.id === selectedCommentId ? "true" : undefined}><header><strong>{comment.author_display_name}</strong><time>{new Date(comment.created_at).toLocaleString()}</time></header>{editingCommentId === comment.id ? <textarea aria-label={`编辑 ${comment.author_display_name} 的评论`} value={editingBody} onChange={(event) => setEditingBody(event.target.value)} /> : <p>{comment.body}</p>}<footer>{comment.mention_user_ids.length ? <span>提及 {comment.mention_user_ids.map((id) => members.find((member) => member.user_id === id)?.display_name ?? id).join("、")}</span> : <span />}{canEdit && (canManage || comment.author_user_id === userId) ? <div>{editingCommentId === comment.id ? <button type="button" disabled={!editingBody.trim() || pending} onClick={() => void updateComment(comment)}>保存评论</button> : <button type="button" onClick={() => { setEditingCommentId(comment.id); setEditingBody(comment.body); }}>编辑评论</button>}<button className="danger" type="button" disabled={pending} onClick={() => void deleteComment(comment)}>删除评论</button></div> : null}</footer></article>)}</div> : null}
    </section> : null}

    {section === "shares" ? <section className="collaboration-card collaboration-shares"><header><div><small>PUBLIC ACCESS</small><h2>公开分享</h2></div><span>{shares.filter((item) => item.status === "active").length} 个有效</span></header>
      {!canEdit ? <p className="collaboration-permission">查看者无法访问公开分享管理。</p> : null}
      {canEdit ? <form className="collaboration-form share-form" onSubmit={submitShare}><label>分享对象<select aria-label="分享对象" value={shareTargetKey} disabled={!shareTargets.length} onChange={(event) => setShareTargetKey(event.target.value)}>{shareTargets.map((target) => <option key={targetKey(target)} value={targetKey(target)}>{target.label}</option>)}</select></label><label>分享密码<input aria-label="分享密码" type="password" minLength={8} autoComplete="new-password" value={sharePassword} onChange={(event) => setSharePassword(event.target.value)} /></label><label>有效小时<input aria-label="有效小时" type="number" min="1" max="8760" value={shareExpiry} onChange={(event) => setShareExpiry(event.target.value)} /></label><button type="submit" disabled={pending || !shareTarget || Boolean(sharePassword && sharePassword.length < 8)}>创建分享</button></form> : null}
      {shares.length === 0 ? <p className="collaboration-empty">尚未创建公开分享。</p> : <div className="share-list">{shares.map((share) => <article key={share.id}><div><strong>{share.entity_id}</strong><span>{share.entity_type} · {share.status}{share.password_required ? " · 密码保护" : ""}</span></div><button className="danger" type="button" aria-label={`撤销分享 ${share.entity_id}`} disabled={!canEdit || pending || share.status !== "active"} onClick={() => void revokeShare(share)}>撤销</button></article>)}</div>}
    </section> : null}

    {section === "activity" ? <div className="collaboration-grid"><section className="collaboration-card"><header><div><small>ACTIVITY</small><h2>活动记录</h2></div></header>{activity.length === 0 ? <p className="collaboration-empty">暂无活动记录。</p> : <div className="audit-list">{activity.map((entry) => <article key={entry.id}><header><strong>{entry.action}</strong><time>{new Date(entry.created_at).toLocaleString()}</time></header><p>{entry.target_type}{entry.target_id ? ` / ${entry.target_id}` : ""}</p><Metadata value={entry.metadata} /></article>)}</div>}</section>{canManage ? <section className="collaboration-card"><header><div><small>AUDIT</small><h2>审计日志</h2></div></header>{audit.length === 0 ? <p className="collaboration-empty">暂无审计日志。</p> : <div className="audit-list">{audit.map((entry) => <article key={entry.id}><header><strong>{entry.action}</strong><span>{entry.outcome}</span></header><p>{entry.target_type}{entry.target_id ? ` / ${entry.target_id}` : ""}</p><Metadata value={entry.metadata} /></article>)}</div>}</section> : null}</div> : null}
    {oneTimeLink ? <OneTimeLinkDialog value={oneTimeLink} onClose={() => { pendingOneTimeLinksRef.current.delete(oneTimeLink.scopeKey); oneTimeLinkScopeRef.current = null; setOneTimeLink(null); setWorkbenchModalOpen(false); }} /> : null}
  </section>;
}
