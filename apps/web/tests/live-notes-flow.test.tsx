import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { ApiClientError } from "../src/data/api-client";
import type { LocalDraft } from "../src/data/local-store";
import { NoteDraftController } from "../src/notes/note-draft-controller";

const session = {
  user: { id: "user-1", email: "user@example.com", displayName: "User" },
  workspaces: [{ id: "ws-1", name: "Personal", slug: "personal", role: "owner" as const, revision: 1 }],
  active_workspace_id: "ws-1",
};

const findNoteTitle = () => screen.findByRole("textbox", { name: "笔记标题" }, { timeout: 3000 });

type NoteApiOptions = {
  createNote?: (input: { path: string; method?: string; body?: Record<string, unknown> }) => Promise<unknown>;
  openOrCreateDaily?: (input: { path: string; method?: string; body?: Record<string, unknown> }) => Promise<unknown>;
  listNotes?: (workspaceId: string) => Promise<unknown>;
  listToday?: (workspaceId: string) => Promise<unknown>;
  listTrash?: (workspaceId: string) => Promise<unknown>;
  deletePermanently?: (input: { path: string; method?: string; body?: Record<string, unknown> }) => Promise<unknown>;
};

function createDraftStore(initial: LocalDraft[] = []) {
  const drafts = new Map(initial.map((draft) => [`${draft.workspace_id}:${draft.entity_id}`, draft]));
  const removeDraft = vi.fn(async (workspaceId: string, entityId: string) => { drafts.delete(`${workspaceId}:${entityId}`); });
  return {
    saveDraft: vi.fn(async (draft: LocalDraft) => { drafts.set(`${draft.workspace_id}:${draft.entity_id}`, { ...draft }); }),
    mutateDraft: vi.fn(async (workspaceId: string, entityId: string, mutation: (current: LocalDraft | null) => LocalDraft | null | undefined) => {
      const key = `${workspaceId}:${entityId}`;
      const current = drafts.get(key) ?? null;
      const next = mutation(current ? { ...current } : null);
      if (next === undefined) return current ? { ...current } : null;
      if (next === null) { await removeDraft(workspaceId, entityId); return null; }
      drafts.set(key, { ...next });
      return { ...next };
    }),
    listDrafts: vi.fn(async (workspaceId: string) => [...drafts.values()].filter((draft) => draft.workspace_id === workspaceId).sort((left, right) => right.updated_at.localeCompare(left.updated_at))),
    removeDraft,
    getDraft: (workspaceId: string, entityId: string) => drafts.get(`${workspaceId}:${entityId}`) ?? null,
  };
}

function serverNoteForFlow() {
  return {
    id: "server-flow",
    workspace_id: "ws-1",
    folder_id: null,
    database_id: null,
    created_by: "user-1",
    updated_by: "user-1",
    title: "",
    content: "",
    status: "active" as const,
    is_favorite: false,
    is_pinned: false,
    daily_date: null,
    revision: 1,
    created_at: "2026-08-22T00:00:00.000Z",
    updated_at: "2026-08-22T00:00:00.000Z",
  };
}

