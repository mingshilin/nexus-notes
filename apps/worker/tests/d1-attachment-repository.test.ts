import { describe, expect, it, vi } from "vitest";

function statement(firstResult: unknown = null) {
  const value = { bind: vi.fn(), first: vi.fn(async () => firstResult), run: vi.fn(async () => ({ meta: { changes: 1 } })), all: vi.fn(async () => ({ results: [] })) };
  value.bind.mockReturnValue(value);
  return value;
}

describe("D1AttachmentRepository OCR state", () => {
  it("claims only pending workspace jobs and writes search OCR text only on completion", async () => {
    const worker = await import("../src");
    const claim = statement({ id: "job-1", workspace_id: "ws-1", attachment_id: "attachment-1", attempt_count: 1, deadline: "2026-08-21T00:10:00.000Z" });
    const complete = statement();
    const db = { prepare: vi.fn().mockReturnValueOnce(claim).mockReturnValue(complete), batch: vi.fn(async () => []) };
    const repository = new (worker.D1AttachmentRepository as any)(db);

    await expect(repository.claimOcrJob("ws-1", "job-1", "2026-08-21T00:00:00.000Z")).resolves.toMatchObject({ id: "job-1" });
    await repository.completeOcrJob("ws-1", "job-1", "alpha OCR", "2026-08-21T00:00:00.000Z");

    expect(db.prepare.mock.calls[0][0]).toMatch(/UPDATE beta_ocr_jobs[\s\S]*status = 'processing'[\s\S]*workspace_id = \?[\s\S]*status = 'pending'/i);
    expect(db.prepare.mock.calls[1][0]).toMatch(/UPDATE beta_ocr_jobs[\s\S]*status = 'completed'/i);
    expect(db.prepare.mock.calls[2][0]).toMatch(/INSERT INTO search_documents[\s\S]*ocr_text/i);
  });
});
