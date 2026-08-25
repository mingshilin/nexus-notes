import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DataPrivacyPanel } from "../src/account/DataPrivacyPanel";

const job = {
  id: "job-export-1",
  workspace_id: "ws-1",
  kind: "export" as const,
  status: "complete" as const,
  revision: 2,
  error_code: null,
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:00:01.000Z",
};

describe("DataPrivacyPanel export", () => {
  it("offers a download action after the export job is created", async () => {
    const downloadJob = vi.fn(async () => new Blob(["# Export"]));
    const operations = {
      getUsage: vi.fn(async () => ({ notes: 0, databases: 0, attachment_bytes: 0, queued_jobs: 0 })),
      getStatus: vi.fn(async () => ({ queue: "ready" as const, storage: "ready" as const, ocr: "ready" as const, version: "test" })),
      createJob: vi.fn(async () => job),
      downloadJob,
    };
    render(<DataPrivacyPanel client={{} as any} operations={operations} activeWorkspaceId="ws-1" onDeleted={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "导出全部数据" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "下载导出文件" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "下载导出文件" }));
    await waitFor(() => expect(downloadJob).toHaveBeenCalledWith("job-export-1", expect.any(AbortSignal)));
  });
});
