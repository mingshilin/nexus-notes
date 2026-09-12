import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { CreateCenter } from "../src/create/CreateCenter";

type CreateOutcome = { status: "completed" } | { status: "rejected"; message: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function CreateCenterHarness({ onCreateNote = vi.fn(), onQuickCapture = vi.fn() }: {
  onCreateNote?: () => CreateOutcome | Promise<CreateOutcome>;
  onQuickCapture?: () => CreateOutcome | Promise<CreateOutcome>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <CreateCenter
      open={open}
      onOpenChange={setOpen}
      onCreateNote={onCreateNote as any}
      onQuickCapture={onQuickCapture as any}
      onTodayNote={vi.fn()}
      onCreateDatabase={vi.fn()}
    />
  );
}

function DelayedFocusReturnHarness() {
  const [open, setOpen] = useState(false);
  const [backgroundInert, setBackgroundInert] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <div inert={backgroundInert || undefined}>
        <button
          ref={openerRef}
          type="button"
          onClick={() => {
            setBackgroundInert(true);
            setOpen(true);
          }}
        >
          外部创建入口
        </button>
      </div>
      <CreateCenter
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) window.setTimeout(() => setBackgroundInert(false), 20);
        }}
        renderTrigger={false}
        focusReturnRef={openerRef}
        onCreateNote={vi.fn()}
      />
    </>
  );
}

const existingNote = {
  id: "note-existing",
  workspace_id: "ws-1",
  folder_id: null,
  database_id: null,
  created_by: "u1",
  updated_by: "u1",
  title: "已有笔记",
  content: "已有内容",
  status: "active" as const,
  is_favorite: false,
  is_pinned: false,
  daily_date: null,
  revision: 1,
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:00:00.000Z",
};

function authenticatedSession() {
  return {
    user: { id: "u1", email: "u@example.test", displayName: "用户" },
    workspaces: [{ id: "ws-1", name: "个人", slug: "personal", role: "owner" as const, revision: 1 }],
    active_workspace_id: "ws-1",
  };
}

function appApiClient(notes = [] as typeof existingNote[], createNoteGate?: Promise<unknown>) {
  const createdNote = { ...existingNote, id: "server-created", title: "", content: "" };
  return {
    request: vi.fn(async (request: { path: string; method?: string }) => {
      if (request.path === "/api/v2/profile") {
        return { id: "u1", email: "u@example.test", display_name: "用户", biography: "", locale: "zh-CN", timezone: "Asia/Shanghai", avatar_url: null, updated_at: "2026-08-23T00:00:00.000Z" };
      }
      if (request.path === "/api/v2/profile/sessions" || request.path === "/api/v2/members") return { items: [] };
      if (request.path === "/api/v2/operations/usage") return { notes: notes.length, databases: 0, attachment_bytes: 0, queued_jobs: 0 };
      if (request.path === "/api/v2/operations/status") return { queue: "ready", storage: "ready", ocr: "ready", version: "test" };
      if (request.path === "/api/v2/notifications/unread") return { unread_count: 0 };
      if (request.path === "/api/v2/notes?status=active&limit=50") return { items: notes, next_cursor: null };
      if (request.path === "/api/v2/notes" && request.method === "POST") return createNoteGate ?? { note: createdNote };
      return { items: [], next_cursor: null };
    }),
  };
}

