import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { AuthSession } from "@nexus/contracts";
import { AuthPanel } from "./AuthPanel";
import type { AuthClient } from "./auth-client";

type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; session: AuthSession }
  | { status: "error" };

function isUnauthenticated(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown };
  return candidate.status === 401 || candidate.code === "UNAUTHENTICATED";
}

export function AuthGate({
  client,
  turnstileSiteKey,
  resetToken,
  children,
}: {
  client: AuthClient;
  turnstileSiteKey: string;
  resetToken?: string;
  children: ReactNode | ((session: AuthSession, refreshSession: () => Promise<AuthSession | null>) => ReactNode);
}) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const refreshSession = useCallback(async () => {
    try {
      const session = await client.session();
      setState({ status: "authenticated", session });
      return session;
    } catch (error) {
      setState((current) => {
        if (isUnauthenticated(error)) return { status: "anonymous" };
        // Keep the mounted workbench during an in-place refresh failure so an
        // active mutation can report its own recoverable outcome.
        return current.status === "authenticated" ? current : { status: "error" };
      });
      return null;
    }
  }, [client]);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    void client.session().then(
      (session) => {
        if (active) setState({ status: "authenticated", session });
      },
      (error: unknown) => {
        if (!active) return;
        setState(isUnauthenticated(error) ? { status: "anonymous" } : { status: "error" });
      },
    );

    return () => {
      active = false;
    };
  }, [bootstrapAttempt, client]);

  if (state.status === "loading") {
    return <div className="auth-bootstrap" role="status" aria-live="polite">正在检查登录状态…</div>;
  }

  if (state.status === "error") {
    return (
      <div className="auth-bootstrap auth-bootstrap-error">
        <p role="alert">暂时无法确认登录状态，请检查网络后重试。</p>
        <button type="button" onClick={() => setBootstrapAttempt((attempt) => attempt + 1)}>重试</button>
      </div>
    );
  }

  if (state.status === "anonymous") {
    return (
      <AuthPanel
        client={client}
        onAuthenticated={() => setBootstrapAttempt((attempt) => attempt + 1)}
        turnstileSiteKey={turnstileSiteKey}
        resetToken={resetToken}
      />
    );
  }

  return <>{typeof children === "function" ? children(state.session, refreshSession) : children}</>;
}
