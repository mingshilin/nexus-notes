import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../worker/auth", () => ({
  randomToken: vi.fn(() => "share-token"),
  sha256: vi.fn(async (input: string) => `hashed:${input}`),
}));

vi.mock("../../worker/db/queries", () => ({
  archiveNoteById: vi.fn(),
  createPublicNoteShare: vi.fn(),
  emptyTrash: vi.fn(),
  findNoteByTitle: vi.fn(),
  getDailyNoteByDate: vi.fn(),
  getGraphData: vi.fn(),
  getLatestNoteVersion: vi.fn(),
  getNoteById: vi.fn(),
  getPublicShareSummaryByNoteId: vi.fn(),
  getNoteVersionById: vi.fn(),
  getPublicSharedNoteByTokenHash: vi.fn(),
  insertActivityLog: vi.fn(),
  insertNote: vi.fn(),
  insertNoteVersion: vi.fn(),
  listBacklinks: vi.fn(),
  listNoteLinks: vi.fn(),
  listNoteVersions: vi.fn(),
  listNotes: vi.fn(),
  markNoteOpened: vi.fn(),
  permanentlyDeleteNoteById: vi.fn(),
  replaceNoteTags: vi.fn(),
  rebuildNoteLinks: vi.fn(),
  restoreNoteById: vi.fn(),
  revokePublicSharesByNoteId: vi.fn(),
  softDeleteNoteById: vi.fn(),
  unarchiveNoteById: vi.fn(),
  updateNoteById: vi.fn(),
}));

import { handleCreatePublicNoteShare, handleGetPublicSharedNote, handleRevokePublicNoteShare } from "../../worker/routes/notes";
import { createPublicNoteShare, getNoteById, getPublicSharedNoteByTokenHash, insertActivityLog, revokePublicSharesByNoteId } from "../../worker/db/queries";

describe("public note share routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates standalone note share link", async () => {
    vi.mocked(getNoteById).mockResolvedValue({
      id: "n1",
      folder_id: null,
      folder: null,
      title: "Shared Note",
      content: "hello",
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
    vi.mocked(revokePublicSharesByNoteId).mockResolvedValue(undefined);
    vi.mocked(createPublicNoteShare).mockResolvedValue(undefined);

    const request = new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify({ expires_in: 86400 }),
    });
    const response = await handleCreatePublicNoteShare({} as D1Database, "u1", "ws1", "n1", request, "https://notes.example.com");
    const body = await response.json() as { success: boolean; data: { share_url: string } };

    expect(body.success).toBe(true);
    expect(body.data.share_url).toBe("https://notes.example.com/?share=share-token");
    expect(insertActivityLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "share.create",
      actorUserId: "u1",
      entityId: "n1",
      entityType: "note",
      workspaceId: "ws1",
    }));
  });

  it("opens public shared note by token", async () => {
    vi.mocked(getPublicSharedNoteByTokenHash).mockResolvedValue({
      note_id: "n1",
      access_mode: "read",
      share_created_at: "x",
      id: "n1",
      title: "Shared Note",
      content: "hello",
      updated_at: "x",
      created_at: "x",
      workspace_name: "Workspace",
      shared_by_display_name: "Owner",
      shared_by_email: "owner@example.com",
    });

    const response = await handleGetPublicSharedNote({} as D1Database, "share-token");
    const body = await response.json() as { success: boolean; data: { note: { title: string } } };

    expect(body.success).toBe(true);
    expect(body.data.note.title).toBe("Shared Note");
  });

  it("revokes current public share", async () => {
    vi.mocked(getNoteById).mockResolvedValue({
      id: "n1",
      folder_id: null,
      folder: null,
      title: "Shared Note",
      content: "hello",
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
    vi.mocked(revokePublicSharesByNoteId).mockResolvedValue(undefined);

    const response = await handleRevokePublicNoteShare({} as D1Database, "u1", "ws1", "n1");
    const body = await response.json() as { success: boolean; data: { revoked: true } };

    expect(body.success).toBe(true);
    expect(body.data.revoked).toBe(true);
    expect(insertActivityLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "share.revoke",
      actorUserId: "u1",
      entityId: "n1",
      entityType: "note",
      workspaceId: "ws1",
    }));
  });
});
