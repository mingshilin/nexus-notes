import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AUTH_INVALID_EVENT } from "@/api/client";
import { getCurrentUser, verifyEmail } from "@/api/auth";
import { getWorkspaceInvitePreview } from "@/api/workspaces";
import { getErrorMessage } from "@/lib/errorMessages";
import type { AuthUser } from "@/types/auth";
import type { WorkspaceInvitePreview } from "@/types/workspace";

interface UseAuthBootstrapOptions {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  handleSignedOut: (message?: string) => void;
}

export function useAuthBootstrap({ user, setUser, handleSignedOut }: UseAuthBootstrapOptions) {
  const handleSignedOutRef = useRef(handleSignedOut);
  const [authLoading, setAuthLoading] = useState(true);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null);
  const [pendingInvitePreview, setPendingInvitePreview] = useState<WorkspaceInvitePreview | null>(null);

  useEffect(() => {
    handleSignedOutRef.current = handleSignedOut;
  }, [handleSignedOut]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token") ?? url.searchParams.get("resetToken") ?? url.searchParams.get("reset_token");
    const mode = (url.searchParams.get("mode") ?? "").toLowerCase();
    const inviteToken = url.searchParams.get("invite");
    const noteId = url.searchParams.get("note");
    const normalizedPath = url.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    const hashQuery = url.hash.includes("?") ? new URLSearchParams(url.hash.split("?")[1]) : null;
    const tokenFromHash = hashQuery?.get("token") ?? hashQuery?.get("resetToken") ?? hashQuery?.get("reset_token");
    const resolvedToken = token ?? tokenFromHash;

    if (normalizedPath === "/verify-email" && resolvedToken) {
      const verifyToken = decodeURIComponent(resolvedToken.trim());
      verifyEmail(verifyToken)
        .then(() => toast.success("邮箱验证成功"))
        .catch((error) => toast.error(getErrorMessage(error, "验证失败")))
        .finally(() => window.history.replaceState({}, "", "/"));
      return;
    }

    const isResetPath =
      normalizedPath === "/reset-password" ||
      normalizedPath === "/reset" ||
      mode === "reset-password" ||
      mode === "reset";

    if (isResetPath && resolvedToken) {
      setResetToken(decodeURIComponent(resolvedToken.trim()));
      return;
    }

    if (resolvedToken && normalizedPath !== "/verify-email") {
      setResetToken(decodeURIComponent(resolvedToken.trim()));
    }
    if (inviteToken) {
      setPendingInviteToken(decodeURIComponent(inviteToken.trim()));
    }
    if (noteId?.trim()) {
      setPendingNoteId(decodeURIComponent(noteId.trim()));
    }
  }, []);

  useEffect(() => {
    if (!pendingInviteToken) {
      setPendingInvitePreview(null);
      return;
    }
    getWorkspaceInvitePreview(pendingInviteToken)
      .then(setPendingInvitePreview)
      .catch(() => setPendingInvitePreview(null));
  }, [pendingInviteToken]);

  useEffect(() => {
    getCurrentUser()
      .then((currentUser) => setUser(currentUser))
      .catch(() => handleSignedOutRef.current())
      .finally(() => setAuthLoading(false));
  }, [setUser]);

  useEffect(() => {
    const onAuthInvalid = (event: Event) => {
      const detail = (event as CustomEvent<{ code?: string }>).detail;
      const message = detail?.code === "SESSION_EXPIRED" ? "登录状态已过期，请重新登录" : "登录状态失效，请重新登录";
      handleSignedOutRef.current(message);
      setAuthLoading(false);
    };
    window.addEventListener(AUTH_INVALID_EVENT, onAuthInvalid as EventListener);
    return () => window.removeEventListener(AUTH_INVALID_EVENT, onAuthInvalid as EventListener);
  }, []);

  return {
    authLoading,
    resetToken,
    setResetToken,
    pendingInviteToken,
    setPendingInviteToken,
    pendingNoteId,
    setPendingNoteId,
    pendingInvitePreview,
  };
}