function memoryDraftStore(saveDraftGate?: Promise<void>, initialDrafts: any[] = []) {
  const key = (workspaceId: string, entityId: string) => `${workspaceId}:${entityId}`;
  const drafts = new Map<string, any>(initialDrafts.map((draft) => [key(draft.workspace_id, draft.entity_id), { ...draft }]));
  return {
    saveDraft: vi.fn(async (draft: any) => {
      if (saveDraftGate) await saveDraftGate;
      drafts.set(key(draft.workspace_id, draft.entity_id), { ...draft });
    }),
    mutateDraft: vi.fn(async (workspaceId: string, entityId: string, mutation: (current: any) => any) => {
      const draftKey = key(workspaceId, entityId);
      const next = mutation(drafts.get(draftKey) ?? null);
      if (next === null) drafts.delete(draftKey);
      else if (next !== undefined) drafts.set(draftKey, { ...next });
      return drafts.get(draftKey) ?? null;
    }),
    getDraft: vi.fn(async (workspaceId: string, entityId: string) => drafts.get(key(workspaceId, entityId)) ?? null),
    listDrafts: vi.fn(async (workspaceId: string) => [...drafts.values()].filter((draft) => draft.workspace_id === workspaceId)),
    removeDraft: vi.fn(async (workspaceId: string, entityId: string) => { drafts.delete(key(workspaceId, entityId)); }),
    destroy: vi.fn(async () => undefined),
  };
}

