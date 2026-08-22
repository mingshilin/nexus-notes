import { useMemo, useRef, useState } from "react";
import { Eye, EyeOff, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TurnstileWidget } from "@/components/ui/TurnstileWidget";
import { BrandMark } from "@/components/branding/BrandMark";
import { zh } from "@/i18n/messages";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";
import type { PendingVerificationAuth } from "@/types/auth";
import type { WorkspaceInvitePreview } from "@/types/workspace";

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "";

interface AuthPanelProps {
  loading: boolean;
  resetToken?: string | null;
  invitePreview?: WorkspaceInvitePreview | null;
  onLogin: (payload: { email: string; password: string; turnstile_token?: string }) => Promise<void>;
  onRegister: (payload: { email: string; password: string; turnstile_token?: string }) => Promise<PendingVerificationAuth>;
  onVerifyEmailCode: (payload: { email: string; code: string }) => Promise<void>;
  onResendVerificationCode: (email: string) => Promise<PendingVerificationAuth>;
  onForgotPassword: (email: string, turnstileToken: string) => Promise<void>;
  onResetPassword: (payload: { token: string; password: string; turnstile_token?: string }) => Promise<void>;
}

function normalizeToken(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const queryToken =
      url.searchParams.get("token") ??
      url.searchParams.get("resetToken") ??
      url.searchParams.get("reset_token");
    if (queryToken) return decodeURIComponent(queryToken.trim());

    if (url.hash.includes("?")) {
      const hashQuery = new URLSearchParams(url.hash.split("?")[1]);
      const hashToken =
        hashQuery.get("token") ?? hashQuery.get("resetToken") ?? hashQuery.get("reset_token");
      if (hashToken) return decodeURIComponent(hashToken.trim());
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (
      parts.length >= 2 &&
      (parts[0].toLowerCase() === "reset-password" || parts[0].toLowerCase() === "reset")
    ) {
      return decodeURIComponent(parts[1]);
    }
  } catch {
    return decodeURIComponent(value);
  }
  return decodeURIComponent(value);
}

function mapAuthError(error: unknown) {
  const text =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "操作失败，请稍后重试";
  const raw = text.toLowerCase();

  if (raw.includes("reset token already used")) return "重置链接已使用，请重新获取。";
  if (raw.includes("reset token expired")) return "重置链接已过期，请重新获取。";
  if (raw.includes("invalid reset token")) return "重置链接无效，请重新获取。";
  if (raw.includes("unexpected end of json input")) return "服务响应异常，请稍后重试。";
  if (raw.includes("invalid credentials")) return "账号或密码错误。";
  if (raw.includes("authentication required")) return "登录状态失效，请重新登录。";
  if (raw.includes("bot")) return "人机验证未通过，请重试。";
  if (raw.includes("turnstile secret is not configured")) return "人机验证服务配置异常，请联系管理员。";
  if (raw.includes("turnstile verification failed")) return "人机验证失败，请重试。";
  if (raw.includes("email is not verified")) return "邮箱尚未验证，请输入邮箱验证码。";
  if (raw.includes("invalid code")) return "验证码错误，请重新输入。";
  if (raw.includes("code expired")) return "验证码已过期，请重新获取。";
  if (raw.includes("code used")) return "验证码已失效，请重新获取。";
  return text;
}

