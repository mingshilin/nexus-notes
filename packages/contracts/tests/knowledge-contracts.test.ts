import { describe, expect, it } from "vitest";

type ContractExports = Record<string, any>;

async function loadContracts() {
  return (await import("../src")) as ContractExports;
}

describe("knowledge contracts", () => {
  it("validates private attachment, OCR retry, and diagnostics contracts", async () => {
    const contracts = await loadContracts();
    const timestamp = "2026-08-21T00:00:00.000Z";
    expect(contracts.AttachmentSchema).toBeDefined();
    expect(contracts.AttachmentSchema.safeParse({
      id: "attachment-1", workspace_id: "ws-1", note_id: "note-1", filename: "scan.pdf",
      mime_type: "application/pdf", size_bytes: 42, status: "ready", revision: 1,
      ocr_status: null, ocr_attempt_count: null, ocr_updated_at: null,
      created_at: timestamp, updated_at: timestamp,
    }).success).toBe(true);
    expect(contracts.UploadCompleteInputSchema.parse({ upload_id: "upload-1" })).toEqual({ upload_id: "upload-1" });
    expect(contracts.AttachmentListRequestSchema.parse({ mime_type: "application/pdf", limit: 10 })).toMatchObject({
      mime_type: "application/pdf", limit: 10,
    });
    expect(contracts.OcrJobSchema.safeParse({
      id: "ocr-1", workspace_id: "ws-1", attachment_id: "attachment-1", status: "failed",
      idempotency_key: "ocr:attachment-1:1", attempt_count: 1,
      deadline: timestamp, last_error_code: "OCR_TIMEOUT", revision: 1,
      created_at: timestamp, updated_at: timestamp,
    }).success).toBe(true);
    expect(contracts.OcrRetryInputSchema.parse({ attachment_ids: ["attachment-1", "attachment-1"] })).toEqual({
      attachment_ids: ["attachment-1"],
    });
    expect(contracts.KnowledgeDiagnosticsRequestSchema.parse({ limit: 25 })).toEqual({ limit: 25 });
    expect(contracts.KnowledgeDiagnosticSchema.safeParse({
      kind: "failed_ocr", entity_id: "attachment-1", title: "scan.pdf", count: 1,
    }).success).toBe(true);
  });

  it("exposes only strict, safe OCR recovery metadata and supports OCR list filters", async () => {
    const contracts = await loadContracts();
    const timestamp = "2026-08-21T00:00:00.000Z";
    const attachment = contracts.AttachmentSchema.parse({
      id: "attachment-1", workspace_id: "ws-1", note_id: null, filename: "scan.pdf",
      mime_type: "application/pdf", size_bytes: 42, status: "ready", revision: 2,
      ocr_status: "failed", ocr_attempt_count: 2, ocr_updated_at: timestamp,
      created_at: timestamp, updated_at: timestamp,
    });

    expect(attachment).toMatchObject({
      ocr_status: "failed", ocr_attempt_count: 2, ocr_updated_at: timestamp,
    });
    expect(contracts.AttachmentSchema.safeParse({ ...attachment, object_key: "ws-1/attachments/secret" }).success).toBe(false);
    expect(contracts.AttachmentSchema.safeParse({ ...attachment, ocr_text: "private OCR" }).success).toBe(false);
    expect(contracts.AttachmentListRequestSchema.parse({ ocr_status: "dead_letter", limit: 10 })).toMatchObject({
      ocr_status: "dead_letter", limit: 10,
    });
    expect(contracts.KnowledgeDiagnosticSchema.parse({
      kind: "failed_ocr", entity_id: "attachment-1", title: "scan.pdf", count: 2,
      failure_count: 2, ocr_status: "dead_letter", latest_error: "ocr_attempts_exhausted",
    })).toMatchObject({ failure_count: 2, ocr_status: "dead_letter", latest_error: "ocr_attempts_exhausted" });
    expect(contracts.KnowledgeDiagnosticSchema.safeParse({
      kind: "failed_ocr", entity_id: "attachment-1", title: "scan.pdf", count: 2,
      ocr_status: "dead_letter", latest_error: "OCR_INTERNAL_STACK_TRACE",
    }).success).toBe(false);
  });

  it("validates tenant-scoped folders, tags, links, and reminders", async () => {
    const contracts = await loadContracts();
    expect(contracts.FolderSchema.safeParse({
      id: "folder-1", workspace_id: "ws-1", parent_id: null, name: "Projects",
      position: 0, revision: 1, created_at: "2026-08-21T00:00:00.000Z", updated_at: "2026-08-21T00:00:00.000Z",
    }).success).toBe(true);
    expect(contracts.TagSchema.safeParse({
      id: "tag-1", workspace_id: "ws-1", name: "research", color: "#14B8A6",
      revision: 1, created_at: "2026-08-21T00:00:00.000Z", updated_at: "2026-08-21T00:00:00.000Z",
    }).success).toBe(true);
    expect(contracts.NoteLinkSchema.safeParse({
      id: "link-1", workspace_id: "ws-1", source_note_id: "note-1", target_note_id: "note-2",
      created_at: "2026-08-21T00:00:00.000Z",
    }).success).toBe(true);
    expect(contracts.ReminderSchema.safeParse({
      id: "reminder-1", workspace_id: "ws-1", note_id: "note-1", user_id: "user-1",
      remind_at: "2026-08-22T00:00:00.000Z", status: "pending", revision: 1,
      created_at: "2026-08-21T00:00:00.000Z", updated_at: "2026-08-21T00:00:00.000Z",
    }).success).toBe(true);
  });

  it("persists complete saved-search filters", async () => {
    const contracts = await loadContracts();
    const filters = {
      tag_ids: ["tag-1"], folder_ids: ["folder-1"], database_ids: ["db-1"], member_ids: ["user-1"],
      attachment_types: ["application/pdf"], ocr_statuses: ["complete", "failed"],
      source_types: ["note", "attachment"], favorite: true, pinned: false,
      date_from: "2026-08-01", date_to: "2026-08-31",
    };
    expect(contracts.SavedSearchInputSchema.parse({ name: "August research", query: "FTS", filters })).toEqual({
      name: "August research", query: "FTS", filters,
    });
    expect(contracts.OcrStatusSchema.safeParse("queued").success).toBe(true);
    expect(contracts.OcrStatusSchema.safeParse("cancelled").success).toBe(true);
    expect(contracts.OcrStatusSchema.safeParse("pending").success).toBe(false);
    expect(contracts.SavedSearchFiltersSchema.safeParse({ ...filters, ocr_statuses: ["unknown"] }).success).toBe(false);
  });

  it("reports exact search hit sources without accepting unknown sources", async () => {
    const contracts = await loadContracts();
    const hit = {
      entity_type: "note",
      entity_id: "note-1",
      title: "OCR result",
      excerpt: "matched text",
      hit_sources: ["title", "ocr"],
      revision: 2,
      updated_at: "2026-08-21T00:00:00.000Z",
    };
    expect(contracts.SearchHitSchema.safeParse(hit).success).toBe(true);
    expect(contracts.SearchHitSchema.safeParse({ ...hit, hit_sources: [] }).success).toBe(true);
    expect(contracts.SearchHitSchema.safeParse({ ...hit, hit_sources: ["secret_field"] }).success).toBe(false);
  });

  it("bounds reminder writes and graph responses", async () => {
    const contracts = await loadContracts();
    expect(contracts.CreateReminderInputSchema.safeParse({
      note_id: "note-1", remind_at: "2026-08-22T00:00:00.000Z",
    }).success).toBe(true);
    expect(contracts.UpdateReminderInputSchema.safeParse({ base_revision: 1 }).success).toBe(false);
    expect(contracts.UpdateReminderInputSchema.safeParse({ base_revision: 1, status: "dismissed" }).success).toBe(true);
    expect(contracts.SetNoteTagsInputSchema.parse({ tag_ids: ["tag-1", "tag-1", "tag-2"] })).toEqual({
      tag_ids: ["tag-1", "tag-2"],
    });
    expect(contracts.SetNoteLinksInputSchema.parse({ target_note_ids: ["note-2", "note-2"] })).toEqual({
      target_note_ids: ["note-2"],
    });
    expect(contracts.GraphResponseSchema.safeParse({
      nodes: [{ id: "note-1", title: "Draft", is_current: true }],
      edges: [],
    }).success).toBe(true);
  });
});
