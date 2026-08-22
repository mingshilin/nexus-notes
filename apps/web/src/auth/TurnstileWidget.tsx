import { useEffect, useId, useRef } from "react";

interface TurnstileApi {
  render(container: string | HTMLElement, options: {
    sitekey: string;
    action: string;
    callback(token: string): void;
    "expired-callback"(): void;
    "error-callback"(): void;
  }): string;
  remove(widgetId: string): void;
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
  callbackRef.current = onToken;

  useEffect(() => {
    if (!siteKey) return;
    let disposed = false;
    let widgetId: string | undefined;
    void loadTurnstile().then(() => {
      if (disposed || !window.turnstile) return;
      widgetId = window.turnstile.render(`#${containerId}`, {
        sitekey: siteKey,
        action,
        callback: (token) => callbackRef.current(token),
        "expired-callback": () => callbackRef.current(""),
        "error-callback": () => callbackRef.current(""),
      });
    }).catch(() => callbackRef.current(""));
    return () => {
      disposed = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [action, containerId, siteKey]);

  return (
    <div className="turnstile-shell" data-testid="turnstile-widget">
      <div id={containerId} />
      {!siteKey ? <p>人机验证尚未配置，请联系管理员。</p> : null}
    </div>
  );
}
