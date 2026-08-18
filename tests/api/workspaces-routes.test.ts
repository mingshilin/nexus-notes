import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../worker/auth", () => ({
  randomToken: vi.fn(() => "invite-token"),
  sha256: vi.fn(async () => "hashed-token"),
  buildWorkspaceCookie: vi.fn(),
}));

vi.mock("../../worker/mail", () => ({
  sendEmailByResend: vi.fn(async () => undefined),
}));

vi.mock("../../worker/db/queries", () => ({
  addWorkspaceMember: vi.fn(),
  createWorkspace: vi.fn(),
  createWorkspaceInvite: vi.fn(),
  getNoteById: vi.fn(),
  getUserById: vi.fn(),
  getUserByEmail: vi.fn(),
  getWorkspaceById: vi.fn(),
  getWorkspaceInviteByTokenHash: vi.fn(),
  getWorkspaceInvitePreviewByTokenHash: vi.fn(),
  getWorkspaceMember: vi.fn(),
  listUserWorkspaces: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  markWorkspaceInviteAccepted: vi.fn(),
}));

import { handleInviteWorkspaceMember, handlePreviewWorkspaceInvite } from "../../worker/routes/workspaces";
import { createWorkspaceInvite, getNoteById, getUserById, getWorkspaceById, getWorkspaceInvitePreviewByTokenHash } from "../../worker/db/queries";
import { sendEmailByResend } from "../../worker/mail";

describe("workspace invite routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps original invite behavior without note_id", async () => {
    vi.mocked(createWorkspaceInvite).mockResolvedValue(undefined);
    vi.mocked(getWorkspaceById).mockResolvedValue({ id: "ws-1", name: "Workspace", owner_user_id: "u1", created_at: "x", updated_at: "x" });
    vi.mocked(getUserById).mockResolvedValue({ id: "u1", email: "owner@example.com", display_name: "Owner", password_hash: "", bio: null, avatar_url: null, email_verified_at: "x", created_at: "x", updated_at: "x" });

    const request = new Request("http://localhost/api/workspaces/ws-1/invites", {
      method: "POST",
      body: JSON.stringify({ email: "a@example.com", role: "editor" }),
    });

    const response = await handleInviteWorkspaceMember({} as D1Database, "user-1", "ws-1", request, {
      APP_BASE_URL: "https://notes.example.com",
      APP_NAME: "Notes",
      RESEND_API_KEY: "resend",
      EMAIL_FROM: "noreply@example.com",
    });
    const body = await response.json() as { success: boolean; data: { invite_url: string; note_id?: string | null } };

    expect(body.success).toBe(true);
    expect(body.data.invite_url).toBe("https://notes.example.com/?invite=invite-token");
    expect(body.data.note_id ?? null).toBeNull();
    expect(sendEmailByResend).toHaveBeenCalled();
  });

  it("appends note query when note_id is provided", async () => {
    vi.mocked(createWorkspaceInvite).mockResolvedValue(undefined);
    vi.mocked(getWorkspaceById).mockResolvedValue({ id: "ws-1", name: "Workspace", owner_user_id: "u1", created_at: "x", updated_at: "x" });
    vi.mocked(getUserById).mockResolvedValue({ id: "u1", email: "owner@example.com", display_name: "Owner", password_hash: "", bio: null, avatar_url: null, email_verified_at: "x", created_at: "x", updated_at: "x" });
    vi.mocked(getNoteById).mockResolvedValue({
      id: "note-1",
      title: "Shared note",
      content: "",
      folder_id: null,
      folder: null,
      is_favorite: false,
      is_pinned: false,
      is_daily: false,
      daily_date: null,
      created_at: "x",
      updated_at: "x",
      deleted_at: null,
      archived_at: null,
      last_opened_at: null,
      tags: [],
    });

    const request = new Request("http://localhost/api/workspaces/ws-1/invites", {
      method: "POST",
      body: JSON.stringify({ email: "a@example.com", role: "editor", note_id: "note-1" }),
    });

    const response = await handleInviteWorkspaceMember({} as D1Database, "user-1", "ws-1", request, {
      APP_BASE_URL: "https://notes.example.com",
      APP_NAME: "Notes",
      RESEND_API_KEY: "resend",
      EMAIL_FROM: "noreply@example.com",
    });
    const body = await response.json() as { success: boolean; data: { invite_url: string; note_id?: string | null } };

    expect(body.success).toBe(true);
    expect(body.data.note_id).toBe("note-1");
    expect(body.data.invite_url).toContain("invite=invite-token");
    expect(body.data.invite_url).toContain("note=note-1");
  });

  it("returns invite preview metadata", async () => {
    vi.mocked(getWorkspaceInvitePreviewByTokenHash).mockResolvedValue({
      workspace_id: "ws-1",
      workspace_name: "Workspace",
      email: "a@example.com",
      role: "editor",
      note_id: "note-1",
      expires_at: "2999-01-01T00:00:00.000Z",
      accepted_at: null,
      inviter_display_name: "Owner",
      inviter_email: "owner@example.com",
      note_title: "Shared note",
    });

    const response = await handlePreviewWorkspaceInvite({} as D1Database, "invite-token");
    const body = await response.json() as { success: boolean; data: { workspace_name: string; note_title: string } };

    expect(body.success).toBe(true);
    expect(body.data.workspace_name).toBe("Workspace");
    expect(body.data.note_title).toBe("Shared note");
  });
});
