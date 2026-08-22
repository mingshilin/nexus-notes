import { useEffect, useId, useRef, useState } from "react";

interface TurnstileApi {
  render(container: string | HTMLElement, options: {
    sitekey: string;
    action: string;
    callback(token: string): void;
    "expired-callback"(): void;
    "error-callback"(errorCode?: string): void;
  }): string;
  remove(widgetId: string): void;
  reset(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScript: Promise<void> | undefined;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  turnstileScript ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-nexus-turnstile="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Turnstile failed to load")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.nexusTurnstile = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.append(script);
  });
  return turnstileScript;
}

export function TurnstileWidget({
  siteKey,
  action,
  onToken,
}: {
  siteKey: string;
  action: "register" | "login" | "forgot_password" | "verify_email";
  onToken(token: string): void;
}) {
  const reactId = useId();
  const containerId = `turnstile-${reactId.replace(/:/g, "")}`;
  const callbackRef = useRef(onToken);
  const widgetIdRef = useRef<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  callbackRef.current = onToken;

  useEffect(() => {
    if (!siteKey) return;
    let disposed = false;
    void loadTurnstile().then(() => {
      if (disposed || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(`#${containerId}`, {
        sitekey: siteKey,
        action,
        callback: (token) => {
          setErrorMessage("");
          callbackRef.current(token);
        },
        "expired-callback": () => callbackRef.current(""),
        "error-callback": (errorCode) => {
          const suffix = errorCode ? `（错误码：${errorCode}）` : "";
          setErrorMessage(`人机验证失败${suffix}，请重新验证。`);
          callbackRef.current("");
        },
      });
    }).catch(() => callbackRef.current(""));
    return () => {
      disposed = true;
      if (widgetIdRef.current) {
        window.turnstile?.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [action, containerId, siteKey]);

  return (
    <div className="turnstile-shell" data-testid="turnstile-widget">
      <div id={containerId} />
      {!siteKey ? <p>人机验证尚未配置，请联系管理员。</p> : null}
      {errorMessage ? (
        <div className="turnstile-error-row">
          <p className="auth-error" role="alert">{errorMessage}</p>
          <button
            className="auth-secondary"
            type="button"
            onClick={() => {
              setErrorMessage("");
              callbackRef.current("");
              window.turnstile?.reset(widgetIdRef.current ?? undefined);
            }}
          >
            重新验证
          </button>
        </div>
      ) : null}
    </div>
  );
}
