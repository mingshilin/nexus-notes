import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useShareFlow } from "@/hooks/useShareFlow";
import type { AuthUser } from "@/types/auth";
import type { NoteWithTags, PublicSharedNote } from "@/types/note";

const sharesApi = vi.hoisted(() => ({
  createPublicNoteShare: vi.fn(),
  getPublicNoteShareSummary: vi.fn(),
  getPublicSharedNote: vi.fn(),
  revokePublicNoteShare: vi.fn(),
}));

vi.mock("@/api/shares", () => sharesApi);
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const user: AuthUser = {
  id: "u1",
  email: "user@example.com",
  email_verified_at: "2026-05-20T00:00:00.000Z",
  created_at: "2026-05-20T00:00:00.000Z",
  current_workspace: { id: "ws-1", name: "Workspace", owner_user_id: "u1", role: "owner" },
};

function makeNote(overrides: Partial<NoteWithTags> = {}): NoteWithTags {
  return {
    id: overrides.id ?? "note-1",
    folder_id: overrides.folder_id ?? null,
    database_id: overrides.database_id,
    title: overrides.title ?? "Alpha",
    content: overrides.content ?? "Body",
    is_favorite: overrides.is_favorite ?? false,
    is_pinned: overrides.is_pinned ?? false,
    is_daily: overrides.is_daily ?? false,
    daily_date: overrides.daily_date ?? null,
    created_at: overrides.created_at ?? "2026-05-19T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-05-20T00:00:00.000Z",
    deleted_at: overrides.deleted_at ?? null,
    archived_at: overrides.archived_at ?? null,
    last_opened_at: overrides.last_opened_at ?? null,
    tags: overrides.tags ?? [],
    folder: overrides.folder ?? null,
    database_values: overrides.database_values,
  };
}

function makeSharedNote(): PublicSharedNote {
  return {
    note: {
      id: "note-1",
      title: "Shared",
      content: "Content",
      created_at: "2026-05-20T00:00:00.000Z",
      updated_at: "2026-05-20T00:00:00.000Z",
    },
    access_mode: "read",
    workspace_name: "Team",
    shared_by: "Owner",
    created_at: "2026-05-20T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("useShareFlow", () => {
  it("loads public shared notes from share URLs and retries with password", async () => {
    const sharedNote = makeSharedNote();
    sharesApi.getPublicSharedNote.mockResolvedValue(sharedNote);
    window.history.replaceState({}, "", "/?share=share-1");

    const { result } = renderHook(() => useShareFlow({ user: null, allKnownNotes: new Map() }));

    await waitFor(() => expect(result.current.pendingPublicShareToken).toBe("share-1"));
    await waitFor(() => expect(result.current.publicSharedNote).toEqual(sharedNote));

    act(() => result.current.setPublicSharePassword("secret"));

    await waitFor(() => expect(sharesApi.getPublicSharedNote).toHaveBeenLastCalledWith("share-1", "secret"));
  });

  it("loads share summary when opening the share dialog", async () => {
    const note = makeNote({ id: "note-1", title: "Share me" });
    sharesApi.getPublicNoteShareSummary.mockResolvedValue({ active: true, expires_at: null });

    const { result } = renderHook(() => useShareFlow({
      user,
      allKnownNotes: new Map([[note.id, note]]),
    }));

    act(() => result.current.openShareDialog("note-1"));

    await waitFor(() => expect(result.current.shareDialogNote).toEqual(note));
    await waitFor(() => expect(result.current.publicShareSummary).toEqual({ active: true, expires_at: null }));
  });

  it("creates and revokes public shares", async () => {
    sharesApi.createPublicNoteShare.mockResolvedValue({
      note_id: "note-1",
      access_mode: "read",
      share_url: "https://example.com/share",
      created_at: "2026-05-20T00:00:00.000Z",
      expires_at: "2026-05-21T00:00:00.000Z",
    });
    sharesApi.revokePublicNoteShare.mockResolvedValue({ revoked: true });

    const { result } = renderHook(() => useShareFlow({ user, allKnownNotes: new Map() }));

    await act(async () => {
      const share = await result.current.handleCreatePublicShare("note-1", 86400, "secret");
      expect(share).toEqual({ share_url: "https://example.com/share", expires_at: "2026-05-21T00:00:00.000Z" });
    });
    expect(sharesApi.createPublicNoteShare).toHaveBeenCalledWith("note-1", 86400, "secret");
    expect(result.current.publicShareSummary).toEqual({ active: true, expires_at: "2026-05-21T00:00:00.000Z" });

    await act(async () => {
      await result.current.handleRevokePublicShare("note-1");
    });
    expect(sharesApi.revokePublicNoteShare).toHaveBeenCalledWith("note-1");
    expect(result.current.publicShareSummary).toEqual({ active: false, expires_at: null });
  });
});
