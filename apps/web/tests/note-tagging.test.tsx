import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note, Tag } from "@nexus/contracts";
import { App } from "../src/app/App";

const note: Note = {
  id: "note-1",
  workspace_id: "ws-1",
  folder_id: null,
  database_id: null,
  created_by: "user-1",
  updated_by: "user-1",
  title: "带标签的笔记",
  content: "正文",
  status: "active",
  is_favorite: false,
  is_pinned: false,
  daily_date: null,
  revision: 1,
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:00:00.000Z",
};

const tag: Tag = {
  id: "tag-research",
  workspace_id: "ws-1",
  name: "研究",
  color: "",
  revision: 1,
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:00:00.000Z",
};

describe("App note tags", () => {
  it("loads the selected note tags and persists a changed selection", async () => {
    const apiClient = {
      request: vi.fn(async (request: { path: string; method?: string; body?: { tag_ids?: string[] } }) => {
        if (request.path.startsWith("/api/v2/notes?") && !request.path.includes("/tags")) return { items: [note], next_cursor: null };
        if (request.path === "/api/v2/folders") return { items: [] };
        if (request.path === "/api/v2/tags") return { items: [tag] };
        if (request.path === "/api/v2/notes/note-1/tags" && !request.method) return { items: [tag] };
        if (request.path === "/api/v2/notes/note-1/tags" && request.method === "PUT") return { updated: true };
        if (request.path === "/api/v2/notifications/unread") return { unread_count: 0 };
        return { items: [], next_cursor: null };
      }),
    };
    const authClient = {
      session: vi.fn(async () => ({
        user: { id: "user-1", email: "user@example.test", displayName: "用户" },
        workspaces: [{ id: "ws-1", name: "Personal", slug: "personal", role: "owner" as const, revision: 1 }],
        active_workspace_id: "ws-1",
      })),
    };

    render(<App authClient={authClient as any} apiClient={apiClient as any} turnstileSiteKey="test" />);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(await screen.findByRole("button", { name: /带标签的笔记/u }));
    expect(await screen.findByRole("checkbox", { name: "标签：研究" })).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "标签：研究" }));
    await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/notes/note-1/tags",
      method: "PUT",
      body: { tag_ids: [] },
    })));
  });

  it("uploads a supported attachment through reserve, content, and complete steps", async () => {
    const attachment = {
      id: "attachment-1",
      workspace_id: "ws-1",
      note_id: "note-1",
      filename: "scan.pdf",
      mime_type: "application/pdf",
      size_bytes: 8,
      status: "ready",
      ocr_status: "pending",
      ocr_attempt_count: 0,
      ocr_updated_at: null,
      revision: 1,
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:00:00.000Z",
    };
    const apiClient = {
      request: vi.fn(async (request: { path: string; method?: string }) => {
        if (request.path.startsWith("/api/v2/notes?")) return { items: [note], next_cursor: null };
        if (request.path === "/api/v2/folders") return { items: [] };
        if (request.path === "/api/v2/tags") return { items: [] };
        if (request.path === "/api/v2/notes/note-1/tags") return { items: [] };
        if (request.path === "/api/v2/attachments?limit=50") return { items: [], next_cursor: null };
        if (request.path === "/api/v2/knowledge/diagnostics?limit=50") return { items: [], next_cursor: null };
        if (request.path === "/api/v2/notifications/unread") return { unread_count: 0 };
        if (request.path === "/api/v2/attachments/uploads" && request.method === "POST") return { attachment };
        if (request.path === "/api/v2/attachments/attachment-1/content" && request.method === "PUT") return { attachment };
        if (request.path === "/api/v2/attachments/attachment-1/complete" && request.method === "POST") return { attachment };
        return { items: [], next_cursor: null };
      }),
    };
    const authClient = {
      session: vi.fn(async () => ({
        user: { id: "user-1", email: "user@example.test", displayName: "用户" },
        workspaces: [{ id: "ws-1", name: "Personal", slug: "personal", role: "owner" as const, revision: 1 }],
        active_workspace_id: "ws-1",
      })),
    };

    render(<App authClient={authClient as any} apiClient={apiClient as any} turnstileSiteKey="test" />);
    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(await screen.findByRole("button", { name: /带标签的笔记/u }));
    const file = new File(["%PDF-1.7"], "scan.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "arrayBuffer", { value: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer) });
    fireEvent.change(await screen.findByLabelText("上传附件"), { target: { files: [file] } });

    await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/attachments/attachment-1/complete",
      method: "POST",
      body: { upload_id: "attachment-1" },
    })));
    expect(apiClient.request.mock.calls.some(([request]) => request.path === "/api/v2/attachments/attachment-1/content" && request.method === "PUT")).toBe(true);
  });
});