describe("CreateCenter", () => {
  it("opens from the visible create-content trigger and runs quick capture", () => {
    const onQuickCapture = vi.fn();
    render(<CreateCenterHarness onQuickCapture={onQuickCapture} />);

    fireEvent.click(screen.getByRole("button", { name: "创建内容" }));

    expect(screen.getByRole("dialog", { name: "创建内容" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建笔记" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "快速捕获" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "快速捕获" }));

    expect(onQuickCapture).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "创建内容" })).not.toBeInTheDocument();
  });

  it("exposes a task database shortcut when the workspace supports it", async () => {
    const onCreateTaskDatabase = vi.fn(async () => ({ status: "completed" as const }));
    render(<CreateCenter
      open
      onOpenChange={vi.fn()}
      onCreateTaskDatabase={onCreateTaskDatabase}
      renderTrigger={false}
    />);

    fireEvent.click(screen.getByRole("button", { name: "任务数据库" }));
    await waitFor(() => expect(onCreateTaskDatabase).toHaveBeenCalledOnce());
  });

  it("explains unavailable actions instead of exposing silent no-op buttons", () => {
    render(<CreateCenterHarness />);
    fireEvent.click(screen.getByRole("button", { name: "创建内容" }));

    const reminder = screen.getByRole("button", { name: "新建提醒，即将开放" });
    const importer = screen.getByRole("button", { name: "导入内容，即将开放" });
    expect(reminder).toBeDisabled();
    expect(importer).toBeDisabled();
    expect(screen.getAllByText("即将开放").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the dialog open and explains a rejected create action", async () => {
    const onCreateNote = vi.fn(() => ({ status: "rejected" as const, message: "已有未完成操作，请完成后再试。" }));
    render(<CreateCenterHarness onCreateNote={onCreateNote} />);
    fireEvent.click(screen.getByRole("button", { name: "创建内容" }));

    fireEvent.click(screen.getByRole("button", { name: "新建笔记" }));

    expect(onCreateNote).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "创建内容" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("已有未完成操作");
  });

  it("keeps the action pending until a deferred create completes", async () => {
    const create = deferred<CreateOutcome>();
    const onCreateNote = vi.fn(() => create.promise);
    render(<CreateCenterHarness onCreateNote={onCreateNote} />);

    fireEvent.click(screen.getByRole("button", { name: "创建内容" }));
    fireEvent.click(screen.getByRole("button", { name: "新建笔记" }));

    const pending = screen.getByRole("button", { name: "新建笔记，处理中" });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(onCreateNote).toHaveBeenCalledOnce();

    create.resolve({ status: "completed" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "创建内容" })).not.toBeInTheDocument());
  });

  it("does not steal focus on mount and restores it only after closing", async () => {
    const view = render(<button type="button">原有焦点</button>);
    screen.getByRole("button", { name: "原有焦点" }).focus();
    view.rerender(<><button type="button">原有焦点</button><CreateCenterHarness /></>);
    const original = screen.getByRole("button", { name: "原有焦点" });
    const trigger = screen.getByRole("button", { name: "创建内容" });
    expect(original).toHaveFocus();

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "创建内容" });
    expect(trigger).toHaveAttribute("aria-controls", dialog.id);
    expect(screen.getByRole("button", { name: "关闭创建内容" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "关闭创建内容" }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("waits for a temporarily inert external opener before restoring focus", async () => {
    render(<DelayedFocusReturnHarness />);
    const opener = screen.getByRole("button", { name: "外部创建入口" });

    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "关闭创建内容" }));

    await waitFor(() => expect(opener.closest("[inert]")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("is visible in the authenticated App and opens the real quick-capture flow", async () => {
    const apiClient = appApiClient();
    render(
      <App
        authClient={{ session: vi.fn(async () => authenticatedSession()) } as any}
        apiClient={apiClient as any}
        turnstileSiteKey="test"
      />,
    );

    expect(await screen.findByRole("heading", { name: "功能地图" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创建内容" }));
    fireEvent.click(screen.getByRole("button", { name: "快速捕获" }));
    expect(await screen.findByRole("dialog", { name: "快速捕获" })).toBeInTheDocument();
  });

  it("keeps creation and account actions visible in the desktop canvas toolbar", async () => {
    render(<App authClient={{ session: vi.fn(async () => authenticatedSession()) } as any} apiClient={appApiClient() as any} turnstileSiteKey="test" />);

    const quickStart = await screen.findByRole("region", { name: "快速开始" });
    const toolbar = quickStart.closest(".workbench-canvas")?.querySelector(".desktop-create-note-bar");
    expect(toolbar).not.toBeNull();
    expect(within(toolbar as HTMLElement).getByRole("button", { name: "打开创建中心" })).toBeVisible();
    expect(within(toolbar as HTMLElement).getByRole("button", { name: "打开个人资料与设置" })).toBeVisible();
  });

  it("keeps a stable feature-map entry when an existing note is selected", async () => {
    render(<App authClient={{ session: vi.fn(async () => authenticatedSession()) } as any} apiClient={appApiClient([existingNote]) as any} turnstileSiteKey="test" />);

    expect(await screen.findByRole("heading", { name: "已有笔记" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "功能地图" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开功能地图" }));

    expect(screen.getByRole("heading", { name: "功能地图" })).toBeInTheDocument();
  });

  it("keeps the create center open when the App already has an active draft", async () => {
    const serverCreate = deferred<{ note: typeof existingNote }>();
    const apiClient = appApiClient([], serverCreate.promise);
    const activeDraft = {
      workspace_id: "ws-1",
      entity_id: "draft-existing",
      title: "",
      content: "",
      updated_at: "2026-08-23T00:00:00.000Z",
      draft_generation: 0,
      next_patch_generation: 1,
    };
    const localStore = memoryDraftStore(undefined, [activeDraft]);
    render(<App authClient={{ session: vi.fn(async () => authenticatedSession()) } as any} apiClient={apiClient as any} localStore={localStore as any} turnstileSiteKey="test" />);

    expect(await screen.findByRole("textbox", { name: "笔记标题" })).toBeInTheDocument();
    await waitFor(() => expect(localStore.listDrafts).toHaveBeenCalledWith("ws-1"));
    await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/notes", method: "POST" })));
    fireEvent.click(screen.getByRole("button", { name: "创建内容" }));
    fireEvent.click(screen.getByRole("button", { name: "新建笔记" }));

    expect(screen.getByRole("dialog", { name: "创建内容" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("未能开始新建笔记"));
    serverCreate.resolve({ note: { ...existingNote, id: "server-created", title: "", content: "" } });
  });

  it("keeps the App create center pending and prevents a second draft request", async () => {
    const saveDraft = deferred<void>();
    const localStore = memoryDraftStore(saveDraft.promise);
    render(<App authClient={{ session: vi.fn(async () => authenticatedSession()) } as any} apiClient={appApiClient() as any} localStore={localStore as any} turnstileSiteKey="test" />);

    fireEvent.click(await screen.findByRole("button", { name: "创建内容" }));
    fireEvent.click(screen.getByRole("button", { name: "新建笔记" }));
    await waitFor(() => expect(localStore.saveDraft).toHaveBeenCalledOnce());

    const pending = screen.getByRole("button", { name: "新建笔记，处理中" });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(localStore.saveDraft).toHaveBeenCalledOnce();

    saveDraft.resolve();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "创建内容" })).not.toBeInTheDocument());
    expect(await screen.findByRole("textbox", { name: "笔记标题" })).toBeInTheDocument();
  });

  it("keeps the App create center open and exposes a safe error after draft creation fails", async () => {
    const saveDraft = deferred<void>();
    const localStore = memoryDraftStore(saveDraft.promise);
    render(<App authClient={{ session: vi.fn(async () => authenticatedSession()) } as any} apiClient={appApiClient() as any} localStore={localStore as any} turnstileSiteKey="test" />);

    fireEvent.click(await screen.findByRole("button", { name: "创建内容" }));
    fireEvent.click(screen.getByRole("button", { name: "新建笔记" }));
    await waitFor(() => expect(localStore.saveDraft).toHaveBeenCalledOnce());

    saveDraft.reject(new Error("storage unavailable"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "创建内容" })).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("本地草稿保存失败");
    expect(screen.getAllByRole("alert").some((alert) => alert.textContent?.includes("本地草稿保存失败"))).toBe(true);
  });

  it("opens personal profile from the feature map after visiting workspace settings", async () => {
    render(<App authClient={{ session: vi.fn(async () => authenticatedSession()) } as any} apiClient={appApiClient() as any} turnstileSiteKey="test" />);

    fireEvent.click(await screen.findByRole("button", { name: "账户" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "工作区" }));
    expect(await screen.findByRole("tab", { name: "工作区" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "打开功能地图" }));
    fireEvent.click(screen.getByRole("button", { name: "打开个人中心" }));

    expect(screen.getByRole("tab", { name: "个人资料" })).toHaveAttribute("aria-selected", "true");
  });

  it("inerts the complete workspace background while the portal dialog is open", async () => {
    render(<App authClient={{ session: vi.fn(async () => authenticatedSession()) } as any} apiClient={appApiClient() as any} localStore={memoryDraftStore() as any} turnstileSiteKey="test" />);
    const trigger = await screen.findByRole("button", { name: "创建内容" });
    fireEvent(window, new CustomEvent("nexus:service-worker-update", { detail: { activate: vi.fn() } }));
    const updateBanner = await screen.findByText("新版本已准备好。");
    fireEvent.click(trigger);

    const background = screen.getByTestId("workspace-modal-background");
    expect(background).toHaveAttribute("inert");
    expect(background).toContainElement(document.querySelector(".adaptive-workbench"));
    expect(background).toContainElement(updateBanner.closest(".update-banner"));
    expect(background).not.toContainElement(screen.getByRole("dialog", { name: "创建内容" }));

    fireEvent.click(screen.getByRole("button", { name: "关闭创建内容" }));
    await waitFor(() => expect(background).not.toHaveAttribute("inert"));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("isolates quick capture from the workspace and sibling create dialog", async () => {
    render(<App authClient={{ session: vi.fn(async () => authenticatedSession()) } as any} apiClient={appApiClient() as any} turnstileSiteKey="test" />);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(await screen.findByRole("button", { name: "快速捕获" }));
    const quickDialog = await screen.findByRole("dialog", { name: "快速捕获" });
    const background = screen.getByTestId("workspace-modal-background");
    expect(background).toHaveAttribute("inert");
    expect(background).toHaveAttribute("aria-hidden", "true");
    expect(quickDialog).not.toHaveAttribute("inert");
    const backgroundCreateTrigger = background.querySelector('button[aria-label="创建内容"]');
    expect(backgroundCreateTrigger).not.toBeNull();
    expect(backgroundCreateTrigger?.closest(".workspace-modal-background")).toBe(background);
    expect(backgroundCreateTrigger?.closest("[inert]")).not.toBeNull();
    expect(screen.queryByRole("dialog", { name: "创建内容" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "快速捕获" })).toBeInTheDocument();
  });
});
