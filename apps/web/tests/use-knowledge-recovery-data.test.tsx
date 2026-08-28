import { act, renderHook, waitFor } from "@testing-library/react";
import type { Attachment, KnowledgeDiagnostic } from "@nexus/contracts";
import { describe, expect, it, vi } from "vitest";

import { useKnowledgeRecoveryData } from "../src/app/use-knowledge-recovery-data";
import type { KnowledgeClient } from "../src/data/knowledge-client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function attachment(id: string): Attachment {
  return { id, filename: `${id}.pdf`, mime_type: "application/pdf", ocr_status: "failed" } as Attachment;
}

function diagnostic(id: string): KnowledgeDiagnostic {
  return { kind: "failed_ocr", entity_id: id, title: id, count: 1 };
}

function clientWith(
  listAttachments: KnowledgeClient["listAttachments"],
  getKnowledgeDiagnostics: KnowledgeClient["getKnowledgeDiagnostics"],
) {
  return {
    listAttachments: vi.fn(listAttachments),
    getKnowledgeDiagnostics: vi.fn(getKnowledgeDiagnostics),
    retryAttachmentOcr: vi.fn(async () => ({ queued: [], ineligible: [], duplicate: [] })),
    retryAttachmentOcrBatch: vi.fn(async () => ({ queued: [], ineligible: [], duplicate: [] })),
  } as unknown as KnowledgeClient;
}

const defaultFilters = { mimeType: "", ocrStatus: "" } as const;

describe("useKnowledgeRecoveryData", () => {
  it("ignores late attachment and diagnostic pages from the previous workspace", async () => {
    const oldAttachments = deferred<{ items: Attachment[]; next_cursor: string | null }>();
    const oldDiagnostics = deferred<{ items: KnowledgeDiagnostic[]; next_cursor: string | null }>();
    const oldClient = clientWith(() => oldAttachments.promise, () => oldDiagnostics.promise);
    const newClient = clientWith(
      async () => ({ items: [attachment("new-attachment")], next_cursor: null }),
      async () => ({ items: [diagnostic("new-diagnostic")], next_cursor: null }),
    );
    const initialProps = {
      client: oldClient,
      workspaceId: "ws-old",
      initialFilters: defaultFilters,
      refreshVersion: 0,
    };
    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useKnowledgeRecoveryData(props),
      { initialProps },
    );

    await waitFor(() => expect(oldClient.listAttachments).toHaveBeenCalledOnce());
    rerender({ ...initialProps, client: newClient, workspaceId: "ws-new" });
    await waitFor(() => expect(result.current.attachments[0]?.id).toBe("new-attachment"));

    await act(async () => {
      oldAttachments.resolve({ items: [attachment("old-attachment")], next_cursor: "old-cursor" });
      oldDiagnostics.resolve({ items: [diagnostic("old-diagnostic")], next_cursor: "old-cursor" });
      await Promise.all([oldAttachments.promise, oldDiagnostics.promise]);
    });

    expect(result.current.attachments.map((item) => item.id)).toEqual(["new-attachment"]);
    expect(result.current.diagnostics.map((item) => item.entity_id)).toEqual(["new-diagnostic"]);
  });

  it("resets pagination when recovery filters change and keeps the new query isolated", async () => {
    const client = clientWith(
      async (input) => input.cursor
        ? { items: [attachment("page-2")], next_cursor: null }
        : { items: [attachment("page-1")], next_cursor: "next" },
      async () => ({ items: [], next_cursor: null }),
    );
    const { result, rerender } = renderHook(
      (props: { initialFilters: { mimeType: string; ocrStatus: string } }) => useKnowledgeRecoveryData({
        client,
        workspaceId: "ws-1",
        ...props,
        refreshVersion: 0,
      }),
      { initialProps: { initialFilters: defaultFilters } },
    );

    await waitFor(() => expect(result.current.attachmentCursor).toBe("next"));
    act(() => result.current.loadMoreAttachments());
    await waitFor(() => expect(result.current.attachments.map((item) => item.id)).toEqual(["page-1", "page-2"]));

    act(() => result.current.setFilters({ mimeType: "application/pdf", ocrStatus: "failed" }));
    await waitFor(() => expect(client.listAttachments).toHaveBeenCalledWith(
      expect.objectContaining({ mime_type: "application/pdf", ocr_status: "failed", limit: 50 }),
      expect.any(AbortSignal),
    ));
    expect(result.current.attachments.map((item) => item.id)).toEqual(["page-1"]);
    expect(result.current.attachmentCursor).toBe("next");
    expect(client.listAttachments.mock.calls.at(-1)?.[0]).not.toHaveProperty("cursor");
  });
});
