import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";

const session = {
  user: { id: "user-1", email: "user@example.com", displayName: "User" },
  workspaces: [{ id: "ws-1", name: "Personal", slug: "personal", role: "owner" as const, revision: 1 }],
  active_workspace_id: "ws-1",
};

function createApiClient() {
  let nextNoteId = 1;
  const request = vi.fn(async (input: { path: string; method?: string; body?: Record<string, unknown> }) => {
    if (input.path.startsWith("/api/v2/attachments")) return { items: [], next_cursor: null };
    if (input.path.startsWith("/api/v2/knowledge/diagnostics")) return { items: [], next_cursor: null };
    if (input.path.startsWith("/api/v2/notifications/unread")) return { unread_count: 0 };
    if (input.path === "/api/v2/notes?limit=50") return { items: [], next_cursor: null };
    if (input.path === "/api/v2/notes" && input.method === "POST") {
      return {
        note: {
          id: `note-${nextNoteId++}`,
          workspace_id: "ws-1",
          folder_id: null,
          database_id: null,
          created_by: "user-1",
          updated_by: "user-1",
          title: input.body?.title ?? "",
          content: input.body?.content ?? "",
          status: "active",
          is_favorite: false,
          is_pinned: false,
          daily_date: null,
          revision: 1,
          created_at: "2026-08-22T00:00:00.000Z",
          updated_at: "2026-08-22T00:00:00.000Z",
        },
      };
    }
    return { items: [], next_cursor: null };
  });
  return { request };
}

function renderWorkspace(apiClient: ReturnType<typeof createApiClient>) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 929 });
  return render(
    <App
      authClient={{ session: vi.fn(async () => session) } as any}
      apiClient={apiClient as any}
      turnstileSiteKey="test-site-key"
    />,
  );
}

describe("live note workspace flow", () => {
  it("opens the tablet context drawer so the note creation action is reachable", async () => {
    const apiClient = createApiClient();
    renderWorkspace(apiClient);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));

    expect(await screen.findByRole("button", { name: "新建笔记" })).toBeInTheDocument();
  });

  it("creates a note through the workspace API and renders its editable content", async () => {
    const apiClient = createApiClient();
    renderWorkspace(apiClient);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(await screen.findByRole("button", { name: "新建笔记" }));
    fireEvent.change(screen.getByRole("textbox", { name: "笔记标题" }), { target: { value: "真实浏览器笔记" } });
    fireEvent.change(screen.getByRole("textbox", { name: "笔记内容" }), { target: { value: "注册登录后创建的第一条笔记" } });
    fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));

    await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/notes",
      method: "POST",
      body: { title: "真实浏览器笔记", content: "注册登录后创建的第一条笔记" },
    })));
    expect(await screen.findByRole("heading", { name: "真实浏览器笔记", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("注册登录后创建的第一条笔记", { selector: "p.note-content-preview" })).toBeInTheDocument();
  });
});
