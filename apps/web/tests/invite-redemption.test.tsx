import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const token = "i".repeat(43);
const now = "2026-08-22T00:00:00.000Z";
const preview = { workspace_name: "Research", inviter_display_name: "Ming", email: "invite@example.com", role: "editor", expires_at: "2026-08-25T00:00:00.000Z", status: "pending" };
const member = { user_id: "user-2", email: preview.email, display_name: "Lin", role: "editor", revision: 1, joined_at: now, updated_at: now };
const personal = { id: "personal-1", name: "Personal", slug: "personal", role: "owner", revision: 1 };
const accepted = { id: "workspace-2", name: "Research", slug: "research", role: "editor", revision: 1 };

afterEach(() => window.history.replaceState(null, "", "/"));

describe("invite redemption route", () => {
  it("previews through auth, accepts with the query token only, and switches without persisting it", async () => {
    window.history.replaceState(null, "", `/invite/${token}`);
    const signedOut = Object.assign(new Error("signed out"), { code: "UNAUTHENTICATED", status: 401 });
    const before = { user: { id: "user-2", email: preview.email, displayName: "Lin" }, workspaces: [personal], active_workspace_id: personal.id };
    const after = { ...before, workspaces: [personal, accepted] };
    const authClient = {
      session: vi.fn().mockRejectedValueOnce(signedOut).mockResolvedValueOnce(before).mockResolvedValue(after),
      login: vi.fn(async () => ({ user: before.user })),
    };
    const apiClient = { request: vi.fn(async ({ path, method }: { path: string; method?: string }) => {
      if (path === "/api/v2/invitations/preview") return { invitation: preview };
      if (path === "/api/v2/invitations/accept" && method === "POST") return { member };
      if (path.startsWith("/api/v2/attachments")) return { items: [], next_cursor: null };
      if (path.startsWith("/api/v2/knowledge/diagnostics")) return { items: [], next_cursor: null };
      if (path === "/api/v2/notifications/unread") return { unread_count: 0 };
      throw new Error(`Unexpected ${method ?? "GET"} ${path}`);
    }) };
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const { App } = await import("../src/index") as Record<string, any>;
    render(<App authClient={authClient} apiClient={apiClient} turnstileSiteKey="test" />);

    expect(await screen.findByRole("heading", { name: "加入 Research" })).toBeInTheDocument();
    expect(screen.getByText(preview.email)).toBeInTheDocument();
    expect(screen.getByText("编辑者")).toBeInTheDocument();
    expect(screen.getByText(/2026\/8\/25/u)).toBeInTheDocument();
    await screen.findByRole("main");
    fireEvent.change(screen.getByRole("textbox", { name: "邮箱" }), { target: { value: preview.email } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "long-enough-123" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    fireEvent.click(await screen.findByRole("button", { name: "接受邀请并进入 Research" }));

    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/invitations/preview", method: "POST", body: { token }, headers: undefined }));
    expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/invitations/accept", method: "POST", body: { token }, headers: undefined }));
    await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringMatching(/^\/api\/v2\/attachments/u), headers: { "x-workspace-id": accepted.id } })));
    expect(storageSpy.mock.calls.some((call) => call.some((value) => String(value).includes(token)))).toBe(false);
    expect(JSON.stringify(window.history.state)).not.toContain(token);
    storageSpy.mockRestore();
  });

  it("shows expired state and invitation-specific errors without sending unauthorized accepts", async () => {
    window.history.replaceState(null, "", `/invite/${token}`);
    const authClient = { session: vi.fn(async () => ({ user: { id: "user-2", email: "other@example.com", displayName: "Lin" }, workspaces: [personal], active_workspace_id: personal.id })) };
    const apiClient = { request: vi.fn(async ({ path }: { path: string }) => {
      if (path === "/api/v2/invitations/preview") return { invitation: { ...preview, status: "expired" } };
      throw new Error(`Unexpected ${path}`);
    }) };
    const { App } = await import("../src/index") as Record<string, any>;
    render(<App authClient={authClient} apiClient={apiClient} turnstileSiteKey="test" />);

    expect(await screen.findByText("此邀请已过期。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "邀请不可接受" })).toBeDisabled();
    expect(apiClient.request).not.toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/invitations/accept" }));
  });
});
