import type { WorkspaceMember, WorkspaceMembershipSummary } from "@nexus/contracts";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWorkbenchModalState } from "../layout/AdaptiveWorkbench";
import type { CollaborationClientLike } from "./index";

const focusableSelector = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";
const roleLabels = { owner: "所有者", editor: "编辑者", viewer: "查看者" } as const;

function isAbort(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

export interface WorkspacePanelProps {
  workspaces: WorkspaceMembershipSummary[];
  activeWorkspaceId: string | null;
  client?: CollaborationClientLike;
  currentUserId?: string;
  onWorkspaceChange(workspaceId: string): void | Promise<void>;
  onCreateWorkspace?(name: string): Promise<WorkspaceMembershipSummary> | void;
}

function workspaceCreateError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "WORKSPACE_QUOTA_EXCEEDED") return "已达到工作区上限（每个账户最多 2 个）。";
  if (code === "WORKSPACE_INPUT_INVALID") return "工作区名称无效，请输入 1 到 160 个字符。";
  if (code === "WORKSPACE_CREATED_SESSION_REFRESH_FAILED") return "工作区已创建，但登录状态刷新失败。请刷新页面后再继续，避免重复创建。";
  return "创建工作区失败，请检查网络后重试。";
}

export function WorkspacePanel({ workspaces, activeWorkspaceId, client, currentUserId, onWorkspaceChange, onCreateWorkspace }: WorkspacePanelProps) {
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const canManage = activeWorkspace?.role === "owner" && Boolean(client);
  const [switchPendingId, setSwitchPendingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersRetry, setMembersRetry] = useState(0);
  const [memberPending, setMemberPending] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberStatus, setMemberStatus] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("viewer");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [workspaceCreatePending, setWorkspaceCreatePending] = useState(false);
  const [workspaceCreateErrorMessage, setWorkspaceCreateErrorMessage] = useState<string | null>(null);
  const [workspaceCreateStatus, setWorkspaceCreateStatus] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<WorkspaceMember | null>(null);
  const mountedRef = useRef(true);
  const switchPendingRef = useRef(false);
  const loadVersionRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const mutationVersionRef = useRef(0);
  const mutationControllerRef = useRef<AbortController | null>(null);
  const mutationPendingRef = useRef(false);
  const removePendingRef = useRef(false);
  const removeOriginRef = useRef<HTMLButtonElement | null>(null);
  const removeDialogRef = useRef<HTMLDivElement | null>(null);
  const removeCancelRef = useRef<HTMLButtonElement | null>(null);
  const membersHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const pendingFocusRef = useRef<HTMLElement | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const setWorkbenchModalOpen = useWorkbenchModalState();
  removePendingRef.current = memberPending?.startsWith("remove:") ?? false;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const version = ++loadVersionRef.current;
    loadControllerRef.current?.abort();
    setMembers([]);
    setMembersError(null);
    setMemberError(null);
    setMemberStatus(null);
    if (!canManage || !client) {
      setMembersLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setMembersLoading(true);
    void client.listMembers(controller.signal).then((next) => {
      if (version === loadVersionRef.current && !controller.signal.aborted) setMembers(next);
    }).catch((error: unknown) => {
      if (version === loadVersionRef.current && !isAbort(error, controller.signal)) setMembersError("成员加载失败，请重试。");
    }).finally(() => {
      if (version === loadVersionRef.current && !controller.signal.aborted) setMembersLoading(false);
    });
    return () => controller.abort();
  }, [activeWorkspaceId, canManage, client, membersRetry]);

  useEffect(() => {
    mutationVersionRef.current += 1;
    mutationControllerRef.current?.abort();
    mutationControllerRef.current = null;
    mutationPendingRef.current = false;
    removePendingRef.current = false;
    setMemberPending(null);
    setRemoveTarget(null);
    return () => {
      mutationVersionRef.current += 1;
      mutationControllerRef.current?.abort();
      mutationControllerRef.current = null;
      mutationPendingRef.current = false;
      removePendingRef.current = false;
    };
  }, [activeWorkspaceId, client]);

  useLayoutEffect(() => {
    if (!removeTarget) return undefined;
    setWorkbenchModalOpen(true);
    removeCancelRef.current?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!removePendingRef.current) closeRemoveDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = removeDialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
      if (focusable.length === 0) return;
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1
        : activeIndex < 0 || activeIndex === focusable.length - 1 ? 0 : activeIndex + 1;
      event.preventDefault();
      focusable[nextIndex]!.focus();
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      setWorkbenchModalOpen(false);
    };
  }, [removeTarget]);

  useLayoutEffect(() => {
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
    if (removeTarget) {
      pendingFocusRef.current = null;
      return undefined;
    }
    const target = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (!target) return undefined;
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      if (!mountedRef.current || !target.isConnected || target.closest("[inert]")) return;
      target.focus();
    });
    return () => {
      if (focusFrameRef.current !== null) {
        cancelAnimationFrame(focusFrameRef.current);
        focusFrameRef.current = null;
      }
    };
  }, [removeTarget]);

  const switchWorkspace = (workspaceId: string) => {
    if (workspaceId === activeWorkspaceId || switchPendingRef.current) return;
    switchPendingRef.current = true;
    setSwitchPendingId(workspaceId);
    setSwitchError(null);
    void Promise.resolve().then(() => onWorkspaceChange(workspaceId)).catch(() => {
      if (mountedRef.current) setSwitchError("切换工作区失败，当前工作区未改变。请重试。");
    }).finally(() => {
      switchPendingRef.current = false;
      if (mountedRef.current) setSwitchPendingId(null);
    });
  };

  const createWorkspace = (event: React.FormEvent) => {
    event.preventDefault();
    const name = newWorkspaceName.trim();
    if (!onCreateWorkspace || !name || workspaceCreatePending) return;
    setWorkspaceCreatePending(true);
    setWorkspaceCreateErrorMessage(null);
    setWorkspaceCreateStatus(null);
    void Promise.resolve(onCreateWorkspace(name)).then((workspace) => {
      if (!mountedRef.current) return;
      setNewWorkspaceName("");
      setWorkspaceCreateStatus(workspace ? `已创建工作区：${workspace.name}` : "工作区已创建。");
    }).catch((error: unknown) => {
      if (mountedRef.current) setWorkspaceCreateErrorMessage(workspaceCreateError(error));
    }).finally(() => {
      if (mountedRef.current) setWorkspaceCreatePending(false);
    });
  };

  const beginMutation = (key: string) => {
    if (!client || mutationPendingRef.current) return null;
    mutationPendingRef.current = true;
    removePendingRef.current = key.startsWith("remove:");
    const version = ++mutationVersionRef.current;
    ++loadVersionRef.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    mutationControllerRef.current?.abort();
    mutationControllerRef.current = controller;
    setMembersLoading(false);
    setMemberPending(key);
    setMemberError(null);
    setMemberStatus(null);
    return { version, controller };
  };

  const updateRole = (member: WorkspaceMember, role: "editor" | "viewer") => {
    const mutation = beginMutation(`role:${member.user_id}`);
    if (!mutation || !client) return;
    void client.updateMemberRole(member.user_id, { role, base_revision: member.revision }, mutation.controller.signal).then((updated) => {
      if (mutation.version !== mutationVersionRef.current || mutation.controller.signal.aborted) return;
      setMembers((current) => current.map((candidate) => candidate.user_id === updated.user_id ? updated : candidate));
      setMemberStatus(`${updated.display_name} 的角色已更新。`);
    }).catch((error: unknown) => {
      if (mutation.version === mutationVersionRef.current && !isAbort(error, mutation.controller.signal)) setMemberError("更新成员角色失败，成员角色未改变。请重试。");
    }).finally(() => {
      if (mutation.version === mutationVersionRef.current && !mutation.controller.signal.aborted) {
        mutationPendingRef.current = false;
        setMemberPending(null);
      }
    });
  };

  function closeRemoveDialog(focus: "origin" | "fallback" = "origin", preserveError = false) {
    pendingFocusRef.current = focus === "origin" ? removeOriginRef.current : membersHeadingRef.current;
    setRemoveTarget(null);
    if (!preserveError) setMemberError(null);
  }

  const removeMember = () => {
    if (!removeTarget || !client) return;
    const target = removeTarget;
    const mutation = beginMutation(`remove:${target.user_id}`);
    if (!mutation) return;
    void client.removeMember(target.user_id, target.revision, mutation.controller.signal).then(() => {
      if (mutation.version !== mutationVersionRef.current || mutation.controller.signal.aborted) return;
      setMembers((current) => current.filter((member) => member.user_id !== target.user_id));
      setMemberStatus(`${target.display_name} 已移除。`);
      closeRemoveDialog("fallback");
    }).catch((error: unknown) => {
      if (mutation.version === mutationVersionRef.current && !isAbort(error, mutation.controller.signal)) {
        setMemberError("移除成员失败，成员仍保留在工作区。请重试。");
        closeRemoveDialog("origin", true);
      }
    }).finally(() => {
      if (mutation.version === mutationVersionRef.current && !mutation.controller.signal.aborted) {
        mutationPendingRef.current = false;
        removePendingRef.current = false;
        setMemberPending(null);
      }
    });
  };

  const invite = (event: React.FormEvent) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || !client) return;
    const mutation = beginMutation("invite");
    if (!mutation) return;
    void client.createInvitation({ email, role: inviteRole, expires_in_hours: 72 }, mutation.controller.signal).then(() => {
      if (mutation.version !== mutationVersionRef.current || mutation.controller.signal.aborted) return;
      setInviteEmail("");
      setMemberStatus(`已向 ${email} 发送邀请。`);
    }).catch((error: unknown) => {
      if (mutation.version === mutationVersionRef.current && !isAbort(error, mutation.controller.signal)) setMemberError("发送邀请失败，请检查邮箱和权限后重试。");
    }).finally(() => {
      if (mutation.version === mutationVersionRef.current && !mutation.controller.signal.aborted) {
        mutationPendingRef.current = false;
        setMemberPending(null);
      }
    });
  };

  const removeDialog = removeTarget ? createPortal(
    <div className="account-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !removePendingRef.current) closeRemoveDialog(); }}>
      <div ref={removeDialogRef} className="account-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-member-heading">
        <h3 id="remove-member-heading">确认移除成员</h3>
        <p>移除后，{removeTarget.display_name} 将无法再访问 {activeWorkspace?.name ?? "此工作区"}。</p>
        {memberError ? <p className="account-error" role="alert">{memberError}</p> : null}
        <div className="account-actions"><button ref={removeCancelRef} type="button" disabled={removePendingRef.current} onClick={() => closeRemoveDialog()}>取消移除</button><button type="button" disabled={removePendingRef.current} onClick={removeMember}>{removePendingRef.current ? "正在移除…" : "确认移除"}</button></div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <section id="account-panel-workspace" role="tabpanel" aria-labelledby="account-tab-workspace" className="account-panel">
      <div className="account-panel-heading"><div><p className="eyebrow">WORKSPACE</p><h2>工作区</h2><p>切换工作区并查看你在每个空间中的权限。</p></div></div>
      {onCreateWorkspace ? <form className="account-form account-workspace-create-form" aria-label="创建工作区" onSubmit={createWorkspace}>
        <label>新工作区名称<input aria-label="新工作区名称" required maxLength={160} value={newWorkspaceName} disabled={workspaceCreatePending} onChange={(event) => setNewWorkspaceName(event.target.value)} /></label>
        <button type="submit" disabled={workspaceCreatePending || !newWorkspaceName.trim()}>{workspaceCreatePending ? "正在创建…" : "创建工作区"}</button>
        {workspaceCreateErrorMessage ? <p className="account-error" role="alert">{workspaceCreateErrorMessage}</p> : null}
        {workspaceCreateStatus ? <p className="account-status" role="status">{workspaceCreateStatus}</p> : null}
      </form> : null}
      <ul className="account-workspace-list" aria-label="工作区列表">
        {workspaces.map((workspace) => {
          const active = workspace.id === activeWorkspaceId;
          return <li key={workspace.id} aria-label={`${workspace.name} ${roleLabels[workspace.role]}${active ? " 当前工作区" : ""}`} className="account-workspace-row" data-active={active || undefined}>
            <div><strong>{workspace.name}</strong><span>{roleLabels[workspace.role]} · /{workspace.slug}</span></div>
            {active ? <span className="account-session-badge">当前工作区</span> : <button type="button" disabled={switchPendingId !== null} onClick={() => switchWorkspace(workspace.id)}>{switchPendingId === workspace.id ? "正在切换…" : `切换到 ${workspace.name}`}</button>}
          </li>;
        })}
      </ul>
      {workspaces.length === 0 ? <p className="account-muted">当前会话没有可用工作区。</p> : null}
      {switchError ? <p className="account-error" role="alert">{switchError}</p> : null}
      {activeWorkspace && !canManage ? <p className="account-muted">{activeWorkspace.role === "editor" ? "你在此工作区拥有编辑权限，只有所有者可以管理成员。" : "你在此工作区拥有查看权限，只有所有者可以管理成员。"}</p> : null}
      {canManage ? <section className="account-subpanel" aria-labelledby="members-heading">
        <div className="account-subpanel-heading"><h3 id="members-heading" ref={membersHeadingRef} tabIndex={-1}>成员管理</h3><button type="button" disabled={membersLoading || memberPending !== null} onClick={() => setMembersRetry((value) => value + 1)}>刷新成员</button></div>
        {membersLoading ? <p className="account-inline-status" role="status">正在加载成员…</p> : null}
        {membersError ? <div className="account-error-row"><p role="alert">{membersError}</p><button type="button" onClick={() => setMembersRetry((value) => value + 1)}>重试成员加载</button></div> : null}
        <ul className="account-member-list" aria-label="工作区成员">
          {members.map((member) => {
            const protectedMember = member.user_id === currentUserId || member.role === "owner";
            return <li key={member.user_id} className="account-member-row"><div><strong>{member.display_name}</strong><span>{member.email}</span></div><select aria-label={`${member.display_name} 的角色`} value={member.role} disabled={protectedMember || memberPending !== null} onChange={(event) => updateRole(member, event.target.value as "editor" | "viewer")}><option value="owner">所有者</option><option value="editor">编辑者</option><option value="viewer">查看者</option></select><button type="button" className="account-danger-button" disabled={protectedMember || memberPending !== null} onClick={(event) => { removeOriginRef.current = event.currentTarget; setMemberError(null); setRemoveTarget(member); }}>移除 {member.display_name}</button></li>;
          })}
        </ul>
        <form className="account-form account-invite-form" onSubmit={invite}><label>邀请邮箱<input type="email" required value={inviteEmail} disabled={memberPending !== null} onChange={(event) => setInviteEmail(event.target.value)} /></label><label>邀请角色<select value={inviteRole} disabled={memberPending !== null} onChange={(event) => setInviteRole(event.target.value as "editor" | "viewer")}><option value="viewer">查看者</option><option value="editor">编辑者</option></select></label><button type="submit" disabled={memberPending !== null || !inviteEmail.trim()}>{memberPending === "invite" ? "正在发送…" : "发送邀请"}</button></form>
        {memberError && !removeTarget ? <p className="account-error" role="alert">{memberError}</p> : null}
        {memberStatus ? <p className="account-status" role="status">{memberStatus}</p> : null}
      </section> : null}
      {removeDialog}
    </section>
  );
}