function createApiClient(options: NoteApiOptions = {}) {
  let nextNoteId = 1;
  const request = vi.fn(async (input: { path: string; method?: string; body?: Record<string, unknown>; headers?: Record<string, string> }) => {
    if (input.path.startsWith("/api/v2/attachments")) return { items: [], next_cursor: null };
    if (input.path.startsWith("/api/v2/knowledge/diagnostics")) return { items: [], next_cursor: null };
    if (input.path.startsWith("/api/v2/notifications/unread")) return { unread_count: 0 };
    if (input.path === "/api/v2/notes?status=active&limit=50") return options.listNotes?.(input.headers?.["x-workspace-id"] ?? "ws-1") ?? { items: [], next_cursor: null };
    if (input.path === "/api/v2/notes?status=trashed&limit=50") return options.listTrash?.(input.headers?.["x-workspace-id"] ?? "ws-1") ?? { items: [], next_cursor: null };
    if (input.path.startsWith("/api/v2/notes?status=active&daily_date=")) return options.listToday?.(input.headers?.["x-workspace-id"] ?? "ws-1") ?? { items: [], next_cursor: null };
    if (input.path === "/api/v2/notes/daily" && input.method === "POST") {
      if (options.openOrCreateDaily) return options.openOrCreateDaily(input);
      return { note: { ...serverNoteForFlow(), id: `daily-${nextNoteId++}`, title: `Daily Note ${input.body?.daily_date ?? ""}`, daily_date: input.body?.daily_date ?? null } };
    }
    if (input.path.startsWith("/api/v2/notes/") && input.method === "DELETE") {
      if (options.deletePermanently) return options.deletePermanently(input);
      return { deleted: true };
    }
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

function renderWorkspace(apiClient: ReturnType<typeof createApiClient>, width = 929) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
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
  const workspaceSession = {
    ...session,
    workspaces: [
      ...session.workspaces,
      { id: "ws-2", name: "Workspace two", slug: "workspace-two", role: "owner" as const, revision: 1 },
    ],
    active_workspace_id: workspaceId,
  };
  return render(
    <App
      authClient={{ session: vi.fn(async () => workspaceSession) } as any}
      apiClient={apiClient as any}
      localStore={localStore as any}
      workspaceId={workspaceId}
      turnstileSiteKey="test-site-key"
    />,
  );
}

describe("live note workspace flow", () => {
  it("keeps the Today action visible and usable at the mobile breakpoint", async () => {
    const apiClient = createApiClient();
    renderWorkspace(apiClient, 390);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getByRole("button", { name: "今日" }));
    const openDaily = await screen.findByRole("button", { name: "打开今日笔记" });
    expect(openDaily).toBeVisible();
    expect(openDaily).not.toHaveClass("note-empty-create-note");
    fireEvent.click(openDaily);
    await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/notes/daily", method: "POST" })));
  });

  it("shows a retryable Today error in the active context pane and re-enables retry", async () => {
    const apiClient = createApiClient({
      listToday: async () => ({ items: [], next_cursor: null }),
      openOrCreateDaily: async () => { throw new ApiClientError({ code: "NETWORK_ERROR", message: "offline", retryable: true }); },
    });
    renderWorkspace(apiClient, 929);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getByRole("button", { name: "今日" }));
    const openDaily = await screen.findByRole("button", { name: "打开今日笔记" });
    fireEvent.click(openDaily);

    const pane = screen.getByTestId("task-pane");
    expect(await screen.findByRole("alert")).toHaveTextContent("今日笔记暂时无法打开，可重试。当前选择和草稿内容已保留。");
    expect(pane).toContainElement(screen.getByRole("alert"));
    expect(openDaily).toBeEnabled();
    expect(screen.getByRole("button", { name: "今日" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens an existing Today note locally without another create request", async () => {
    const date = [new Date().getFullYear(), String(new Date().getMonth() + 1).padStart(2, "0"), String(new Date().getDate()).padStart(2, "0")].join("-");
    const daily = { ...serverNoteForFlow(), id: "daily-existing", title: "Existing daily", daily_date: date };
    const apiClient = createApiClient({ listToday: async () => ({ items: [daily], next_cursor: null }) });
    renderWorkspace(apiClient);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getByRole("button", { name: "今日" }));
    await screen.findByRole("button", { name: /Existing daily/ });
    fireEvent.click(screen.getByRole("button", { name: "打开今日笔记" }));

    expect(await findNoteTitle()).toHaveValue("Existing daily");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "笔记标题" })).toHaveFocus());
    expect(apiClient.request.mock.calls.filter(([request]) => request.path === "/api/v2/notes/daily" && request.method === "POST")).toHaveLength(0);
  });

  it("creates, selects, and focuses a missing Today note while preventing duplicate requests", async () => {
    let resolveDaily!: (value: unknown) => void;
    const dailyBlocked = new Promise((resolve) => { resolveDaily = resolve; });
    const apiClient = createApiClient({ listToday: async () => ({ items: [], next_cursor: null }), openOrCreateDaily: async () => dailyBlocked });
    renderWorkspace(apiClient);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getByRole("button", { name: "今日" }));
    const openDaily = await screen.findByRole("button", { name: "打开今日笔记" });
    fireEvent.click(openDaily);
    fireEvent.click(openDaily);
    await waitFor(() => expect(apiClient.request.mock.calls.filter(([request]) => request.path === "/api/v2/notes/daily" && request.method === "POST")).toHaveLength(1));
    expect(openDaily).toBeDisabled();

    const request = apiClient.request.mock.calls.find(([input]) => input.path === "/api/v2/notes/daily")![0];
    resolveDaily({ note: { ...serverNoteForFlow(), id: "daily-created", title: `Daily Note ${request.body!.daily_date}`, daily_date: request.body!.daily_date } });
    expect(await findNoteTitle()).toHaveValue(`Daily Note ${request.body!.daily_date}`);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "笔记标题" })).toHaveFocus());
  });

  it("keeps the current draft and Today view when opening today's note fails", async () => {
    let resolveCreate!: (value: unknown) => void;
    const createBlocked = new Promise((resolve) => { resolveCreate = resolve; });
    const apiClient = createApiClient({
      createNote: async () => createBlocked,
      listToday: async () => ({ items: [], next_cursor: null }),
      openOrCreateDaily: async () => { throw new ApiClientError({ code: "NETWORK_ERROR", message: "offline", retryable: true }); },
    });
    renderWorkspace(apiClient);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]!);
    fireEvent.change(await findNoteTitle(), { target: { value: "保留的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getByRole("button", { name: "今日" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开今日笔记" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("今日笔记暂时无法打开，可重试。当前选择和草稿内容已保留。");
    expect(screen.getByRole("button", { name: "今日" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "笔记标题" })).toHaveValue("保留的草稿");
    resolveCreate({ note: serverNoteForFlow() });
  });

  it.each([
    ["conflict", new ApiClientError({ code: "NOTE_CONFLICT", message: "Conflict", request_id: "req-conflict", retryable: false }), "笔记已发生变化", "req-conflict"],
    ["not trashed", new ApiClientError({ code: "NOTE_NOT_TRASHED", message: "Not trashed", request_id: "req-not-trashed", retryable: false }), "已不在回收站", "req-not-trashed"],
    ["not found", new ApiClientError({ code: "NOTE_NOT_FOUND", message: "Missing", request_id: "req-not-found", retryable: false }), "已不存在或无权访问", "req-not-found"],
    ["transient network", new ApiClientError({ code: "NETWORK_ERROR", message: "Offline", request_id: "req-network", retryable: true }), "仍保留在回收站中，可安全重试", "req-network"],
    ["unknown", new Error("unexpected"), "永久删除失败，请重试", undefined],
  ])("keeps the Trash dialog open with a normalized %s deletion error", async (_kind, error, message, requestId) => {
    const trashed = { ...serverNoteForFlow(), id: "trashed-error", title: "Trashed error", status: "trashed" as const, revision: 4 };
    const apiClient = createApiClient({
      listTrash: async () => ({ items: [trashed], next_cursor: null }),
      deletePermanently: async () => { throw error; },
    });
    renderWorkspace(apiClient);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(await screen.findByRole("button", { name: "回收站" }));
    fireEvent.click(await screen.findByRole("button", { name: /Trashed error/ }));
    fireEvent.click(await screen.findByRole("button", { name: "永久删除" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认永久删除" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    if (requestId) expect(alert).toHaveTextContent(requestId);
    expect(screen.getByRole("dialog", { name: "永久删除笔记" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认永久删除" })).toBeEnabled();
  });

  it("keeps focus in the permanent delete dialog while its request is pending", async () => {
    const trashed = { ...serverNoteForFlow(), id: "trashed-pending", title: "Trashed pending", status: "trashed" as const, revision: 4 };
    let resolveDelete!: (value: { deleted: true }) => void;
    const pendingDelete = new Promise<{ deleted: true }>((resolve) => { resolveDelete = resolve; });
    const apiClient = createApiClient({
      listTrash: async () => ({ items: [trashed], next_cursor: null }),
      deletePermanently: async () => pendingDelete,
    });
    renderWorkspace(apiClient);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    fireEvent.click(await screen.findByRole("button", { name: /Trashed pending/ }));
    fireEvent.click(await screen.findByRole("button", { name: "永久删除" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认永久删除" }));

    const dialog = screen.getByRole("dialog", { name: "永久删除笔记" });
    await waitFor(() => expect(screen.getByRole("button", { name: "正在永久删除…" })).toBeDisabled());
    for (const shiftKey of [false, true]) {
      const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(dialog).toHaveFocus();
    }
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(dialog).toBeInTheDocument();
    resolveDelete({ deleted: true });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "永久删除笔记" })).not.toBeInTheDocument());
  });

  it("keeps the workbench inert and ignores Ctrl+N while permanent deletion is pending", async () => {
    const trashed = { ...serverNoteForFlow(), id: "trashed-shortcut", title: "Trashed shortcut", status: "trashed" as const, revision: 4 };
    let resolveDelete!: (value: { deleted: true }) => void;
    const pendingDelete = new Promise<{ deleted: true }>((resolve) => { resolveDelete = resolve; });
    const apiClient = createApiClient({
      listTrash: async () => ({ items: [trashed], next_cursor: null }),
      deletePermanently: async () => pendingDelete,
    });
    renderWorkspace(apiClient);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    fireEvent.click(await screen.findByRole("button", { name: /Trashed shortcut/ }));
    fireEvent.click(await screen.findByRole("button", { name: "永久删除" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认永久删除" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "正在永久删除…" })).toBeDisabled());
    expect(document.querySelector(".workbench-canvas")).toHaveAttribute("inert");
    expect(document.querySelector('nav[aria-label="主导航"]')).toHaveAttribute("inert");
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(apiClient.request.mock.calls.filter(([request]) => request.path === "/api/v2/notes" && request.method === "POST")).toHaveLength(0);
    expect(screen.getByRole("textbox", { name: "笔记标题", hidden: true })).toHaveValue("Trashed shortcut");

    resolveDelete({ deleted: true });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "永久删除笔记" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Trashed shortcut/ })).not.toBeInTheDocument();
    expect(apiClient.request.mock.calls.filter(([request]) => request.path === "/api/v2/notes" && request.method === "POST")).toHaveLength(0);
  });

  it("keeps permanent deletion reachable and actionable at 390px", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: { height: 500, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() } });
    const trashed = { ...serverNoteForFlow(), id: "trashed-mobile", title: "Trashed mobile", status: "trashed" as const, revision: 4 };
    const apiClient = createApiClient({ listTrash: async () => ({ items: [trashed], next_cursor: null }) });
    renderWorkspace(apiClient, 390);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    fireEvent.click(await screen.findByRole("button", { name: /Trashed mobile/ }));
    fireEvent.click(await screen.findByRole("button", { name: "永久删除" }));
    const dialog = await screen.findByRole("dialog", { name: "永久删除笔记" });
    expect(dialog).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "取消" })).toBeVisible();
    expect(screen.getByRole("button", { name: "确认永久删除" })).toBeVisible();
  });

  it("confirms permanent Trash deletion accessibly, prevents duplicates, and preserves retry after failure", async () => {
    const trashed = { ...serverNoteForFlow(), id: "trashed-1", title: "Trashed note", content: "Keep until confirmed", status: "trashed" as const, revision: 4 };
    let rejectDelete = true;
    const apiClient = createApiClient({
      listTrash: async () => ({ items: [trashed], next_cursor: null }),
      deletePermanently: async () => {
        if (rejectDelete) throw new Error("offline");
        return { deleted: true };
      },
    });
    renderWorkspace(apiClient);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    const row = await screen.findByRole("button", { name: /Trashed note/ });
    fireEvent.click(row);
    const opener = await screen.findByRole("button", { name: "永久删除" });
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "永久删除笔记" });
    expect(dialog).toHaveTextContent("此操作不可撤销");
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "确认永久删除" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.getByRole("textbox", { name: "笔记标题" })).toHaveValue("Trashed note");

    fireEvent.click(opener);
    const confirm = await screen.findByRole("button", { name: "确认永久删除" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(apiClient.request.mock.calls.filter(([request]) => request.method === "DELETE")).toHaveLength(1));
    expect(await screen.findByRole("alert")).toHaveTextContent("永久删除失败");
    expect(screen.getByRole("dialog", { name: "永久删除笔记" })).toBeInTheDocument();

    rejectDelete = false;
    fireEvent.click(screen.getByRole("button", { name: "确认永久删除" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "永久删除笔记" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Trashed note/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Public Beta 重写计划" })).toHaveFocus();
  });

  it("opens the tablet context drawer so the note creation action is reachable", async () => {
    const apiClient = createApiClient();
    renderWorkspace(apiClient);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));

    await waitFor(() => expect(screen.getAllByRole("button", { name: "新建笔记" }).length).toBeGreaterThanOrEqual(2));
  });

  it("creates and opens one durable draft from one click, focusing its title", async () => {
    let resolveCreate!: (value: unknown) => void;
    const createBlocked = new Promise((resolve) => { resolveCreate = resolve; });
    const apiClient = createApiClient({ createNote: async () => createBlocked });
    renderWorkspace(apiClient);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]);

    const title = await findNoteTitle();
    await waitFor(() => expect(title).toHaveFocus());
    resolveCreate({ note: serverNoteForFlow() });
    await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/notes", method: "POST" })));
  });

  it("handles Ctrl+N and Cmd+N as one activation while suppressing rapid duplicates and repeats", async () => {
    const apiClient = createApiClient();
    renderWorkspace(apiClient);
    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    fireEvent.keyDown(window, { key: "n", metaKey: true, repeat: true });
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });

    const title = await findNoteTitle();
    await waitFor(() => expect(title).toHaveFocus());
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
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]!);
    const title = await findNoteTitle();
    await waitFor(() => expect(title).toHaveFocus());
    await waitFor(() => expect(localStore.removeDraft).toHaveBeenCalledWith("ws-1", expect.any(String)));
    expect(await screen.findByRole("heading", { name: "未命名笔记", level: 1 })).toBeInTheDocument();
  });

  it("installs the server note before the post-commit reconcile removes the draft", async () => {
    const localStore = createDraftStore();
    let removalSawInstalledNote = false;
    let resolveCreate!: (value: unknown) => void;
    const createBlocked = new Promise((resolve) => { resolveCreate = resolve; });
    localStore.removeDraft.mockImplementation(async (workspaceId: string, entityId: string) => {
      removalSawInstalledNote = Boolean(screen.queryByRole("heading", { name: "未命名笔记", level: 1 }));
      localStore.getDraft(workspaceId, entityId);
    });
    const apiClient = createApiClient({ createNote: async () => createBlocked });
    renderWorkspaceWithStore(apiClient, localStore);

    await screen.findByRole("button", { name: "打开笔记列表" });
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]!);
    await findNoteTitle();
    resolveCreate({ note: serverNoteForFlow() });
    await waitFor(() => expect(localStore.removeDraft).toHaveBeenCalled());
    expect(removalSawInstalledNote).toBe(true);
  });

  it("routes edits during installed-note reconciliation to the server note path", async () => {
    const localStore = createDraftStore();
    let releaseRemove!: () => void;
    const removeBlocked = new Promise<void>((resolve) => { releaseRemove = resolve; });
    localStore.removeDraft.mockImplementation(async () => removeBlocked);
    const apiClient = createApiClient();
    const draftSave = vi.spyOn(NoteDraftController.prototype, "save");
    renderWorkspaceWithStore(apiClient, localStore);

    await screen.findByRole("button", { name: "打开笔记列表" });
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]!);
    await findNoteTitle();
    await waitFor(() => expect(localStore.removeDraft).toHaveBeenCalled());
    const savesBeforeEdit = localStore.saveDraft.mock.calls.length;
    const title = screen.getByRole("textbox", { name: "笔记标题" });
    fireEvent.change(title, { target: { value: "编辑已绑定笔记" } });
    expect(draftSave).not.toHaveBeenCalled();
    expect(localStore.saveDraft.mock.calls.length).toBe(savesBeforeEdit);
    fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
    await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/notes/note-1", method: "PATCH", body: expect.objectContaining({ title: "编辑已绑定笔记" }),
    })));
    draftSave.mockRestore();
    releaseRemove();
  });

  it("reconciles the latest title and content when they change during server creation", async () => {
    const localStore = createDraftStore();
    let resolveCreate!: (value: unknown) => void;
    const createBlocked = new Promise((resolve) => { resolveCreate = resolve; });
    const apiClient = createApiClient({ createNote: async () => createBlocked });
    renderWorkspaceWithStore(apiClient, localStore);

    await screen.findByRole("button", { name: "打开笔记列表" });
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]!);
    const title = await findNoteTitle();
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

  it("keeps the selected note visible while an older draft finishes server creation", async () => {
    const existingNote = {
      id: "existing-1", workspace_id: "ws-1", folder_id: null, database_id: null, created_by: "user-1", updated_by: "user-1",
      title: "Existing note", content: "Existing content", status: "active", is_favorite: false, is_pinned: false, daily_date: null,
      revision: 1, created_at: "2026-08-22T00:00:00.000Z", updated_at: "2026-08-22T00:00:00.000Z",
    };
    let resolveCreate!: (value: unknown) => void;
    const createBlocked = new Promise((resolve) => { resolveCreate = resolve; });
    const apiClient = createApiClient({ listNotes: async () => ({ items: [existingNote], next_cursor: null }), createNote: async () => createBlocked });
    const localStore = createDraftStore();
    renderWorkspaceWithStore(apiClient, localStore);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]!);
    await findNoteTitle();
    fireEvent.click(screen.getByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getByRole("button", { name: /Existing note/ }));
    expect(screen.getByRole("textbox", { name: "笔记标题" })).toHaveValue("Existing note");
    resolveCreate({ note: { ...existingNote, id: "created-old", title: "", content: "" } });

    await waitFor(() => expect(localStore.removeDraft).toHaveBeenCalledWith("ws-1", expect.any(String)));
    expect(screen.getByRole("textbox", { name: "笔记标题" })).toHaveValue("Existing note");
  });

  it("finishes an old workspace draft after unmount without changing the new workspace UI", async () => {
    let resolveCreate!: (value: unknown) => void;
    const createBlocked = new Promise((resolve) => { resolveCreate = resolve; });
    const apiClient = createApiClient({ createNote: async () => createBlocked });
    const localStore = createDraftStore();
    const first = renderWorkspaceWithStore(apiClient, localStore, "ws-1");
    await screen.findByRole("button", { name: "打开笔记列表" });
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]!);
    await findNoteTitle();

    first.unmount();
    const second = renderWorkspaceWithStore(apiClient, localStore, "ws-2");
    await screen.findByRole("button", { name: "打开笔记列表" });
    expect(screen.queryByRole("textbox", { name: "笔记标题" })).not.toBeInTheDocument();
    resolveCreate({ note: { ...serverNoteForFlow(), id: "old-server" } });

    await waitFor(() => expect(localStore.listDrafts("ws-1")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ server_note: expect.objectContaining({ id: "old-server" }) }),
    ])));
    expect(localStore.removeDraft).not.toHaveBeenCalledWith("ws-1", expect.any(String));
    expect(second.container.querySelector("input[aria-label='笔记标题']")).toBeNull();
  });

  it("keeps a server-bound draft after unmount before installation", async () => {
    let resolveCreate!: (value: unknown) => void;
    const createBlocked = new Promise((resolve) => { resolveCreate = resolve; });
    const apiClient = createApiClient({ createNote: async () => createBlocked });
    const localStore = createDraftStore();
    const first = renderWorkspaceWithStore(apiClient, localStore, "ws-1");
    await screen.findByRole("button", { name: "打开笔记列表" });
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]!);
    const title = await findNoteTitle();
    fireEvent.change(title, { target: { value: "Keep me" } });
    const draftId = [...localStore.listDrafts.mock.results].length;
    first.unmount();
    renderWorkspaceWithStore(apiClient, localStore, "ws-2");
    resolveCreate({ note: { ...serverNoteForFlow(), id: "old-server", title: "Keep me" } });

    await waitFor(() => expect(localStore.listDrafts("ws-1")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Keep me", server_note: expect.objectContaining({ id: "old-server" }) }),
    ])));
    expect(localStore.removeDraft).not.toHaveBeenCalledWith("ws-1", expect.any(String));
    expect(draftId).toBeGreaterThanOrEqual(0);
  });

  it("adds a completed server note without stealing a same-workspace selection", async () => {
    const existingNote = {
      id: "existing-1", workspace_id: "ws-1", folder_id: null, database_id: null, created_by: "user-1", updated_by: "user-1",
      title: "Existing note", content: "Existing content", status: "active", is_favorite: false, is_pinned: false, daily_date: null,
      revision: 1, created_at: "2026-08-22T00:00:00.000Z", updated_at: "2026-08-22T00:00:00.000Z",
    };
    let resolveCreate!: (value: unknown) => void;
    const createBlocked = new Promise((resolve) => { resolveCreate = resolve; });
    const apiClient = createApiClient({ listNotes: async () => ({ items: [existingNote], next_cursor: null }), createNote: async () => createBlocked });
    const localStore = createDraftStore();
    renderWorkspaceWithStore(apiClient, localStore);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]!);
    await findNoteTitle();
    fireEvent.click(screen.getByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getByRole("button", { name: /Existing note/ }));
    resolveCreate({ note: { ...existingNote, id: "created-old", title: "", content: "" } });

    expect(await findNoteTitle()).toHaveValue("Existing note");
    fireEvent.click(screen.getByRole("button", { name: "打开笔记列表" }));
    expect(await screen.findByRole("button", { name: /未命名笔记/ })).toBeInTheDocument();
  });

  it.each([
    ["收件箱", "folder_id=none"],
    ["今日", "daily_date="],
  ])("keeps an installed note out of the %s view when it does not match", async (viewName, queryPart) => {
    const localStore = createDraftStore();
    const filedNote = {
      ...serverNoteForFlow(),
      id: "filed-note",
      folder_id: "folder-1",
      title: "Filed note",
    };
    let resolveCreate!: (value: unknown) => void;
    const createBlocked = new Promise((resolve) => { resolveCreate = resolve; });
    const apiClient = createApiClient({ createNote: async () => createBlocked });
    renderWorkspaceWithStore(apiClient, localStore);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]!);
    fireEvent.change(await findNoteTitle(), { target: { value: "Filed note" } });
    resolveCreate({ note: filedNote });
    expect(await screen.findByRole("heading", { name: "Filed note", level: 1 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getByRole("button", { name: viewName }));
    await waitFor(() => expect(apiClient.request.mock.calls.some(([request]) => request.path.includes(queryPart))).toBe(true));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Filed note/ })).not.toBeInTheDocument());
  });

  it("does not insert a non-matching note when its server sync finishes inside the inbox view", async () => {
    const localStore = createDraftStore();
    let resolveCreate!: (value: unknown) => void;
    const createBlocked = new Promise((resolve) => { resolveCreate = resolve; });
    const apiClient = createApiClient({ createNote: async () => createBlocked });
    renderWorkspaceWithStore(apiClient, localStore);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]!);
    fireEvent.change(await findNoteTitle(), { target: { value: "Filed during sync" } });
    fireEvent.click(screen.getByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getByRole("button", { name: "收件箱" }));
    await waitFor(() => expect(apiClient.request.mock.calls.some(([request]) => request.path.includes("folder_id=none"))).toBe(true));

    resolveCreate({
      note: {
        ...serverNoteForFlow(),
        id: "filed-during-sync",
        folder_id: "folder-1",
        title: "Filed during sync",
      },
    });

    await waitFor(() => expect(localStore.removeDraft).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Filed during sync/ })).not.toBeInTheDocument();
  });

  it("does not duplicate the initial empty draft write from an effect", async () => {
    let resolveCreate!: (value: unknown) => void;
    const createBlocked = new Promise((resolve) => { resolveCreate = resolve; });
    const apiClient = createApiClient({ createNote: async () => createBlocked });
    const localStore = createDraftStore();
    renderWorkspaceWithStore(apiClient, localStore);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]);
    await findNoteTitle();
    await waitFor(() => expect(localStore.saveDraft.mock.calls.filter(([draft]) => (
      draft.title === "" && draft.content === "" && draft.server_note === undefined && draft.pending_patch === undefined
      && draft.server_create_title === undefined
    ))).toHaveLength(1));
    resolveCreate({ note: serverNoteForFlow() });
  });

  it("retains the latest input locally after server failure and recovers it after remount", async () => {
    const localStore = createDraftStore();
    const apiClient = createApiClient({ createNote: async () => { throw new Error("offline"); } });
    const first = renderWorkspaceWithStore(apiClient, localStore);

    await screen.findByRole("button", { name: "打开笔记列表" });
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]!);
    const title = await findNoteTitle();
    fireEvent.change(title, { target: { value: "离线标题" } });
    fireEvent.change(screen.getByRole("textbox", { name: "笔记内容" }), { target: { value: "离线内容" } });
    await waitFor(async () => expect((await localStore.listDrafts("ws-1")).some((draft) => draft.title === "离线标题")).toBe(true));
    first.unmount();

    renderWorkspaceWithStore(apiClient, localStore);
    expect(await findNoteTitle()).toHaveValue("离线标题");
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
    expect(await findNoteTitle()).toHaveValue("Server note");
  });

  it("keeps draft recovery isolated when the active workspace changes", async () => {
    const localStore = createDraftStore([
      { workspace_id: "ws-1", entity_id: "local-1", title: "Workspace one", content: "one", updated_at: "2026-08-22T00:01:00.000Z" },
      { workspace_id: "ws-2", entity_id: "local-2", title: "Workspace two", content: "two", updated_at: "2026-08-22T00:02:00.000Z" },
    ]);
    const apiClient = createApiClient();
    const first = renderWorkspaceWithStore(apiClient, localStore, "ws-1");
    expect(await findNoteTitle()).toHaveValue("Workspace one");
    first.unmount();

    renderWorkspaceWithStore(apiClient, localStore, "ws-2");
    expect(await findNoteTitle()).toHaveValue("Workspace two");
  });
});
