import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-script";
const SCRIPT_WAIT_TIMEOUT_MS = 10000;
const CHALLENGE_WAIT_NOTICE_MS = 30000;

type VerifyStatus = "idle" | "verifying" | "verified" | "failed";

interface TurnstileWidgetProps {
  siteKey: string;
  theme?: "light" | "dark" | "auto";
  onTokenChange: (token: string) => void;
  onError?: (message: string) => void;
}

function statusText(status: VerifyStatus) {
  switch (status) {
    case "verifying":
      return "验证中";
    case "verified":
      return "已验证";
    case "failed":
      return "验证失败";
    default:
      return "未验证";
  }
}

function isLikelyAutomatedBrowser() {
  if (typeof navigator === "undefined") return false;
  return Boolean(navigator.webdriver) || /headless/i.test(navigator.userAgent);
}

function formatTurnstileError(errorCode?: string) {
  if (errorCode) return `人机验证失败，请重试。（错误码：${errorCode}）`;
  return "人机验证失败，请重试。";
}

export function TurnstileWidget({
  siteKey,
  theme = "auto",
  onTokenChange,
  onError,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenChangeRef = useRef(onTokenChange);
  const onErrorRef = useRef(onError);
  const noticeTimerRef = useRef<number | null>(null);
  const waitTimerRef = useRef<number | null>(null);
  const waitIntervalRef = useRef<number | null>(null);

  const [ready, setReady] = useState(Boolean(window.turnstile));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [renderNonce, setRenderNonce] = useState(0);

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const clearWaiters = () => {
      if (waitTimerRef.current) {
        window.clearTimeout(waitTimerRef.current);
        waitTimerRef.current = null;
      }
      if (waitIntervalRef.current) {
        window.clearInterval(waitIntervalRef.current);
        waitIntervalRef.current = null;
      }
    };

    const setScriptError = (message = "人机验证脚本加载失败，请刷新页面后重试。") => {
      clearWaiters();
      setErrorMessage(message);
      setVerifyStatus("failed");
      onErrorRef.current?.(message);
    };

    const waitForTurnstile = () => {
      clearWaiters();
      waitIntervalRef.current = window.setInterval(() => {
        if (window.turnstile) {
          clearWaiters();
          setReady(true);
        }
      }, 120);
      waitTimerRef.current = window.setTimeout(() => {
        if (!window.turnstile) setScriptError();
      }, SCRIPT_WAIT_TIMEOUT_MS);
    };

    if (window.turnstile) {
      setReady(true);
      return clearWaiters;
    }

    const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("error", () => setScriptError(), { once: true });
      waitForTurnstile();
      return clearWaiters;
    }

    const script = document.createElement("script");
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = waitForTurnstile;
    script.onerror = () => setScriptError();
    document.head.appendChild(script);

    return clearWaiters;
  }, []);

  useEffect(() => {
    if (!ready || !containerRef.current || !window.turnstile) return;

    if (widgetIdRef.current) {
      window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    }
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }

    containerRef.current.innerHTML = "";
    setErrorMessage(null);
    setVerifyStatus("verifying");
    onTokenChangeRef.current("");
    onErrorRef.current?.("");

    const widgetId = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme,
      appearance: "always",
      execution: "render",
      size: "normal",
      retry: "auto",
      "retry-interval": 8000,
      callback: (token) => {
        if (noticeTimerRef.current) {
          window.clearTimeout(noticeTimerRef.current);
          noticeTimerRef.current = null;
        }
        setVerifyStatus("verified");
        setErrorMessage(null);
        onErrorRef.current?.("");
        onTokenChangeRef.current(token);
      },
      "expired-callback": () => {
        setVerifyStatus("idle");
        onTokenChangeRef.current("");
      },
      "timeout-callback": () => {
        setVerifyStatus("idle");
        onTokenChangeRef.current("");
      },
      "error-callback": (errorCode) => {
        const message = formatTurnstileError(errorCode);
        if (noticeTimerRef.current) {
          window.clearTimeout(noticeTimerRef.current);
          noticeTimerRef.current = null;
        }
        setVerifyStatus("failed");
        setErrorMessage(message);
        onTokenChangeRef.current("");
        onErrorRef.current?.(message);
      },
      "unsupported-callback": () => {
        const message = "当前浏览器不支持人机验证，请升级浏览器或换用 Chrome / Edge / Safari 后重试。";
        if (noticeTimerRef.current) {
          window.clearTimeout(noticeTimerRef.current);
          noticeTimerRef.current = null;
        }
        setVerifyStatus("failed");
        setErrorMessage(message);
        onTokenChangeRef.current("");
        onErrorRef.current?.(message);
      },
    });

    if (!widgetId) {
      const message = "人机验证没有正常显示，请刷新页面后重试。";
      setVerifyStatus("failed");
      setErrorMessage(message);
      onErrorRef.current?.(message);
      return;
    }

    widgetIdRef.current = widgetId;

    noticeTimerRef.current = window.setTimeout(() => {
      const message = isLikelyAutomatedBrowser()
        ? "自动化浏览器通常无法完成 Cloudflare 验证；请用真实浏览器测试注册。"
        : "人机验证仍在等待，请检查网络或刷新后重试。";
      setErrorMessage((current) => current ?? message);
    }, CHALLENGE_WAIT_NOTICE_MS);

    return () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [ready, renderNonce, siteKey, theme]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="min-h-[72px]" />
      {!ready && !errorMessage ? <p className="text-xs text-muted-foreground">正在加载人机验证...</p> : null}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">状态：{statusText(verifyStatus)}</p>
      </div>
      {errorMessage ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-destructive">{errorMessage}</p>
          <Button
            size="sm"
            variant="outline"
            className="rounded-[10px]"
            onClick={() => {
              setVerifyStatus("idle");
              setErrorMessage(null);
              setRenderNonce((value) => value + 1);
            }}
          >
            重试
          </Button>
        </div>
      ) : null}
    </div>
  );
}
