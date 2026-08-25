import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountCenter } from "../src/account/AccountCenter";

const profile = {
  id: "u1", email: "user@example.test", display_name: "User", biography: "",
  locale: "zh-CN", timezone: "Asia/Shanghai", avatar_url: null,
  updated_at: "2026-08-25T00:00:00.000Z",
};
const preferences = {
  user_id: "u1", default_domain: "notes" as const, density: "comfortable" as const, reduced_motion: false,
  week_starts_on: 1 as const, date_format: "yyyy-MM-dd" as const, default_snooze_minutes: 10,
  email_reminders: false, push_reminders: false, in_app_reminders: true,
  quiet_hours: null, show_push_title: false, revision: 1,
  updated_at: "2026-08-25T00:00:00.000Z",
};

function client() {
  return {
    getProfile: vi.fn(async () => profile), listSessions: vi.fn(async () => []),
    updateProfile: vi.fn(), uploadAvatar: vi.fn(), deleteAvatar: vi.fn(), requestEmailChange: vi.fn(),
    confirmEmailChange: vi.fn(), changePassword: vi.fn(), revokeSession: vi.fn(), deleteAccount: vi.fn(),
    getOverview: vi.fn(async () => ({
      counts: { workspaces: 2, sessions: 1, notes: 10, databases: 3, upcoming_reminders: 4 },
      profile_complete: true, ai_configured: false,
      recent_activity: [{ id: "a1", event: "preferences.updated", request_id: "req-1", created_at: "2026-08-25T00:00:00.000Z" }],
    })),
    getPreferences: vi.fn(async () => preferences),
    updatePreferences: vi.fn(async () => ({ ...preferences, density: "compact" as const, revision: 2 })),
    listPushSubscriptions: vi.fn(async () => []), testPush: vi.fn(async () => ({ queued: 1 })),
    revokeOtherSessions: vi.fn(async () => ({ revoked: 2 })),
  };
}

describe("account depth UI", () => {
  it("renders overview usage, security, activity, reminder and AI state", async () => {
    render(<AccountCenter client={client() as never} workspaces={[]} activeWorkspaceId={null} onWorkspaceChange={vi.fn()} onDeleted={vi.fn()} initialTab="overview" />);
    expect(await screen.findByText("10 条笔记")).toBeInTheDocument();
    expect(screen.getByText("4 条即将到期提醒")).toBeInTheDocument();
    expect(screen.getByText("AI 未配置")).toBeInTheDocument();
    expect(screen.getByText("preferences.updated")).toBeInTheDocument();
  });

  it("saves preference controls and revokes other sessions from security", async () => {
    const api = client();
    render(<AccountCenter client={api as never} workspaces={[]} activeWorkspaceId={null} onWorkspaceChange={vi.fn()} onDeleted={vi.fn()} initialTab="preferences" />);
    fireEvent.change(await screen.findByLabelText("界面密度"), { target: { value: "compact" } });
    fireEvent.click(screen.getByRole("button", { name: "保存偏好设置" }));
    await waitFor(() => expect(api.updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ base_revision: 1, density: "compact" }), expect.anything()));
    fireEvent.click(screen.getByRole("tab", { name: "安全" }));
    fireEvent.click(await screen.findByRole("button", { name: "撤销其他全部会话" }));
    await waitFor(() => expect(api.revokeOtherSessions).toHaveBeenCalledOnce());
    expect(await screen.findByText("已撤销 2 个其他会话。")).toBeInTheDocument();
  });
});
