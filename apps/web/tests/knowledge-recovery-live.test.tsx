import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";

const authClient = { session: vi.fn(async () => ({
  user: { id: "user-1", email: "user@example.com" },
  workspaces: [{ id: "ws-1", name: "Personal", slug: "personal", role: "owner" as const, revision: 1 }],
  active_workspace_id: "ws-1",
})) };

function attachment(id: string, next_cursor: string | null = null) {
  return { items: [{ id, filename: `${id}.pdf`, mime_type: "application/pdf", ocr_status: "failed" }], next_cursor };
}

function diagnostic(next_cursor: string | null = null) {
  return { items: [{ kind: "failed_ocr", entity_id: "attachment-1", title: "attachment-1.pdf", count: 1 }], next_cursor };
}

describe("live knowledge recovery", () => {
  it("keeps successful attachments visible when diagnostics fails independently", async () => {
    const apiClient = { request: vi.fn((request: { path: string }) => request.path.startsWith("/api/v2/attachments")
      ? Promise.resolve(attachment("attachment-1"))
      : Promise.reject(new Error("diagnostics unavailable"))) };
    render(<App authClient={authClient as any} apiClient={apiClient as any} workspaceId="ws-1" turnstileSiteKey="test" />);

    expect(await screen.findByRole("button", { name: "重试 attachment-1.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("诊断暂时无法加载");
  });

  it("aborts in-flight recovery requests when a controlled filter changes", async () => {
    const apiClient = { request: vi.fn(() => new Promise(() => undefined)) };
    render(<App authClient={authClient as any} apiClient={apiClient as any} workspaceId="ws-1" turnstileSiteKey="test" />);

    const recoveryRequests = () => apiClient.request.mock.calls
      .map(([request]) => request as { path: string; policy: { signal?: AbortSignal } })
      .filter((request) => request.path.startsWith("/api/v2/attachments") || request.path.startsWith("/api/v2/knowledge/diagnostics"));
    await waitFor(() => expect(recoveryRequests()).toHaveLength(2));
    const previousSignal = recoveryRequests()[0]?.policy.signal as AbortSignal;
    fireEvent.change(screen.getByRole("combobox", { name: "OCR 状态过滤" }), { target: { value: "failed" } });

    await waitFor(() => expect(recoveryRequests()).toHaveLength(4));
    expect(previousSignal.aborted).toBe(true);
  });

  it("clears an old attachment cursor when a new MIME query fails", async () => {
    let attachmentCalls = 0;
    const apiClient = { request: vi.fn((request: { path: string }) => {
      if (request.path.startsWith("/api/v2/attachments")) {
        attachmentCalls += 1;
        return attachmentCalls === 1 ? Promise.resolve(attachment("attachment-1", "old-cursor")) : Promise.reject(new Error("filtered load failed"));
      }
      return Promise.resolve(diagnostic());
    }) };
    render(<App authClient={authClient as any} apiClient={apiClient as any} workspaceId="ws-1" turnstileSiteKey="test" />);

    await screen.findByRole("button", { name: "加载更多附件" });
    fireEvent.change(screen.getByRole("combobox", { name: "附件类型过滤" }), { target: { value: "application/pdf" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("附件暂时无法加载");
    expect(screen.queryByRole("button", { name: "加载更多附件" })).not.toBeInTheDocument();
    expect(apiClient.request.mock.calls.some(([request]) => request.path.includes("cursor=old-cursor") && request.path.includes("mime_type=application%2Fpdf"))).toBe(false);
  });

  it("appends the requested attachment cursor and keeps the prior page retryable after a pagination failure", async () => {
    let attachmentCalls = 0;
    const apiClient = { request: vi.fn((request: { path: string }) => {
      if (request.path.startsWith("/api/v2/attachments")) {
        attachmentCalls += 1;
        if (attachmentCalls === 1) return Promise.resolve(attachment("attachment-1", "attachment-cursor"));
        if (attachmentCalls === 2) return Promise.resolve(attachment("attachment-2", "attachment-next"));
        return Promise.reject(new Error("page unavailable"));
      }
      return Promise.resolve(diagnostic());
    }) };
    render(<App authClient={authClient as any} apiClient={apiClient as any} workspaceId="ws-1" turnstileSiteKey="test" />);

    await screen.findByRole("button", { name: "加载更多附件" });
    fireEvent.click(screen.getByRole("button", { name: "加载更多附件" }));
    expect(await screen.findByRole("button", { name: "重试 attachment-2.pdf" })).toBeInTheDocument();
    expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/attachments?cursor=attachment-cursor&limit=50" }));

    fireEvent.click(screen.getByRole("button", { name: "加载更多附件" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("更多附件暂时无法加载");
    expect(screen.getByRole("button", { name: "重试 attachment-1.pdf" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加载更多附件" })).toBeEnabled();
  });

  it("deduplicates batch retry, disables conflicting controls, and refreshes both pages", async () => {
    let resolveRetry: ((value: { queued: string[]; ineligible: string[]; duplicate: string[] }) => void) | undefined;
    const apiClient = { request: vi.fn((request: { path: string }) => {
      if (request.path === "/api/v2/attachments/ocr/retry") return new Promise((resolve) => { resolveRetry = resolve; });
      if (request.path.startsWith("/api/v2/attachments")) return Promise.resolve({ items: [
        { id: "attachment-1", filename: "attachment-1.pdf", mime_type: "application/pdf", ocr_status: "failed" },
        { id: "attachment-2", filename: "attachment-2.pdf", mime_type: "application/pdf", ocr_status: "failed" },
      ], next_cursor: null });
      return Promise.resolve(diagnostic());
    }) };
    render(<App authClient={authClient as any} apiClient={apiClient as any} workspaceId="ws-1" turnstileSiteKey="test" />);

    const batch = await screen.findByRole("button", { name: "重试全部失败 OCR" });
    fireEvent.click(batch);
    fireEvent.click(batch);
    expect(apiClient.request.mock.calls.filter(([request]) => request.path === "/api/v2/attachments/ocr/retry")).toHaveLength(1);
    expect(batch).toBeDisabled();
    expect(screen.getByRole("button", { name: "重试 attachment-1.pdf" })).toBeDisabled();

    await act(async () => resolveRetry?.({ queued: ["attachment-1", "attachment-2"], ineligible: [], duplicate: [] }));
    await waitFor(() => expect(apiClient.request.mock.calls.filter(([request]) => request.path.startsWith("/api/v2/attachments?")).length).toBeGreaterThan(1));
    expect(apiClient.request.mock.calls.filter(([request]) => request.path.startsWith("/api/v2/knowledge/diagnostics?")).length).toBeGreaterThan(1);
  });

  it("keeps the inspector as the only accessible scroll surface at 390px", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    window.dispatchEvent(new Event("resize"));
    const apiClient = { request: vi.fn(async (request: { path: string }) => request.path.startsWith("/api/v2/attachments") ? attachment("attachment-1") : diagnostic()) };
    render(<App authClient={authClient as any} apiClient={apiClient as any} workspaceId="ws-1" turnstileSiteKey="test" />);

    await screen.findByRole("button", { name: "重试 attachment-1.pdf" });
    fireEvent.click(screen.getByRole("button", { name: "打开检查器" }));
    const dialog = await screen.findByRole("dialog", { name: "检查器" });
    expect(document.querySelectorAll('section[aria-label="知识恢复"]')).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "知识恢复" })).not.toBeInTheDocument();
    expect(document.activeElement).toHaveAccessibleName("关闭检查器");
    expect(document.querySelectorAll('[data-scroll-owner]')).toHaveLength(1);
    expect(dialog).toHaveAttribute("data-scroll-owner", "inspector");
    expect(dialog).toHaveClass("workbench-inspector");
  });

  it("returns focus to the inspector opener after closing", async () => {
    const apiClient = { request: vi.fn(async (request: { path: string }) => request.path.startsWith("/api/v2/attachments") ? attachment("attachment-1") : diagnostic()) };
    render(<App authClient={authClient as any} apiClient={apiClient as any} workspaceId="ws-1" turnstileSiteKey="test" />);

    const opener = await screen.findByRole("button", { name: "打开检查器" });
    fireEvent.click(opener);
    fireEvent.click(await screen.findByRole("button", { name: "关闭检查器" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "检查器" })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
  });
});
