import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("KnowledgeRecoveryPanel", () => {
  it("offers filtered attachment retry and diagnostic recovery entry points without adding a scroll owner", async () => {
    const { KnowledgeRecoveryPanel } = await import("../src/knowledge/KnowledgeRecoveryPanel");
    const retry = vi.fn();
    const batch = vi.fn();
    const recover = vi.fn();
    const { container } = render(<KnowledgeRecoveryPanel
      attachments={[{ id: "attachment-1", filename: "scan.pdf", mime_type: "application/pdf", ocr_status: "failed" }]}
      diagnostics={[{ kind: "failed_ocr", entity_id: "attachment-1", title: "scan.pdf", count: 1 }]}
      onRetry={retry}
      onBatchRetry={batch}
      onRecover={recover}
    />);

    fireEvent.click(screen.getByRole("button", { name: "重试 scan.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "重试全部失败 OCR" }));
    fireEvent.click(screen.getByRole("button", { name: "处理诊断 scan.pdf" }));
    expect(retry).toHaveBeenCalledWith("attachment-1");
    expect(batch).toHaveBeenCalledWith(["attachment-1"]);
    expect(recover).toHaveBeenCalledWith("failed_ocr", "attachment-1");
    expect(container.querySelectorAll('[data-scroll-owner]')).toHaveLength(0);
  });
});
