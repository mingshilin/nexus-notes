import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../worker/db/queries", () => ({
  deleteNoteAttachmentById: vi.fn(),
  getNoteAttachmentById: vi.fn(),
  getNoteById: vi.fn(),
  insertNoteAttachment: vi.fn(),
  listNoteAttachments: vi.fn(),
}));

import { handleUploadNoteAttachment } from "../../worker/routes/attachments";
import { getNoteById, insertNoteAttachment } from "../../worker/db/queries";

const userId = "user-1";
const workspaceId = "ws-1";
const noteId = "note-1";

function createUploadRequest(file: File) {
  const form = new FormData();
  form.append("file", file);
  return new Request(`http://localhost/api/notes/${noteId}/attachments`, {
    method: "POST",
    body: form,
  });
}

describe("attachments routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getNoteById).mockResolvedValue({
      id: noteId,
      folder_id: null,
      folder: null,
      database_id: null,
      title: "note",
      content: "",
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
    vi.mocked(insertNoteAttachment).mockResolvedValue(undefined);
  });

  it("accepts pdf attachments for OCR workflows", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const request = createUploadRequest(new File(["%PDF-1.7"], "guide.pdf", { type: "application/pdf" }));

    const response = await handleUploadNoteAttachment({} as D1Database, request, {
      userId,
      workspaceId,
      noteId,
      bucket: { put } as unknown as R2Bucket,
    });
    const body = (await response.json()) as {
      success: boolean;
      data: { file_name: string; mime_type: string; markdown_url: string };
    };

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.file_name).toBe("guide.pdf");
    expect(body.data.mime_type).toBe("application/pdf");
    expect(body.data.markdown_url).toMatch(/^\/api\/attachments\/.+\/file$/);
    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/\.pdf$/),
      expect.any(ArrayBuffer),
      expect.objectContaining({ httpMetadata: { contentType: "application/pdf" } }),
    );
    expect(insertNoteAttachment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fileName: "guide.pdf",
        mimeType: "application/pdf",
      }),
    );
  });

  it("rejects unsupported attachment types", async () => {
    const request = createUploadRequest(new File(["hello"], "notes.txt", { type: "text/plain" }));

    await expect(
      handleUploadNoteAttachment({} as D1Database, request, {
        userId,
        workspaceId,
        noteId,
        bucket: { put: vi.fn() } as unknown as R2Bucket,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "unsupported attachment type",
      status: 400,
    });
  });
});
