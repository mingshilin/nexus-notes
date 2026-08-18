import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../worker/db/queries", () => ({
  createPublicNoteShare: vi.fn(),
  getDatabaseById: vi.fn(),
  getLatestNoteVersion: vi.fn(),
  findNoteByTitle: vi.fn(),
  getDailyNoteByDate: vi.fn(),
  getGraphData: vi.fn(),
  listDatabasePermissions: vi.fn(),
  getNoteVersionById: vi.fn(),
  getNoteById: vi.fn(),
  insertActivityLog: vi.fn(),
  insertNoteVersion: vi.fn(),
  insertNote: vi.fn(),
  listBacklinks: vi.fn(),
  listNoteLinks: vi.fn(),
  listNotes: vi.fn(),
  listNoteVersions: vi.fn(),
  emptyTrash: vi.fn(),
  permanentlyDeleteNoteById: vi.fn(),
  replaceNoteTags: vi.fn(),
  rebuildNoteLinks: vi.fn(),
  revokePublicSharesByNoteId: vi.fn(),
  restoreNoteById: vi.fn(),
  softDeleteNoteById: vi.fn(),
  updateNoteById: vi.fn(),
}));

import {
  handleCreateNote,
  handleCreatePublicNoteShare,
  handleDeleteNote,
  handleListNotes,
  handleRevokePublicNoteShare,
  handleUpdateNote,
  handleUpdateNoteTags,
} from "../../worker/routes/notes";
import {
  createPublicNoteShare,
  getLatestNoteVersion,
  getDatabaseById,
  getNoteById,
  insertActivityLog,
  insertNoteVersion,
  insertNote,
  listDatabasePermissions,
  listNotes,
  replaceNoteTags,
  revokePublicSharesByNoteId,
  softDeleteNoteById,
  updateNoteById,
} from "../../worker/db/queries";

const userId = "user-1";
const workspaceId = "ws-1";

function noteFixture(overrides = {}) {
  return {
    id: "n1",
    folder_id: null,
    folder: null,
    title: "t",
    content: "c",
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
    ...overrides,
  };
}

describe("notes routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters database-backed notes from search results when database is unreadable", async () => {
    vi.mocked(listNotes).mockResolvedValue({
      items: [
        noteFixture({ id: "n1", database_id: "db-visible" }),
        noteFixture({ id: "n2", database_id: "db-hidden" }),
        noteFixture({ id: "n3", database_id: null }),
      ],
      page: 1,
      pageSize: 30,
      total: 3,
    });
    vi.mocked(getDatabaseById).mockImplementation((_db, _workspaceId, databaseId) => Promise.resolve({
      id: databaseId,
      workspace_id: workspaceId,
      name: databaseId,
      description: null,
      icon: null,
      created_by_user_id: userId,
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    }));
    vi.mocked(listDatabasePermissions).mockImplementation((_db, _workspaceId, databaseId) => Promise.resolve(databaseId === "db-visible"
      ? [{ id: "p1", database_id: "db-visible", subject_type: "workspace_role", subject_id: "viewer", role: "viewer", created_at: "x", updated_at: "x" }]
      : [{ id: "p2", database_id: "db-hidden", subject_type: "workspace_role", subject_id: "editor", role: "editor", created_at: "x", updated_at: "x" }]));

    const response = await handleListNotes({} as D1Database, userId, workspaceId, new Request("http://localhost/api/notes?q=n"), { workspaceRole: "viewer" });
    const body = await response.json() as { success: boolean; data: Array<{ id: string }>; meta: { total: number } };

    expect(body.data.map((note) => note.id)).toEqual(["n1", "n3"]);
    expect(body.meta.total).toBe(2);
  });

  it("creates note with unified response envelope", async () => {
    vi.mocked(insertNote).mockResolvedValue(undefined);
    vi.mocked(getLatestNoteVersion).mockResolvedValue(null);
    vi.mocked(insertNoteVersion).mockResolvedValue(undefined);
    vi.mocked(getNoteById).mockResolvedValue(noteFixture({
      title: "hello",
      content: "world",
    }));

    const request = new Request("http://localhost/api/notes", {
      method: "POST",
      body: JSON.stringify({ title: "hello", content: "world" }),
    });

    const response = await handleCreateNote({} as D1Database, userId, workspaceId, request);
    const body = (await response.json()) as { success: boolean; data: { id: string } };

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("n1");
  });

  it("rejects invalid update payload", async () => {
    const request = new Request("http://localhost/api/notes/n1", {
      method: "PUT",
      body: JSON.stringify({}),
    });

    await expect(handleUpdateNote({} as D1Database, userId, workspaceId, "n1", request)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("soft deletes note", async () => {
    vi.mocked(getNoteById).mockResolvedValue(noteFixture());
    vi.mocked(softDeleteNoteById).mockResolvedValue(undefined);

    const response = await handleDeleteNote({} as D1Database, userId, workspaceId, "n1");
    const body = (await response.json()) as { success: boolean; data: { id: string } };

    expect(softDeleteNoteById).toHaveBeenCalledWith(expect.anything(), userId, workspaceId, "n1");
    expect(body).toEqual({ success: true, data: { id: "n1" } });
  });

  it("updates note tags", async () => {
    vi.mocked(replaceNoteTags).mockResolvedValue(undefined);
    vi.mocked(getNoteById).mockResolvedValue(noteFixture({
      is_favorite: true,
      tags: [{ id: "tag-1", name: "work", color: "#6B9EFF", created_at: "x", updated_at: "x" }],
    }));

    const request = new Request("http://localhost/api/notes/n1/tags", {
      method: "PUT",
      body: JSON.stringify({ tagIds: ["tag-1"] }),
    });

    const response = await handleUpdateNoteTags({} as D1Database, userId, workspaceId, "n1", request);
    const body = (await response.json()) as { success: boolean };

    expect(replaceNoteTags).toHaveBeenCalledWith(expect.anything(), userId, workspaceId, "n1", ["tag-1"]);
    expect(body.success).toBe(true);
  });

  it("audits public share creation and revocation", async () => {
    vi.mocked(getNoteById).mockResolvedValue(noteFixture());
    vi.mocked(revokePublicSharesByNoteId).mockResolvedValue(undefined);
    vi.mocked(createPublicNoteShare).mockResolvedValue(undefined);

    await handleCreatePublicNoteShare(
      {} as D1Database,
      userId,
      workspaceId,
      "n1",
      new Request("http://localhost/api/notes/n1/share", {
        method: "POST",
        body: JSON.stringify({ password: "secret", expires_in: 3600 }),
      }),
      "http://localhost",
    );

    await handleRevokePublicNoteShare({} as D1Database, userId, workspaceId, "n1");

    expect(insertActivityLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      workspaceId,
      actorUserId: userId,
      action: "share.create",
      entityType: "note",
      entityId: "n1",
      audit: true,
      metadata: expect.objectContaining({ password_protected: true }),
    }));
    expect(insertActivityLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      workspaceId,
      actorUserId: userId,
      action: "share.revoke",
      entityType: "note",
      entityId: "n1",
      audit: true,
    }));
  });
});
