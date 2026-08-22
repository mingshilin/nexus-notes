import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import type { LocalDraft } from "../src/data/local-store";

const session = {
  user: { id: "user-1", email: "user@example.com", displayName: "User" },
  workspaces: [{ id: "ws-1", name: "Personal", slug: "personal", role: "owner" as const, revision: 1 }],
  active_workspace_id: "ws-1",
};

type NoteApiOptions = {
  createNote?: (input: { path: string; method?: string; body?: Record<string, unknown> }) => Promise<unknown>;
  listNotes?: (workspaceId: string) => Promise<unknown>;
};

function createDraftStore(initial: LocalDraft[] = []) {
  const drafts = new Map(initial.map((draft) => [`${draft.workspace_id}:${draft.entity_id}`, draft]));
  return {
    saveDraft: vi.fn(async (draft: LocalDraft) => { drafts.set(`${draft.workspace_id}:${draft.entity_id}`, { ...draft }); }),
    listDrafts: vi.fn(async (workspaceId: string) => [...drafts.values()].filter((draft) => draft.workspace_id === workspaceId).sort((left, right) => right.updated_at.localeCompare(left.updated_at))),
    removeDraft: vi.fn(async (workspaceId: string, entityId: string) => { drafts.delete(`${workspaceId}:${entityId}`); }),
    getDraft: (workspaceId: string, entityId: string) => drafts.get(`${workspaceId}:${entityId}`) ?? null,
  };
}

function createApiClient(options: NoteApiOptions = {}) {
  let nextNoteId = 1;
  const request = vi.fn(async (input: { path: string; method?: string; body?: Record<string, unknown>; headers?: Record<string, string> }) => {
    if (input.path.startsWith("/api/v2/attachments")) return { items: [], next_cursor: null };
    if (input.path.startsWith("/api/v2/knowledge/diagnostics")) return { items: [], next_cursor: null };
    if (input.path.startsWith("/api/v2/notifications/unread")) return { unread_count: 0 };
    if (input.path === "/api/v2/notes?limit=50") return options.listNotes?.(input.headers?.["x-workspace-id"] ?? "ws-1") ?? { items: [], next_cursor: null };
    if (input.path === "/api/v2/notes" && input.method === "POST") {
      if (options.createNote) return options.createNote(input);
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
    if (input.path.startsWith("/api/v2/notes/") && input.method === "PATCH") {
      return {
        note: {
          id: input.path.split("/").at(-1), workspace_id: "ws-1", folder_id: null, database_id: null, created_by: "user-1", updated_by: "user-1",
          title: input.body?.title ?? "", content: input.body?.content ?? "", status: "active", is_favorite: false, is_pinned: false, daily_date: null,
          revision: 2, created_at: "2026-08-22T00:00:00.000Z", updated_at: "2026-08-22T00:00:01.000Z",
        },
      };
    }
    return { items: [], next_cursor: null };
  });
  return { request };
}

function renderWorkspace(apiClient: ReturnType<typeof createApiClient>) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 929 });
  const localStore = createDraftStore();
  return render(
    <App
      authClient={{ session: vi.fn(async () => session) } as any}
      apiClient={apiClient as any}
      localStore={localStore as any}
      turnstileSiteKey="test-site-key"
    />,
  );
}

function renderWorkspaceWithStore(
  apiClient: ReturnType<typeof createApiClient>,
  localStore: ReturnType<typeof createDraftStore>,
  workspaceId = "ws-1",
) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 929 });
  return render(
    <App
      authClient={{ session: vi.fn(async () => session) } as any}
      apiClient={apiClient as any}
      localStore={localStore as any}
      workspaceId={workspaceId}
      turnstileSiteKey="test-site-key"
    />,
  );
}

