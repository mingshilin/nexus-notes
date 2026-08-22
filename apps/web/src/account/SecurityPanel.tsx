import type { AccountSession, Profile } from "@nexus/contracts";
import { useEffect, useRef, useState } from "react";
import type { ProfileClientLike } from "./index";

export interface SecurityPanelProps {
  client: ProfileClientLike;
  profile: Profile | null;
  sessions: AccountSession[];
  loading: boolean;
  error: string | null;
  onRetry(): void;
  onSessionsRefresh(): void;
  onSessionRevoked(sessionId: string): void;
  onProfileChange(profile: Profile): void;
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function SecurityPanel({ client, profile, sessions, loading, error, onRetry, onSessionsRefresh, onSessionRevoked, onProfileChange }: SecurityPanelProps) {
  const [newEmail, setNewEmail] = useState("");
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
  const dialogConfirmRef = useRef<HTMLButtonElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (revokeTarget) dialogConfirmRef.current?.focus();
  }, [revokeTarget]);

  const requestEmail = () => {
    if (pendingAction) return;
    setPendingAction("email-request");
    setEmailError(null);
    setEmailStatus(null);
    void client.requestEmailChange({ new_email: newEmail, current_password: emailPassword }).then(() => {
      if (!mountedRef.current) return;
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
    if (pendingAction) return;
    setPendingAction("email-confirm");
    setEmailError(null);
    setEmailStatus(null);
    void client.confirmEmailChange({ new_email: newEmail, code: emailCode }).then((next) => {
      if (!mountedRef.current) return;
      setEmailCode("");
      setNewEmail("");
      setEmailStep("request");
      setEmailStatus("邮箱已更新。");
      onProfileChange(next);
    }).catch(() => {
      if (mountedRef.current) setEmailError("邮箱确认失败，请检查验证码后重试。");
    }).finally(() => {
      if (mountedRef.current) setPendingAction(null);
    });
  };

  const changePassword = () => {
    if (pendingAction) return;
    if (passwordNew !== passwordConfirm) {
      setPasswordError("两次输入的新密码不一致。");
      setPasswordStatus(null);
      return;
    }
    setPendingAction("password");
    setPasswordError(null);
    setPasswordStatus(null);
    void client.changePassword({ current_password: passwordCurrent, new_password: passwordNew }).then(() => {
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

  const closeRevokeDialog = () => {
    revokeOriginRef.current?.focus();
    setRevokeTarget(null);
    setRevokeError(null);
  };

  const revokeSession = () => {
    if (!revokeTarget || revokePending) return;
    setRevokePending(true);
    setRevokeError(null);
    const targetId = revokeTarget.id;
    void client.revokeSession(targetId).then(() => {
      if (!mountedRef.current) return;
      onSessionRevoked(targetId);
      closeRevokeDialog();
    }).catch(() => {
      if (mountedRef.current) setRevokeError("撤销会话失败，请重试。");
    }).finally(() => {
      if (mountedRef.current) setRevokePending(false);
    });
  };

  return (
    <section id="account-panel-security" role="tabpanel" aria-labelledby="account-tab-security" className="account-panel">
      <div className="account-panel-heading"><div><p className="eyebrow">SECURITY</p><h2>安全</h2><p>更新邮箱、密码并管理登录会话。</p></div></div>
      {loading ? <p className="account-inline-status" role="status" aria-label="正在加载登录会话">正在加载登录会话…</p> : null}
      {error ? <div className="account-error-row"><p role="alert">会话加载失败，请重试。</p><button type="button" onClick={onRetry}>重试会话加载</button></div> : null}
      <section className="account-subpanel" aria-labelledby="email-heading">
        <h3 id="email-heading">邮箱</h3>
        <p className="account-muted">当前邮箱：{profile?.email ?? "正在加载…"}</p>
        <form className="account-form" onSubmit={(event) => { event.preventDefault(); emailStep === "request" ? requestEmail() : confirmEmail(); }}>
          <label>新邮箱<input type="email" autoComplete="off" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} /></label>
          {emailStep === "request" ? <label>邮箱变更当前密码<input type="password" autoComplete="off" value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} /></label> : <label>验证码<input inputMode="numeric" autoComplete="one-time-code" value={emailCode} onChange={(event) => setEmailCode(event.target.value)} /></label>}
          <button type="submit" disabled={pendingAction !== null}>{pendingAction === "email-request" ? "正在请求…" : pendingAction === "email-confirm" ? "正在确认…" : emailStep === "request" ? "请求邮箱变更" : "确认邮箱变更"}</button>
        </form>
        {emailError ? <p className="account-error" role="alert">{emailError}</p> : null}
        {emailStatus ? <p className="account-status" role="status">{emailStatus}</p> : null}
      </section>
      <section className="account-subpanel" aria-labelledby="password-heading">
        <h3 id="password-heading">密码</h3>
        <form className="account-form" onSubmit={(event) => { event.preventDefault(); changePassword(); }}>
          <label>当前密码<input type="password" autoComplete="current-password" value={passwordCurrent} onChange={(event) => setPasswordCurrent(event.target.value)} /></label>
          <label>新密码<input type="password" autoComplete="new-password" value={passwordNew} onChange={(event) => setPasswordNew(event.target.value)} /></label>
          <label>确认新密码<input type="password" autoComplete="new-password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} /></label>
          <button type="submit" disabled={pendingAction !== null}>修改密码</button>
        </form>
        {passwordError ? <p className="account-error" role="alert">{passwordError}</p> : null}
        {passwordStatus ? <p className="account-status" role="status">{passwordStatus}</p> : null}
      </section>
      <section className="account-subpanel" aria-labelledby="sessions-heading">
        <div className="account-subpanel-heading"><h3 id="sessions-heading">登录会话</h3><button type="button" onClick={onRetry} disabled={loading}>刷新</button></div>
        <ul className="account-session-list" aria-label="登录会话">
          {sessions.map((session) => <li key={session.id} className="account-session-row" aria-label={`${session.current ? "当前会话" : "其他会话"} ${session.user_agent || "未知设备"}`}>
            <div><strong>{session.current ? "当前会话" : "其他会话"}</strong><span>{session.user_agent || "未知设备"}</span><small>创建于 {formatTimestamp(session.created_at)}，最近活动 {formatTimestamp(session.last_seen_at)}</small></div>
            {session.current ? <span className="account-session-badge">当前</span> : <button type="button" onClick={(event) => { revokeOriginRef.current = event.currentTarget; setRevokeError(null); setRevokeTarget(session); }}>撤销此会话</button>}
          </li>)}
        </ul>
        {revokeError && !revokeTarget ? <p className="account-error" role="alert">{revokeError}</p> : null}
      </section>
      {revokeTarget ? <div className="account-dialog-backdrop" role="presentation"><div className="account-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="revoke-dialog-heading"><h3 id="revoke-dialog-heading">确认撤销会话</h3><p>将退出 {revokeTarget.user_agent || "未知设备"} 的登录会话。</p>{revokeError ? <p className="account-error" role="alert">{revokeError}</p> : null}<div className="account-actions"><button type="button" onClick={closeRevokeDialog} disabled={revokePending}>取消撤销</button><button ref={dialogConfirmRef} type="button" onClick={revokeSession} disabled={revokePending}>{revokePending ? "正在撤销…" : "确认撤销"}</button></div></div></div> : null}
    </section>
  );
}
