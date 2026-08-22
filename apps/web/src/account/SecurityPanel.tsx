import {
  ChangePasswordInputSchema,
  ConfirmEmailChangeInputSchema,
  RequestEmailChangeInputSchema,
  type AccountSession,
  type Profile,
} from "@nexus/contracts";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWorkbenchModalState } from "../layout/AdaptiveWorkbench";
import type { ProfileClientLike } from "./index";

const focusableSelector = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

export interface SecurityPanelProps {
  client: ProfileClientLike;
  profile: Profile | null;
  sessions: AccountSession[];
  loading: boolean;
  error: string | null;
  onRetry(): void;
  onSessionsRefresh(): void;
  onSessionRevokeStart(): void;
  onSessionRevokeFailed(): void;
  onSessionRevoked(sessionId: string): void;
  onProfileChange(profile: Profile): void;
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function SecurityPanel({ client, profile, sessions, loading, error, onRetry, onSessionsRefresh, onSessionRevokeStart, onSessionRevokeFailed, onSessionRevoked, onProfileChange }: SecurityPanelProps) {
  const [newEmail, setNewEmail] = useState("");
  const [requestedEmail, setRequestedEmail] = useState<string | null>(null);
  const [emailPassword, setEmailPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailStep, setEmailStep] = useState<"request" | "confirm">("request");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [passwordNew, setPasswordNew] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"email-request" | "email-confirm" | "password" | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AccountSession | null>(null);
  const [revokePending, setRevokePending] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const revokeOriginRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dialogCancelRef = useRef<HTMLButtonElement | null>(null);
  const sessionsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const pendingFocusRef = useRef<HTMLElement | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const revokePendingRef = useRef(false);
  const setWorkbenchModalOpen = useWorkbenchModalState();
  revokePendingRef.current = revokePending;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useLayoutEffect(() => {
    if (!revokeTarget) return undefined;
    setWorkbenchModalOpen(true);
    dialogCancelRef.current?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!revokePendingRef.current) closeRevokeDialog("origin");
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
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
  }, [revokeTarget]);