function PasswordField({
  value,
  onChange,
  placeholder,
  autoComplete,
  visible,
  onToggle,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete: string;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-12 rounded-xl pr-12"
      />
      <button
        type="button"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
        onClick={onToggle}
        aria-label={visible ? "隐藏密码" : "显示密码"}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function AuthPanel({
  loading,
  resetToken = null,
  invitePreview = null,
  onLogin,
  onRegister,
  onVerifyEmailCode,
  onResendVerificationCode,
  onForgotPassword,
  onResetPassword,
}: AuthPanelProps) {
  const effectiveResetToken = useMemo(() => {
    if (resetToken) return resetToken;
    if (typeof window === "undefined") return null;
    const url = new URL(window.location.href);
    const queryToken =
      url.searchParams.get("token") ??
      url.searchParams.get("resetToken") ??
      url.searchParams.get("reset_token");
    if (queryToken) return decodeURIComponent(queryToken.trim());
    if (url.hash.includes("?")) {
      const hashQuery = new URLSearchParams(url.hash.split("?")[1]);
      const hashToken =
        hashQuery.get("token") ?? hashQuery.get("resetToken") ?? hashQuery.get("reset_token");
      if (hashToken) return decodeURIComponent(hashToken.trim());
    }
    return null;
  }, [resetToken]);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [manualResetMode, setManualResetMode] = useState(false);
  const [verificationState, setVerificationState] = useState<PendingVerificationAuth | null>(null);
  const [manualTokenInput, setManualTokenInput] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const requestInFlightRef = useRef(false);

  const turnstileConfigured = TURNSTILE_SITE_KEY.trim().length > 0;
  const needsTurnstile = mode === "register" || Boolean(effectiveResetToken) || manualResetMode || forgotPasswordMode;
  async function submit() {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    try {
      setError(null);

    const tokenForReset = effectiveResetToken ?? (manualResetMode ? normalizeToken(manualTokenInput) : null);
    if (forgotPasswordMode) {
      if (!turnstileConfigured) {
        setError("人机验证未配置（缺少 VITE_TURNSTILE_SITE_KEY），请联系管理员。");
        return;
      }
      if (!turnstileToken) {
        setError("请先完成人机验证。");
        return;
      }
      await onForgotPassword(email, turnstileToken);
      setTurnstileToken("");
      setForgotPasswordMode(false);
      return;
    }

    if (tokenForReset) {
      if (!turnstileConfigured) {
        setError("人机验证未配置（缺少 VITE_TURNSTILE_SITE_KEY），请联系管理员。");
        return;
      }
      if (!turnstileToken) {
        setError("请先完成人机验证。");
        return;
      }
      if (password !== confirmPassword) {
        setError("两次密码输入不一致。");
        return;
      }
      await onResetPassword({ token: tokenForReset, password, turnstile_token: turnstileToken });
      setPassword("");
      setConfirmPassword("");
      setManualTokenInput("");
      setManualResetMode(false);
      setTurnstileToken("");
      return;
    }

    if (verificationState) {
      await onVerifyEmailCode({ email: verificationState.email, code: verificationCode.trim() });
      return;
    }

    if (needsTurnstile && !turnstileConfigured) {
      setError("人机验证未配置（缺少 VITE_TURNSTILE_SITE_KEY），请联系管理员。");
      return;
    }
    if (needsTurnstile && !turnstileToken) {
      setError("请先完成人机验证。");
      return;
    }

    if (mode === "register" && password !== confirmPassword) {
      setError("两次密码输入不一致。");
      return;
    }

    if (mode === "login") {
      await onLogin({ email, password });
      setTurnstileToken("");
      return;
    }

      const pending = await onRegister({ email, password, turnstile_token: turnstileToken });
      setVerificationState(pending);
      setVerificationCode("");
      setTurnstileToken("");
    } finally {
      requestInFlightRef.current = false;
    }
  }

  const introText = effectiveResetToken || manualResetMode
    ? "设置一个新密码"
    : forgotPasswordMode
      ? "输入邮箱并完成人机验证，我们会发送重置链接"
    : verificationState
      ? `验证码已发送到 ${verificationState.email_masked}`
      : mode === "login"
        ? `登录 ${BRAND_NAME}，进入你的工作区`
        : "创建新账户开始使用";

  return (
    <div className="flex min-h-screen min-w-0 items-center justify-center overflow-x-hidden px-4 py-10">
      <div className="surface-card w-full min-w-0 max-w-md p-7">
        <div className="mb-6">
          <div className="mb-4 flex items-center gap-3">
            <BrandMark compact />
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">{zh.appName}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{BRAND_TAGLINE}</p>
            </div>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{introText}</p>
        </div>

        {invitePreview ? (
          <div className="mb-4 rounded-[18px] border border-border/70 bg-white/60 p-4 dark:bg-white/[0.04]">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Users className="h-4 w-4 text-primary" />
              你被邀请加入工作区
            </div>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>工作区：{invitePreview.workspace_name}</p>
              <p>角色：{invitePreview.role === "editor" ? "编辑者" : "只读者"}</p>
              <p>邀请对象：{invitePreview.invited_email_masked}</p>
              <p>邀请人：{invitePreview.inviter_display}</p>
              {invitePreview.note_title ? <p>目标笔记：{invitePreview.note_title}</p> : null}
            </div>
          </div>
        ) : null}

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit().catch((err) => setError(mapAuthError(err)));
          }}
        >
          {effectiveResetToken || manualResetMode || verificationState ? null : (
            <Input
              className="h-12 rounded-xl"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={zh.email}
              autoComplete="email"
              inputMode="email"
            />
          )}

          {verificationState ? (
            <>
              <Input
                className="h-12 rounded-xl text-center text-lg tracking-[0.4em]"
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="输入 6 位验证码"
                autoComplete="one-time-code"
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground">验证码发送到：{verificationState.email_masked}</p>
            </>
          ) : null}

          {manualResetMode && !effectiveResetToken ? (
            <Input
              className="h-12 rounded-xl"
              value={manualTokenInput}
              onChange={(event) => setManualTokenInput(event.target.value)}
              placeholder="粘贴重置链接或 Token"
              autoComplete="off"
            />
          ) : null}

          {!verificationState && !forgotPasswordMode ? (
            <PasswordField
              value={password}
              onChange={setPassword}
              placeholder={zh.password}
              autoComplete={mode === "register" || effectiveResetToken || manualResetMode ? "new-password" : "current-password"}
              visible={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
            />
          ) : null}

          {!verificationState && !forgotPasswordMode && (mode === "register" || effectiveResetToken || manualResetMode) ? (
            <PasswordField
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder={zh.confirmPassword}
              autoComplete="new-password"
              visible={showConfirmPassword}
              onToggle={() => setShowConfirmPassword((value) => !value)}
            />
          ) : null}

          {!verificationState && needsTurnstile ? (
            <div className="rounded-[18px] border border-border/70 bg-white/60 p-3 dark:bg-white/[0.04]">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                Cloudflare 人机验证
              </div>
              {turnstileConfigured ? (
                <TurnstileWidget
                  siteKey={TURNSTILE_SITE_KEY}
                  onTokenChange={(token) => {
                    setTurnstileToken(token);
                    if (token) setError(null);
                  }}
                  onError={(message) => {
                    if (message) setError(message);
                  }}
                />
              ) : (
                <p className="text-xs text-destructive">人机验证未配置（缺少 VITE_TURNSTILE_SITE_KEY）。</p>
              )}
            </div>
          ) : null}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <Button
            type="submit"
            className="h-11 w-full rounded-xl"
            disabled={loading || (needsTurnstile && !turnstileConfigured && !verificationState)}
          >
            {effectiveResetToken || manualResetMode
              ? zh.resetPassword
              : forgotPasswordMode
                ? zh.forgotPassword
              : verificationState
                ? "验证邮箱"
                : mode === "login"
                  ? zh.login
                  : zh.register}
          </Button>

          {verificationState ? (
            <>
              <Button
                type="button"
                variant="ghost"
                className="w-full rounded-xl"
                disabled={loading}
                onClick={() => {
                  if (requestInFlightRef.current) return;
                  requestInFlightRef.current = true;
                  void (async () => {
                    try {
                      const pending = await onResendVerificationCode(verificationState.email);
                      setVerificationState(pending);
                      setVerificationCode("");
                      setError(null);
                    } catch (err) {
                      setError(mapAuthError(err));
                    } finally {
                      requestInFlightRef.current = false;
                    }
                  })();
                }}
              >
                重新发送验证码
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full rounded-xl text-xs"
                disabled={loading}
                onClick={() => {
                  setVerificationState(null);
                  setVerificationCode("");
                }}
              >
                返回登录/注册
              </Button>
            </>
          ) : null}

          {mode === "login" && !effectiveResetToken && !manualResetMode && !verificationState && !forgotPasswordMode ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full rounded-xl"
              disabled={loading}
              onClick={() => {
                setForgotPasswordMode(true);
                setError(null);
                setTurnstileToken("");
              }}
            >
              {zh.forgotPassword}
            </Button>
          ) : null}

          {mode === "login" && !effectiveResetToken && !verificationState && !forgotPasswordMode ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full rounded-xl text-xs"
              disabled={loading}
              onClick={() => setManualResetMode((value) => !value)}
            >
              {manualResetMode ? "取消手动重置" : "无法打开重置链接？手动粘贴重置"}
            </Button>
          ) : null}

          {!effectiveResetToken && !manualResetMode && !verificationState && !forgotPasswordMode ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full rounded-xl"
              disabled={loading}
              onClick={() => {
                setMode((value) => (value === "login" ? "register" : "login"));
                setForgotPasswordMode(false);
                setError(null);
              }}
            >
              {mode === "login" ? zh.register : zh.login}
            </Button>
          ) : null}

          {(effectiveResetToken || manualResetMode || forgotPasswordMode) && !verificationState ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full rounded-xl"
              disabled={loading}
              onClick={() => {
                setManualResetMode(false);
                setForgotPasswordMode(false);
                setManualTokenInput("");
                setTurnstileToken("");
                if (typeof window !== "undefined") window.history.replaceState({}, "", "/");
              }}
            >
              返回登录
            </Button>
          ) : null}
        </form>
      </div>
    </div>
  );
}
