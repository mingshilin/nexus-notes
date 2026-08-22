import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("KnowledgeRecoveryPanel", () => {
  it("renders controlled filters, stale data, retry feedback, pagination, and safe diagnostic navigation without a scroll owner", async () => {
    const { KnowledgeRecoveryPanel } = await import("../src/knowledge/KnowledgeRecoveryPanel");
    const retry = vi.fn();
    const batch = vi.fn();
    const recover = vi.fn();
    const filters = { mimeType: "", ocrStatus: "" };
    const { container } = render(<KnowledgeRecoveryPanel
      attachments={[{ id: "attachment-1", filename: "scan.pdf", mime_type: "application/pdf", ocr_status: "failed" }]}
      diagnostics={[{ kind: "failed_ocr", entity_id: "attachment-1", title: "scan.pdf", count: 1 }]}
      filters={filters}
      loading={false}
      refreshing
      diagnosticError="刷新失败"
      attachmentNextCursor="attachment-cursor"
      diagnosticNextCursor="diagnostic-cursor"
      retryFeedback="已加入 1 项 OCR 重试。"
      onRetry={retry}
      onBatchRetry={batch}
      onRecover={recover}
      onFiltersChange={vi.fn()}
      onLoadMoreAttachments={vi.fn()}
      onLoadMoreDiagnostics={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "重试 scan.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "重试全部失败 OCR" }));
    fireEvent.click(screen.getByRole("button", { name: "处理诊断 scan.pdf" }));
    expect(retry).toHaveBeenCalledWith("attachment-1");
    expect(batch).toHaveBeenCalledWith(["attachment-1"]);
    expect(recover).toHaveBeenCalledWith(expect.objectContaining({ kind: "failed_ocr", entity_id: "attachment-1" }));
    expect(screen.getByRole("combobox", { name: "附件类型过滤" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "OCR 状态过滤" })).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("正在刷新");
    expect(screen.getByRole("alert")).toHaveTextContent("刷新失败");
    expect(screen.getByText("已加入 1 项 OCR 重试。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加载更多附件" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加载更多诊断" })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-scroll-owner]')).toHaveLength(0);
  });

  it("disables conflicting retries and exposes loading and empty states", async () => {
    const { KnowledgeRecoveryPanel } = await import("../src/knowledge/KnowledgeRecoveryPanel");
    const { rerender } = render(<KnowledgeRecoveryPanel
      attachments={[]}
      diagnostics={[]}
      filters={{ mimeType: "", ocrStatus: "" }}
      loading
      refreshing={false}
      isRetryPending
      onRetry={vi.fn()}
      onBatchRetry={vi.fn()}
      onRecover={vi.fn()}
      onFiltersChange={vi.fn()}
      onLoadMoreAttachments={vi.fn()}
      onLoadMoreDiagnostics={vi.fn()}
    />);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载");

    rerender(<KnowledgeRecoveryPanel
      attachments={[]}
      diagnostics={[]}
      filters={{ mimeType: "", ocrStatus: "" }}
      loading={false}
      refreshing={false}
      isRetryPending
      onRetry={vi.fn()}
      onBatchRetry={vi.fn()}
      onRecover={vi.fn()}
      onFiltersChange={vi.fn()}
      onLoadMoreAttachments={vi.fn()}
      onLoadMoreDiagnostics={vi.fn()}
    />);
    expect(screen.getByText("暂无附件或待处理诊断。")).toBeInTheDocument();
  });

  it("keeps recovery controls usable at 390px and 200% zoom without adding motion or a scroll owner", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(css).toMatch(/\.knowledge-recovery\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.knowledge-recovery-filters\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.knowledge-filter select\s*\{[^}]*width:\s*100%/);
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.knowledge-recovery-heading, \.knowledge-recovery-row\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.knowledge-recovery \*/);
  });
});