  useLayoutEffect(() => {
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
    if (revokeTarget) {
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
  }, [revokeTarget]);

  const requestEmail = () => {
    if (pendingAction) return;
    const parsed = RequestEmailChangeInputSchema.safeParse({ new_email: normalizeEmail(newEmail), current_password: emailPassword });
    if (!parsed.success) {
      setEmailError("邮箱变更输入无效，请检查新邮箱和当前密码。");
      setEmailStatus(null);
      return;
    }
    setPendingAction("email-request");
    setEmailError(null);
    setEmailStatus(null);
    void Promise.resolve().then(() => client.requestEmailChange(parsed.data)).then(() => {
      if (!mountedRef.current) return;
      setRequestedEmail(parsed.data.new_email);
      setNewEmail(parsed.data.new_email);
      setEmailPassword("");
      setEmailStep("confirm");
      setEmailStatus("验证码已发送，请完成第二步确认。");
    }).catch(() => {
      if (mountedRef.current) setEmailError("邮箱变更请求失败，请检查新邮箱和当前密码后重试。");
    }).finally(() => {
      if (mountedRef.current) setPendingAction(null);
    });
  };

  const confirmEmail = () => {
    if (pendingAction || !requestedEmail) return;
    const parsed = ConfirmEmailChangeInputSchema.safeParse({ new_email: requestedEmail, code: emailCode });
    if (!parsed.success) {
      setEmailError("验证码格式无效，请输入 6 位数字验证码。");
      setEmailStatus(null);
      return;
    }
    setPendingAction("email-confirm");
    setEmailError(null);
    setEmailStatus(null);
    void Promise.resolve().then(() => client.confirmEmailChange(parsed.data)).then((next) => {
      if (!mountedRef.current) return;
      setEmailCode("");
      setNewEmail("");
      setRequestedEmail(null);
      setEmailStep("request");
      setEmailStatus("邮箱已更新。");
      onProfileChange(next);
    }).catch(() => {
      if (mountedRef.current) setEmailError("邮箱确认失败，请检查验证码后重试。");
    }).finally(() => {
      if (mountedRef.current) setPendingAction(null);
    });
  };

  const restartEmail = () => {
    if (pendingAction) return;
    setEmailStep("request");
    setRequestedEmail(null);
    setNewEmail("");
    setEmailPassword("");
    setEmailCode("");
    setEmailError(null);
    setEmailStatus(null);
  };

  const changePassword = () => {
    if (pendingAction) return;
    if (passwordNew !== passwordConfirm) {
      setPasswordError("两次输入的新密码不一致。");
      setPasswordStatus(null);
      return;
    }
    const parsed = ChangePasswordInputSchema.safeParse({ current_password: passwordCurrent, new_password: passwordNew });
    if (!parsed.success) {
      setPasswordError("密码格式无效，新密码至少需要 10 个字符。");
      setPasswordStatus(null);
      return;
    }
    setPendingAction("password");
    setPasswordError(null);
    setPasswordStatus(null);
    void Promise.resolve().then(() => client.changePassword(parsed.data)).then(() => {
      if (!mountedRef.current) return;
      setPasswordCurrent("");
      setPasswordNew("");
      setPasswordConfirm("");
      setPasswordStatus("密码已修改，其他登录会话已退出。");
      onSessionsRefresh();
    }).catch(() => {
      if (mountedRef.current) setPasswordError("密码修改失败，请检查当前密码后重试。");
    }).finally(() => {
      if (mountedRef.current) setPendingAction(null);
    });
  };

  function closeRevokeDialog(focus: "origin" | "fallback", preserveError = false) {
    pendingFocusRef.current = focus === "origin" ? revokeOriginRef.current : sessionsHeadingRef.current;
    setRevokeTarget(null);
    if (!preserveError) setRevokeError(null);
  }

  const revokeSession = () => {
    if (!revokeTarget || revokePending) return;
    onSessionRevokeStart();
    setRevokePending(true);
    setRevokeError(null);
    const targetId = revokeTarget.id;
    void Promise.resolve().then(() => client.revokeSession(targetId)).then(() => {
      if (!mountedRef.current) return;
      onSessionRevoked(targetId);
      setRevokeError(null);
      closeRevokeDialog("fallback");
    }).catch(() => {
      if (mountedRef.current) {
        setRevokeError("撤销会话失败，请重试。");
        onSessionRevokeFailed();
        closeRevokeDialog("origin", true);
      }
    }).finally(() => {
      if (mountedRef.current) setRevokePending(false);
    });
  };

  const revokeDialog = revokeTarget ? createPortal(
    <div className="account-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !revokePendingRef.current) closeRevokeDialog("origin"); }}>
      <div ref={dialogRef} className="account-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="revoke-dialog-heading">
        <h3 id="revoke-dialog-heading">确认撤销会话</h3>
        <p>将退出 {revokeTarget.user_agent || "未知设备"} 的登录会话。</p>
        {revokeError ? <p className="account-error" role="alert">{revokeError}</p> : null}
        <div className="account-actions"><button ref={dialogCancelRef} type="button" onClick={() => closeRevokeDialog("origin")} disabled={revokePending}>取消撤销</button><button type="button" onClick={revokeSession} disabled={revokePending}>{revokePending ? "正在撤销…" : "确认撤销"}</button></div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <section id="account-panel-security" role="tabpanel" aria-labelledby="account-tab-security" className="account-panel">
      <div className="account-panel-heading"><div><p className="eyebrow">SECURITY</p><h2>安全</h2><p>更新邮箱、密码并管理登录会话。</p></div></div>
      {loading ? <p className="account-inline-status" role="status" aria-label="正在加载登录会话">正在加载登录会话…</p> : null}
      {error ? <div className="account-error-row"><p role="alert">会话加载失败，请重试。</p><button type="button" onClick={onRetry}>重试会话加载</button></div> : null}
      <section className="account-subpanel" aria-labelledby="email-heading">
        <h3 id="email-heading">邮箱</h3>
        <p className="account-muted">当前邮箱：{profile?.email ?? "正在加载…"}</p>
        <form className="account-form" noValidate onSubmit={(event) => { event.preventDefault(); emailStep === "request" ? requestEmail() : confirmEmail(); }}>
          <label>新邮箱<input type="email" autoComplete="off" value={requestedEmail ?? newEmail} disabled={emailStep === "confirm" || pendingAction !== null} onChange={(event) => { if (emailStep === "request") setNewEmail(event.target.value); }} /></label>
          {emailStep === "request" ? <label>邮箱变更当前密码<input type="password" autoComplete="off" value={emailPassword} disabled={pendingAction !== null} onChange={(event) => setEmailPassword(event.target.value)} /></label> : <label>验证码<input inputMode="numeric" autoComplete="one-time-code" value={emailCode} disabled={pendingAction !== null} onChange={(event) => setEmailCode(event.target.value)} /></label>}
          <div className="account-actions"><button type="submit" disabled={pendingAction !== null}>{pendingAction === "email-request" ? "正在请求…" : pendingAction === "email-confirm" ? "正在确认…" : emailStep === "request" ? "请求邮箱变更" : "确认邮箱变更"}</button>{emailStep === "confirm" ? <button type="button" onClick={restartEmail} disabled={pendingAction !== null}>重新开始邮箱变更</button> : null}</div>
        </form>
        {emailError ? <p className="account-error" role="alert">{emailError}</p> : null}
        {emailStatus ? <p className="account-status" role="status">{emailStatus}</p> : null}
      </section>
      <section className="account-subpanel" aria-labelledby="password-heading">
        <h3 id="password-heading">密码</h3>
        <form className="account-form" onSubmit={(event) => { event.preventDefault(); changePassword(); }}>
          <label>当前密码<input type="password" autoComplete="current-password" value={passwordCurrent} disabled={pendingAction !== null} onChange={(event) => setPasswordCurrent(event.target.value)} /></label>
          <label>新密码<input type="password" autoComplete="new-password" value={passwordNew} disabled={pendingAction !== null} onChange={(event) => setPasswordNew(event.target.value)} /></label>
          <label>确认新密码<input type="password" autoComplete="new-password" value={passwordConfirm} disabled={pendingAction !== null} onChange={(event) => setPasswordConfirm(event.target.value)} /></label>
          <button type="submit" disabled={pendingAction !== null}>修改密码</button>
        </form>
        {passwordError ? <p className="account-error" role="alert">{passwordError}</p> : null}
        {passwordStatus ? <p className="account-status" role="status">{passwordStatus}</p> : null}
      </section>
      <section className="account-subpanel" aria-labelledby="sessions-heading">
        <div className="account-subpanel-heading"><h3 id="sessions-heading" ref={sessionsHeadingRef} tabIndex={-1}>登录会话</h3><button type="button" onClick={onRetry} disabled={loading}>刷新</button></div>
        <ul className="account-session-list" aria-label="登录会话">
          {sessions.map((session) => <li key={session.id} className="account-session-row" aria-label={`${session.current ? "当前会话" : "其他会话"} ${session.user_agent || "未知设备"}`}>
            <div><strong>{session.current ? "当前会话" : "其他会话"}</strong><span>{session.user_agent || "未知设备"}</span><small>创建于 {formatTimestamp(session.created_at)}，最近活动 {formatTimestamp(session.last_seen_at)}</small></div>
            {session.current ? <span className="account-session-badge">当前</span> : <button type="button" onClick={(event) => { revokeOriginRef.current = event.currentTarget; setRevokeError(null); setRevokeTarget(session); }}>撤销此会话</button>}
          </li>)}
        </ul>
        {revokeError && !revokeTarget ? <p className="account-error" role="alert">{revokeError}</p> : null}
      </section>
      {revokeDialog}
    </section>
  );
}
