import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_INVALID_EVENT } from "@/api/client";
import { useAuthBootstrap } from "@/hooks/useAuthBootstrap";
import type { AuthUser } from "@/types/auth";
import type { WorkspaceInvitePreview } from "@/types/workspace";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const authUser: AuthUser = {
  id: "u1",
  email: "user@example.com",
  email_verified_at: "2026-05-20T00:00:00.000Z",
  created_at: "2026-05-20T00:00:00.000Z",
  current_workspace: { id: "ws-1", name: "Workspace", owner_user_id: "u1", role: "owner" },
};

function successResponse<T>(data: T) {
  return Promise.resolve(new Response(JSON.stringify({ success: true, data }), {
    headers: { "content-type": "application/json" },
  }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("useAuthBootstrap", () => {
  it("loads the current user once on bootstrap", async () => {
    const setUser = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => successResponse(authUser)));

    const { result } = renderHook(() => useAuthBootstrap({ user: null, setUser, handleSignedOut: vi.fn() }));

    await waitFor(() => expect(result.current.authLoading).toBe(false));
    expect(setUser).toHaveBeenCalledWith(authUser);
    expect(fetch).toHaveBeenCalledWith("/api/auth/me", expect.objectContaining({
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
    }));
  });

  it("extracts reset tokens from reset-password URLs", async () => {
    vi.stubGlobal("fetch", vi.fn(() => successResponse(authUser)));
    window.history.replaceState({}, "", "/reset-password?token=reset-1");

    const { result } = renderHook(() => useAuthBootstrap({ user: null, setUser: vi.fn(), handleSignedOut: vi.fn() }));

    await waitFor(() => expect(result.current.resetToken).toBe("reset-1"));
    await waitFor(() => expect(result.current.authLoading).toBe(false));
  });

  it("loads invite preview from invite URLs", async () => {
    const preview: WorkspaceInvitePreview = {
      workspace_id: "ws-1",
      workspace_name: "Team",
      invited_email_masked: "u***@example.com",
      role: "editor",
      expires_at: "2026-05-21T00:00:00.000Z",
      inviter_display: "Owner",
    };
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/workspaces/invites/preview")) return successResponse(preview);
      return successResponse(authUser);
    }));
    window.history.replaceState({}, "", "/?invite=invite-1");

    const { result } = renderHook(() => useAuthBootstrap({ user: null, setUser: vi.fn(), handleSignedOut: vi.fn() }));

    await waitFor(() => expect(result.current.pendingInviteToken).toBe("invite-1"));
    await waitFor(() => expect(result.current.pendingInvitePreview).toEqual(preview));
    await waitFor(() => expect(result.current.authLoading).toBe(false));
  });

  it("extracts internal note ids without handling public share state", async () => {
    vi.stubGlobal("fetch", vi.fn(() => successResponse(authUser)));
    window.history.replaceState({}, "", "/?note=note-1&share=share-1");

    const { result } = renderHook(() => useAuthBootstrap({ user: null, setUser: vi.fn(), handleSignedOut: vi.fn() }));

    await waitFor(() => expect(result.current.pendingNoteId).toBe("note-1"));
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    expect("pendingPublicShareToken" in result.current).toBe(false);
  });

  it("handles auth invalid events through the signed-out callback", async () => {
    const handleSignedOut = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => successResponse(authUser)));

    const { result } = renderHook(() => useAuthBootstrap({ user: null, setUser: vi.fn(), handleSignedOut }));
    await act(async () => {
      window.dispatchEvent(new CustomEvent(AUTH_INVALID_EVENT, { detail: { code: "SESSION_EXPIRED" } }));
    });

    expect(handleSignedOut).toHaveBeenCalledWith("登录状态已过期，请重新登录");
    await waitFor(() => expect(result.current.authLoading).toBe(false));
  });
});
