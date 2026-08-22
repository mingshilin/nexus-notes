import { ArrowRight, KeyRound, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import type { ApiClientError } from "../data/api-client";
import type { AuthClient, AuthUser } from "./auth-client";
import { TurnstileWidget } from "./TurnstileWidget";

type AuthMode = "login" | "register" | "verify" | "forgot" | "reset";
const TURNSTILE_RETRY_ERROR = "本次人机验证已失效，请重新验证后再提交。";

function errorCode(error: unknown) {
  return (error as Partial<ApiClientError>)?.code;
}

export function AuthPanel({
  client,
  onAuthenticated,
  turnstileSiteKey,
  resetToken,
}: {
  client: AuthClient;
  onAuthenticated(user: AuthUser): void;
  turnstileSiteKey: string;
  resetToken?: string;
}) {
  const [mode, setMode] = useState<AuthMode>(resetToken ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileVersion, setTurnstileVersion] = useState(0);
  const [loginChallenge, setLoginChallenge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const requestInFlightRef = useRef(false);

  const beginRequest = () => {
    if (requestInFlightRef.current) return false;
    requestInFlightRef.current = true;
    setBusy(true);
    return true;
  };

  const finishRequest = () => {
    requestInFlightRef.current = false;
    setBusy(false);
  };

  const selectMode = (next: AuthMode) => {
    setMode(next);
    setMessage("");
    setError("");
    setTurnstileToken("");
  };

  const needsTurnstile = mode === "register" || mode === "forgot" || (mode === "login" && loginChallenge);
  const showsTurnstile = needsTurnstile || mode === "verify";
  const action = mode === "forgot"
    ? "forgot_password"
    : mode === "login"
      ? "login"
      : mode === "verify"
        ? "verify_email"
        : "register";

  const resendVerification = async () => {
    if (!beginRequest()) return;
    setError("");
    setMessage("");
    try {
      await client.resendVerification({ email, turnstileToken });
      setMessage("如果该邮箱需要验证，新的验证码会很快送达。");
    } catch (caught) {
      setError(errorCode(caught) === "CHALLENGE_FAILED"
        ? TURNSTILE_RETRY_ERROR
        : caught instanceof Error
          ? caught.message
          : "验证码发送失败，请稍后重试。");
    } finally {
      setTurnstileToken("");
      setTurnstileVersion((version) => version + 1);
      finishRequest();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!beginRequest()) return;
    setError("");
    try {
      if (mode === "login") {
        const result = await client.login({ email, password, turnstileToken: turnstileToken || undefined });
        onAuthenticated(result.user);
      } else if (mode === "register") {
        await client.register({ email, password, displayName, turnstileToken });
        selectMode("verify");
        setMessage("验证码已发送到你的邮箱。");
      } else if (mode === "verify") {
        await client.verifyEmail({ email, code });
        selectMode("login");
        setMessage("邮箱验证成功，现在可以登录。");
      } else if (mode === "forgot") {
        await client.forgotPassword({ email, turnstileToken });
        setMessage("如果该邮箱已注册，重置邮件会很快送达。");
      } else if (resetToken) {
        await client.resetPassword({ token: resetToken, password });
        selectMode("login");
        setMessage("密码已重置，请重新登录。");
      }
    } catch (caught) {
      if (mode === "login" && errorCode(caught) === "CHALLENGE_REQUIRED") {
        setLoginChallenge(true);
        setError("此登录需要完成人机验证后重试。");
      } else if (needsTurnstile && errorCode(caught) === "CHALLENGE_FAILED") {
        setError(TURNSTILE_RETRY_ERROR);
      } else if (mode === "login" && errorCode(caught) === "EMAIL_NOT_VERIFIED") {
        setMode("verify");
        setError("邮箱尚未验证，请输入邮件中的验证码。");
      } else {
        setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试。");
      }
    } finally {
      if (needsTurnstile) {
        setTurnstileToken("");
        setTurnstileVersion((version) => version + 1);
      }
      finishRequest();
    }
  };

  const submitLabel = mode === "login"
    ? "登录"
    : mode === "register"
      ? "创建账户"
      : mode === "verify"
        ? "验证邮箱"
        : mode === "forgot"
          ? "发送重置邮件"
          : "重置密码";

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="auth-brand"><span>N</span> Nexus Notes</div>
        <p className="eyebrow">PUBLIC BETA</p>
        <h1>把灵感留住，<br />让知识自然生长。</h1>
        <p>稳定、响应迅速、离线可恢复的个人与团队知识工作台。</p>
        <div className="auth-feature"><Sparkles size={18} /><span>笔记、数据库、协作与知识整理汇于一处</span></div>
      </section>
      <section className="auth-card" aria-label="账户认证">
        <div className="auth-icon"><KeyRound size={21} /></div>
        <p className="eyebrow">NEXUS ACCOUNT</p>
        <h2>{mode === "login" ? "欢迎回来" : mode === "register" ? "创建账户" : mode === "verify" ? "验证邮箱" : mode === "forgot" ? "找回密码" : "设置新密码"}</h2>
        <p className="auth-description">{mode === "login" ? "普通登录无需人机验证；仅在风险升高时触发。" : "完成必要步骤后即可继续使用。"}</p>
        <form onSubmit={submit}>
          {mode === "register" ? (
            <label>名称<input aria-label="名称" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          ) : null}
          {mode !== "reset" ? (
            <label>邮箱<div className="auth-input"><Mail size={16} /><input aria-label="邮箱" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div></label>
          ) : null}
          {mode === "verify" ? (
            <label>验证码<input aria-label="验证码" inputMode="numeric" pattern="[0-9]{6}" required value={code} onChange={(event) => setCode(event.target.value)} /></label>
          ) : null}
          {mode === "login" || mode === "register" || mode === "reset" ? (
            <label>密码<input aria-label="密码" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "login" ? 1 : 10} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          ) : null}
          {showsTurnstile ? (
            <TurnstileWidget
              key={`${mode}:${turnstileVersion}`}
              siteKey={turnstileSiteKey}
              action={action}
              onToken={(token) => {
                setTurnstileToken(token);
                if (token) {
                  setError((current) => current === TURNSTILE_RETRY_ERROR ? "" : current);
                }
              }}
            />
          ) : null}
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          {message ? <p className="auth-message" role="status">{message}</p> : null}
          <button className="auth-submit" type="submit" disabled={busy || (needsTurnstile && !turnstileToken)}>
            {busy ? "处理中…" : submitLabel}<ArrowRight size={16} />
          </button>
          {mode === "verify" ? (
            <button
              className="auth-secondary"
              type="button"
              disabled={busy || !email || !turnstileToken}
              onClick={() => void resendVerification()}
            >
              重新发送验证码
            </button>
          ) : null}
        </form>
        <nav className="auth-switcher" aria-label="认证方式">
          <button type="button" onClick={() => selectMode("login")}>登录账户</button>
          <button type="button" onClick={() => selectMode("register")}>注册账户</button>
          <button type="button" onClick={() => selectMode("verify")}>验证邮箱</button>
          <button type="button" onClick={() => selectMode("forgot")}>忘记密码</button>
        </nav>
        <p className="auth-security"><ShieldCheck size={14} /> Session 使用 Secure HttpOnly Cookie 保存</p>
      </section>
    </main>
  );
}
