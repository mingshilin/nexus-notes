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
});