describe("live note workspace flow", () => {
  it("opens the tablet context drawer so the note creation action is reachable", async () => {
    const apiClient = createApiClient();
    renderWorkspace(apiClient);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));

    await waitFor(() => expect(screen.getAllByRole("button", { name: "新建笔记" })).toHaveLength(2));
  });

  it("creates and opens one durable draft from one click, focusing its title", async () => {
    const apiClient = createApiClient();
    renderWorkspace(apiClient);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]);

    expect(await screen.findByRole("textbox", { name: "笔记标题" })).toHaveFocus();
    await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/notes", method: "POST" })));
  });

  it("handles Ctrl+N and Cmd+N as one activation while suppressing rapid duplicates and repeats", async () => {
    const apiClient = createApiClient();
    renderWorkspace(apiClient);
    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    fireEvent.keyDown(window, { key: "n", metaKey: true, repeat: true });
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });

    expect(await screen.findByRole("textbox", { name: "笔记标题" })).toHaveFocus();
    await waitFor(() => expect(apiClient.request.mock.calls.filter(([input]) => input.path === "/api/v2/notes" && input.method === "POST")).toHaveLength(1));
  });

  it("ignores the shortcut from editable elements without preventing their input", async () => {
    const apiClient = createApiClient();
    renderWorkspace(apiClient);
    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    const search = screen.getByRole("textbox", { name: "搜索笔记" });
    const event = new KeyboardEvent("keydown", { key: "n", ctrlKey: true, bubbles: true, cancelable: true });
    search.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("textbox", { name: "笔记标题" })).not.toBeInTheDocument();
    expect(apiClient.request.mock.calls.filter(([input]) => input.path === "/api/v2/notes" && input.method === "POST")).toHaveLength(0);
  });

  it("reconciles a successful server note, removes its local draft, and opens the server note", async () => {
    const localStore = createDraftStore();
    const apiClient = createApiClient();
    renderWorkspaceWithStore(apiClient, localStore);

    await screen.findByRole("button", { name: "打开笔记列表" });
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(await screen.findByRole("textbox", { name: "笔记标题" })).toHaveFocus();
    await waitFor(() => expect(localStore.removeDraft).toHaveBeenCalledWith("ws-1", expect.any(String)));
    expect(await screen.findByRole("heading", { name: "未命名笔记", level: 1 })).toBeInTheDocument();
  });

  it("reconciles the latest title and content when they change during server creation", async () => {
    const localStore = createDraftStore();
    let resolveCreate!: (value: unknown) => void;
    const createBlocked = new Promise((resolve) => { resolveCreate = resolve; });
    const apiClient = createApiClient({ createNote: async () => createBlocked });
    renderWorkspaceWithStore(apiClient, localStore);

    await screen.findByRole("button", { name: "打开笔记列表" });
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    const title = await screen.findByRole("textbox", { name: "笔记标题" });
    fireEvent.change(title, { target: { value: "最新标题" } });
    fireEvent.change(screen.getByRole("textbox", { name: "笔记内容" }), { target: { value: "最新内容" } });
    resolveCreate({
      note: {
        id: "note-latest", workspace_id: "ws-1", folder_id: null, database_id: null, created_by: "user-1", updated_by: "user-1",
        title: "", content: "", status: "active", is_favorite: false, is_pinned: false, daily_date: null,
        revision: 1, created_at: "2026-08-22T00:00:00.000Z", updated_at: "2026-08-22T00:00:00.000Z",
      },
    });

    await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/notes/note-latest",
      method: "PATCH",
      body: expect.objectContaining({ title: "最新标题", content: "最新内容" }),
    })));
    expect(await screen.findByRole("heading", { name: "最新标题", level: 1 })).toBeInTheDocument();
  });

  it("retains the latest input locally after server failure and recovers it after remount", async () => {
    const localStore = createDraftStore();
    const apiClient = createApiClient({ createNote: async () => { throw new Error("offline"); } });
    const first = renderWorkspaceWithStore(apiClient, localStore);

    await screen.findByRole("button", { name: "打开笔记列表" });
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    const title = await screen.findByRole("textbox", { name: "笔记标题" });
    fireEvent.change(title, { target: { value: "离线标题" } });
    fireEvent.change(screen.getByRole("textbox", { name: "笔记内容" }), { target: { value: "离线内容" } });
    await waitFor(async () => expect((await localStore.listDrafts("ws-1")).some((draft) => draft.title === "离线标题")).toBe(true));
    first.unmount();

    renderWorkspaceWithStore(apiClient, localStore);
    expect(await screen.findByRole("textbox", { name: "笔记标题" })).toHaveValue("离线标题");
    expect(screen.getByRole("textbox", { name: "笔记内容" })).toHaveValue("离线内容");
  });

  it("recovers only after note loading settles and never overwrites a selected server note", async () => {
    const localStore = createDraftStore([{ workspace_id: "ws-1", entity_id: "local-1", title: "Recovered", content: "local", updated_at: "2026-08-22T00:02:00.000Z" }]);
    let resolveNotes!: (value: unknown) => void;
    const notesLoading = new Promise((resolve) => { resolveNotes = resolve; });
    const serverNote = {
      id: "server-1", workspace_id: "ws-1", folder_id: null, database_id: null, created_by: "user-1", updated_by: "user-1",
      title: "Server note", content: "server", status: "active", is_favorite: false, is_pinned: false, daily_date: null,
      revision: 1, created_at: "2026-08-22T00:00:00.000Z", updated_at: "2026-08-22T00:00:00.000Z",
    };
    const apiClient = createApiClient({ listNotes: async () => notesLoading });
    let releaseDrafts!: (drafts: LocalDraft[]) => void;
    const draftsBlocked = new Promise<LocalDraft[]>((resolve) => { releaseDrafts = resolve; });
    localStore.listDrafts.mockImplementation(async () => draftsBlocked);
    renderWorkspaceWithStore(apiClient, localStore);
    expect(localStore.listDrafts).not.toHaveBeenCalled();
    resolveNotes({ items: [serverNote], next_cursor: null });

    await waitFor(() => expect(localStore.listDrafts).toHaveBeenCalledWith("ws-1"));
    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getByRole("button", { name: /Server note/ }));
    releaseDrafts([localStore.getDraft("ws-1", "local-1")!]);
    expect(await screen.findByRole("textbox", { name: "笔记标题" })).toHaveValue("Server note");
  });

  it("keeps draft recovery isolated when the active workspace changes", async () => {
    const localStore = createDraftStore([
      { workspace_id: "ws-1", entity_id: "local-1", title: "Workspace one", content: "one", updated_at: "2026-08-22T00:01:00.000Z" },
      { workspace_id: "ws-2", entity_id: "local-2", title: "Workspace two", content: "two", updated_at: "2026-08-22T00:02:00.000Z" },
    ]);
    const apiClient = createApiClient();
    const first = renderWorkspaceWithStore(apiClient, localStore, "ws-1");
    expect(await screen.findByRole("textbox", { name: "笔记标题" })).toHaveValue("Workspace one");
    first.unmount();

    renderWorkspaceWithStore(apiClient, localStore, "ws-2");
    expect(await screen.findByRole("textbox", { name: "笔记标题" })).toHaveValue("Workspace two");
  });
});
