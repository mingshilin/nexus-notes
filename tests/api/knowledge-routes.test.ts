import { describe, expect, it, vi } from "vitest";
import {
  handleListAttachmentCenter,
  handleMarkAllNotificationsRead,
  handleRunAttachmentOcr,
} from "../../worker/routes/knowledge";

function createDb(steps: Array<{ first?: unknown; results?: unknown[] }>) {
  const bindCalls: unknown[][] = [];
  const prepare = vi.fn(() => {
    const step = steps.shift() ?? {};
    return {
      bind: vi.fn((...args: unknown[]) => {
        bindCalls.push(args);
        return {
          run: vi.fn(() => Promise.resolve({ success: true })),
          first: vi.fn(() => Promise.resolve(step.first ?? null)),
          all: vi.fn(() => Promise.resolve({ results: step.results ?? [] })),
        };
      }),
    };
  });
  return { db: { prepare } as unknown as D1Database, prepare, bindCalls };
}

describe("knowledge routes", () => {
  it("marks all unread notifications for the current user", async () => {
    const { db, prepare, bindCalls } = createDb([{ results: [] }]);

    const response = await handleMarkAllNotificationsRead(db, "ws1", "u1");
    const body = await response.json() as { success: boolean; data: unknown[] };

    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(bindCalls[0]).toEqual(["ws1", "u1"]);
  });

  it("filters attachment center by query, type, status, and note", async () => {
    const { db, bindCalls } = createDb([{ results: [] }]);

    await handleListAttachmentCenter(db, "ws1", new Request("http://localhost/api/attachments?q=invoice&type=pdf&status=ready&noteId=note-1"));

    expect(bindCalls[0]).toEqual(["ws1", "%invoice%", "%invoice%", "%invoice%", "%invoice%", "ready", "note-1"]);
  });

  it("filters attachment center by upload date range", async () => {
    const { db, bindCalls } = createDb([{ results: [] }]);

    await handleListAttachmentCenter(db, "ws1", new Request("http://localhost/api/attachments?from=2026-05-01&to=2026-05-20"));

    expect(bindCalls[0]).toEqual(["ws1", "2026-05-01", "2026-05-20"]);
  });

  it("persists failed OCR as failed instead of ready", async () => {
    const { db, bindCalls } = createDb([
      { first: { id: "att-1", file_name: "scan.png", mime_type: "image/png" } },
      {},
      { first: { id: "att-1", note_id: "note-1", ocr_status: "failed", ocr_text: "bad image" } },
    ]);

    const response = await handleRunAttachmentOcr(
      db,
      "ws1",
      "att-1",
      new Request("http://localhost/api/attachments/att-1/ocr", {
        method: "POST",
        body: JSON.stringify({ status: "failed", error: "bad image" }),
      }),
    );
    const body = await response.json() as { success: boolean; data: { ocr_status: string; ocr_text: string } };

    expect(body.success).toBe(true);
    expect(body.data.ocr_status).toBe("failed");
    expect(bindCalls[1]).toEqual(["failed", "bad image", "ws1", "att-1"]);
  });
});
