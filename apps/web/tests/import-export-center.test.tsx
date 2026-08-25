import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImportExportCenter } from "../src/create/ImportExportCenter";

describe("ImportExportCenter", () => {
  it("submits a selected markdown file as an idempotent import job and shows completion", async () => {
    const createJob = vi.fn(async () => ({
      id: "job-import-1",
      workspace_id: "ws-1",
      kind: "import" as const,
      status: "queued" as const,
      revision: 1,
      error_code: null,
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:00:00.000Z",
    }));
    const getJob = vi.fn(async () => ({
      id: "job-import-1",
      workspace_id: "ws-1",
      kind: "import" as const,
      status: "complete" as const,
      revision: 2,
      error_code: null,
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:00:01.000Z",
    }));
    render(<ImportExportCenter open onOpenChange={vi.fn()} operations={{ createJob, getJob }} />);

    fireEvent.change(screen.getByLabelText("选择要导入的 Markdown 或文本文件"), {
      target: { files: [new File(["# Imported"], "meeting.md", { type: "text/markdown" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));

    await waitFor(() => expect(createJob).toHaveBeenCalledWith(expect.objectContaining({
      kind: "import",
      payload: { format: "markdown", filename: "meeting.md", content: "# Imported" },
    })));
    await waitFor(() => expect(screen.getByText("导入完成", { exact: false })).toBeInTheDocument());
    expect(getJob).toHaveBeenCalledWith("job-import-1", expect.any(AbortSignal));
  });

  it("cancels a queued import with its current revision and shows the cancelled state", async () => {
    const createJob = vi.fn(async () => ({
      id: "job-import-cancel",
      workspace_id: "ws-1",
      kind: "import" as const,
      status: "queued" as const,
      revision: 1,
      error_code: null,
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:00:00.000Z",
    }));
    const cancelJob = vi.fn(async (_jobId: string, _input: { base_revision: number }) => ({
      id: "job-import-cancel",
      workspace_id: "ws-1",
      kind: "import" as const,
      status: "cancelled" as const,
      revision: 2,
      error_code: null,
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:00:01.000Z",
    }));
    const getJob = vi.fn();
    render(<ImportExportCenter open onOpenChange={vi.fn()} operations={{ createJob, getJob, cancelJob } as any} />);

    fireEvent.change(screen.getByLabelText("选择要导入的 Markdown 或文本文件"), {
      target: { files: [new File(["# Cancel me"], "cancel.md", { type: "text/markdown" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));
    const cancelButton = await screen.findByRole("button", { name: "撤销导入" });
    fireEvent.click(cancelButton);

    await waitFor(() => expect(cancelJob).toHaveBeenCalledWith("job-import-cancel", { base_revision: 1 }));
    expect(await screen.findByText("已取消", { exact: false })).toBeInTheDocument();
  });

  it("previews the number and titles of markdown blocks before submitting", async () => {
    const createJob = vi.fn();
    const getJob = vi.fn();
    render(<ImportExportCenter open onOpenChange={vi.fn()} operations={{ createJob, getJob }} />);

    fireEvent.change(screen.getByLabelText("选择要导入的 Markdown 或文本文件"), {
      target: { files: [new File(["# One\nBody\n---\n## Two\nBody"], "notes.md", { type: "text/markdown" })] },
    });

    expect(await screen.findByText("预览 2 条笔记", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("One", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Two", { exact: true })).toBeInTheDocument();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("keeps the selected file and offers a retry after a failed import", async () => {
    const queued = {
      id: "job-import-retry-1",
      workspace_id: "ws-1",
      kind: "import" as const,
      status: "queued" as const,
      revision: 1,
      error_code: null,
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:00:00.000Z",
    };
    const failed = { ...queued, status: "failed" as const, revision: 2, error_code: "NOTE_CREATE_FAILED" };
    const createJob = vi.fn().mockResolvedValue(queued);
    const getJob = vi.fn().mockResolvedValue(failed);
    render(<ImportExportCenter open onOpenChange={vi.fn()} operations={{ createJob, getJob }} />);

    fireEvent.change(screen.getByLabelText("选择要导入的 Markdown 或文本文件"), {
      target: { files: [new File(["# Retry me"], "retry.md", { type: "text/markdown" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));

    await screen.findByText("导入失败", { exact: false });
    expect(screen.getAllByText("retry.md", { exact: false }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "重试导入" }));

    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("retry.md", { exact: false }).length).toBeGreaterThan(0);
  });
});
