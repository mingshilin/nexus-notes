import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";

describe("App authentication bootstrap", () => {
  it("gates the workspace behind the server session result", async () => {
    const authClient = {
      session: vi.fn(async () => {
        throw Object.assign(new Error("Not authenticated"), { code: "UNAUTHENTICATED", status: 401 });
      }),
      login: vi.fn(),
    };

    render(<App authClient={authClient as any} turnstileSiteKey="test-site-key" />);

    await waitFor(() => expect(authClient.session).toHaveBeenCalledOnce());
    expect(await screen.findByRole("main")).toHaveClass("auth-page");
    expect(screen.queryByText("Public Beta 重写计划")).not.toBeInTheDocument();
  });

  it("renders the existing workspace after session bootstrap succeeds", async () => {
    const authClient = {
      session: vi.fn(async () => ({ user: { id: "user-1", email: "user@example.com" } })),
    };

    render(<App authClient={authClient as any} turnstileSiteKey="test-site-key" />);

    expect(await screen.findByRole("heading", { name: "Public Beta 重写计划", level: 1 })).toBeInTheDocument();
    expect(authClient.session).toHaveBeenCalledOnce();
  });

  it("mounts live attachment recovery for the active workspace", async () => {
    const authClient = { session: vi.fn(async () => ({ user: { id: "user-1", email: "user@example.com" } })) };
    const apiClient = { request: vi.fn(async (request: { path: string }) => request.path.startsWith("/api/v2/attachments") ? { items: [{ id: "attachment-1", filename: "scan.pdf", mime_type: "application/pdf", ocr_status: "failed" }], next_cursor: null } : { items: [], next_cursor: null }) };
    render(<App authClient={authClient as any} apiClient={apiClient as any} workspaceId="ws-1" turnstileSiteKey="test" />);
    expect(await screen.findByRole("button", { name: "重试 scan.pdf" })).toBeInTheDocument();
    expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({ headers: { "x-workspace-id": "ws-1" } }));
  });

  it("uses controlled MIME and OCR filters in the active workspace query", async () => {
    const authClient = { session: vi.fn(async () => ({ user: { id: "user-1", email: "user@example.com" } })) };
    const apiClient = { request: vi.fn(async () => ({ items: [], next_cursor: null })) };
    render(<App authClient={authClient as any} apiClient={apiClient as any} workspaceId="ws-1" turnstileSiteKey="test" />);

    await screen.findByRole("combobox", { name: "附件类型过滤" });
    fireEvent.change(screen.getByRole("combobox", { name: "附件类型过滤" }), { target: { value: "application/pdf" } });
    fireEvent.change(screen.getByRole("combobox", { name: "OCR 状态过滤" }), { target: { value: "failed" } });

    await waitFor(() => expect(apiClient.request.mock.calls.some(([request]) => request.path === "/api/v2/attachments?mime_type=application%2Fpdf&ocr_status=failed&limit=50")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "清除过滤" }));
    await waitFor(() => expect(apiClient.request.mock.calls.filter(([request]) => request.path === "/api/v2/attachments?limit=50").length).toBeGreaterThan(1));
  });

  it("does not invent a workspace when the authenticated shell has none", async () => {
    const authClient = { session: vi.fn(async () => ({ user: { id: "user-1", email: "user@example.com" } })) };
    const apiClient = { request: vi.fn() };
    render(<App authClient={authClient as any} apiClient={apiClient as any} turnstileSiteKey="test" />);

    expect(await screen.findByText("未选择工作区，无法加载恢复数据。")).toBeInTheDocument();
    expect(apiClient.request).not.toHaveBeenCalled();
  });

  it("aborts stale recovery requests when the active workspace changes", async () => {
    const authClient = { session: vi.fn(async () => ({ user: { id: "user-1", email: "user@example.com" } })) };
    const apiClient = { request: vi.fn(() => new Promise(() => undefined)) };
    const { rerender } = render(<App authClient={authClient as any} apiClient={apiClient as any} workspaceId="ws-1" turnstileSiteKey="test" />);

    await waitFor(() => expect(apiClient.request).toHaveBeenCalledTimes(2));
    const staleSignal = apiClient.request.mock.calls[0]?.[0].policy.signal as AbortSignal;
    rerender(<App authClient={authClient as any} apiClient={apiClient as any} workspaceId="ws-2" turnstileSiteKey="test" />);

    await waitFor(() => expect(apiClient.request).toHaveBeenCalledTimes(4));
    expect(staleSignal.aborted).toBe(true);
    expect(apiClient.request.mock.calls.slice(2).every(([request]: [{ headers: Record<string, string> }]) => request.headers["x-workspace-id"] === "ws-2")).toBe(true);
  });

  it("deduplicates retry clicks, refreshes afterwards, and delegates diagnostic navigation", async () => {
    const authClient = { session: vi.fn(async () => ({ user: { id: "user-1", email: "user@example.com" } })) };
    let resolveRetry: ((value: { queued: string[]; ineligible: string[]; duplicate: string[] }) => void) | undefined;
    const apiClient = { request: vi.fn((request: { path: string }) => {
      if (request.path.includes("/ocr/retry")) return new Promise((resolve) => { resolveRetry = resolve; });
      if (request.path.startsWith("/api/v2/attachments")) return Promise.resolve({ items: [{ id: "attachment-1", filename: "scan.pdf", mime_type: "application/pdf", ocr_status: "failed" }], next_cursor: null });
      return Promise.resolve({ items: [{ kind: "failed_ocr", entity_id: "attachment-1", title: "scan.pdf", count: 1 }], next_cursor: null });
    }) };
    const navigate = vi.fn();
    render(<App authClient={authClient as any} apiClient={apiClient as any} workspaceId="ws-1" turnstileSiteKey="test" onDiagnosticNavigate={navigate} />);

    const retry = await screen.findByRole("button", { name: "重试 scan.pdf" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(apiClient.request.mock.calls.filter(([request]) => request.path.includes("/ocr/retry"))).toHaveLength(1);
    expect(retry).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "处理诊断 scan.pdf" }));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ kind: "failed_ocr", entity_id: "attachment-1" }));

    await act(async () => resolveRetry?.({ queued: ["attachment-1"], ineligible: [], duplicate: [] }));
    await waitFor(() => expect(apiClient.request.mock.calls.filter(([request]) => request.path.startsWith("/api/v2/attachments?")).length).toBeGreaterThan(1));
  });
});
