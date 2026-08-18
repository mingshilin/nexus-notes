import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clipperCapture, createSavedSearch, listAttachmentCenter, runAttachmentOcr, syncOfflineDraft } from "@/api/knowledge";
import { updateNote, updateNoteTags } from "@/api/notes";
import { KnowledgeCenterPage } from "@/components/knowledge/KnowledgeCenterPage";
import type { Database } from "@/types/database";
import type { NoteWithTags, Reminder } from "@/types/note";
import type { WorkspaceMember } from "@/types/workspace";

const apiState = {
  notifications: [
    {
      id: "n1",
      workspace_id: "ws1",
      user_id: "u1",
      type: "mention",
      title: "被提及",
      body: "请查看",
      entity_type: "note",
      entity_id: "note-1",
      read_at: null,
      created_at: "2026-05-19T00:00:00.000Z",
    },
  ],
  comments: [] as unknown[],
  attachments: [
    {
      id: "a1",
      note_id: "note-1",
      workspace_id: "ws1",
      uploader_id: "u1",
      storage_key: "attachments/ws1/note-1/a1.pdf",
      file_name: "brief.pdf",
      mime_type: "application/pdf",
      size: 2048,
      created_at: "2026-05-19T00:00:00.000Z",
      ocr_text: "OCR text",
      ocr_status: "ready",
      ocr_updated_at: "2026-05-19T00:00:00.000Z",
      note_title: "Launch plan",
    },
  ],
  diagnostics: {
    orphan_notes: [],
    duplicate_titles: [],
    unorganized_notes: [] as Array<{ id: string; title: string; updated_at: string }>,
  },
  offlineDrafts: [] as unknown[],
};

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock("@/api/databases", () => ({
  getDatabaseFieldPermissions: vi.fn(() => Promise.resolve({ viewer_roles: ["owner", "editor", "viewer"], editor_roles: ["owner", "editor"] })),
  getDatabasePermissions: vi.fn(() => Promise.resolve([])),
  getDatabaseProperties: vi.fn(() => Promise.resolve([{ id: "prop-status", name: "Status", type: "single_select" }])),
  updateDatabaseFieldPermissions: vi.fn(() => Promise.resolve({ viewer_roles: ["owner"], editor_roles: ["owner"] })),
  updateDatabasePermissions: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/api/knowledge", () => ({
  listActivity: vi.fn(() => Promise.resolve([])),
  listAudit: vi.fn(() => Promise.resolve([])),
  listNotifications: vi.fn(() => Promise.resolve(apiState.notifications)),
  markNotificationRead: vi.fn(() => Promise.resolve([])),
  markAllNotificationsRead: vi.fn(() => {
    apiState.notifications = apiState.notifications.map((item) => ({ ...item, read_at: "2026-05-19T00:00:00.000Z" }));
    return Promise.resolve(apiState.notifications);
  }),
  listSavedSearches: vi.fn(() => Promise.resolve([
    { id: "s1", workspace_id: "ws1", name: "Launch notes", query: "Launch", filters: {}, created_by_user_id: "u1", created_at: "x", updated_at: "x" },
  ])),
  createSavedSearch: vi.fn(() => Promise.resolve([])),
  deleteSavedSearch: vi.fn(() => Promise.resolve([])),
  getKnowledgeDiagnostics: vi.fn(() => Promise.resolve(apiState.diagnostics)),
  listAttachmentCenter: vi.fn(() => Promise.resolve(apiState.attachments)),
  listImportJobs: vi.fn(() => Promise.resolve([])),
  listOfflineDrafts: vi.fn(() => Promise.resolve(apiState.offlineDrafts)),
  getCalendarFeed: vi.fn(() => Promise.resolve({ reminders: [], daily: [], database_dates: [] })),
  listComments: vi.fn(() => Promise.resolve(apiState.comments)),
  createComment: vi.fn((payload) => {
    apiState.comments = [{
      id: "c1",
      workspace_id: "ws1",
      note_id: payload.note_id,
      database_id: null,
      body: payload.body,
      mentions: payload.mentions,
      created_by_user_id: "u1",
      resolved_at: null,
      created_at: "2026-05-19T00:00:00.000Z",
      updated_at: "2026-05-19T00:00:00.000Z",
    }];
    return Promise.resolve(apiState.comments);
  }),
  clipperCapture: vi.fn(() => Promise.resolve({
    id: "clip-1",
    folder_id: null,
    database_id: null,
    title: "Captured",
    content: "Clip",
    is_favorite: false,
    is_pinned: false,
    is_daily: false,
    daily_date: null,
    created_at: "2026-05-19T00:00:00.000Z",
    updated_at: "2026-05-19T00:00:00.000Z",
    deleted_at: null,
    archived_at: null,
    last_opened_at: null,
    tags: [],
    folder: null,
  })),
  importMarkdownItems: vi.fn(),
  runAttachmentOcr: vi.fn((id: string, payload: { status?: string; text?: string; error?: string }) => {
    const current = apiState.attachments.find((item) => item.id === id) ?? apiState.attachments[0];
    const updated = {
      ...current,
      ocr_status: payload.status ?? current.ocr_status,
      ocr_text: payload.text ?? payload.error ?? current.ocr_text,
    };
    apiState.attachments = apiState.attachments.map((item) => item.id === id ? updated : item);
    return Promise.resolve(updated);
  }),
  saveOfflineDraft: vi.fn(),
  syncOfflineDraft: vi.fn(() => Promise.resolve({
    id: "synced-note",
    folder_id: null,
    database_id: null,
    title: "Synced draft",
    content: "Synced",
    is_favorite: false,
    is_pinned: false,
    is_daily: false,
    daily_date: null,
    created_at: "2026-05-19T00:00:00.000Z",
    updated_at: "2026-05-19T00:00:00.000Z",
    deleted_at: null,
    archived_at: null,
    last_opened_at: null,
    tags: [],
    folder: null,
  })),
}));

vi.mock("@/lib/ocrEngine", () => ({
  recognizeAttachment: vi.fn(() => Promise.resolve("recognized text")),
}));

vi.mock("@/api/notes", () => ({
  updateNote: vi.fn((id: string, payload: { folder_id?: string | null; database_id?: string | null }) => Promise.resolve({
    id,
    folder_id: payload.folder_id ?? null,
    database_id: payload.database_id ?? null,
    title: "Launch plan",
    content: "Updated",
    is_favorite: false,
    is_pinned: false,
    is_daily: false,
    daily_date: null,
    created_at: "2026-05-19T00:00:00.000Z",
    updated_at: "2026-05-19T00:00:00.000Z",
    deleted_at: null,
    archived_at: null,
    last_opened_at: null,
    tags: [],
    folder: null,
  })),
  updateNoteTags: vi.fn((id: string, payload: { tagIds: string[] }) => Promise.resolve({
    id,
    folder_id: null,
    database_id: null,
    title: "Launch plan",
    content: "Tagged",
    is_favorite: false,
    is_pinned: false,
    is_daily: false,
    daily_date: null,
    created_at: "2026-05-19T00:00:00.000Z",
    updated_at: "2026-05-19T00:00:00.000Z",
    deleted_at: null,
    archived_at: null,
    last_opened_at: null,
    tags: payload.tagIds.map((tagId) => ({ id: tagId, name: tagId, color: "#0ea5e9", created_at: "x", updated_at: "x" })),
    folder: null,
  })),
  deleteNoteAttachment: vi.fn((noteId: string, attachmentId: string) => {
    apiState.attachments = apiState.attachments.filter((item) => item.id !== attachmentId || item.note_id !== noteId);
    return Promise.resolve({ ok: true });
  }),
}));

const notes: NoteWithTags[] = [
  {
    id: "note-1",
    folder_id: null,
    database_id: null,
    title: "Launch plan",
    content: "Ship the knowledge center",
    is_favorite: false,
    is_pinned: false,
    is_daily: false,
    daily_date: null,
    created_at: "2026-05-19T00:00:00.000Z",
    updated_at: "2026-05-19T00:00:00.000Z",
    deleted_at: null,
    archived_at: null,
    last_opened_at: null,
    tags: [],
    folder: null,
  },
];

const reminders: Reminder[] = [];
const databases: Database[] = [
  {
    id: "db1",
    workspace_id: "ws1",
    name: "Projects",
    description: null,
    icon: "DB",
    created_by_user_id: "u1",
    board_property_id: null,
    calendar_property_id: null,
    created_at: "x",
    updated_at: "x",
  },
];

const members: WorkspaceMember[] = [
  {
    id: "m1",
    workspace_id: "ws1",
    user_id: "u2",
    role: "editor",
    created_at: "x",
    updated_at: "x",
    email: "teammate@example.com",
    display_name: "Teammate",
    avatar_url: null,
  },
];

function renderPage(overrides: Partial<React.ComponentProps<typeof KnowledgeCenterPage>> = {}) {
  const props = {
    notes,
    reminders,
    databases,
    selectedNoteId: "note-1",
    workspaceMembers: members,
    readOnly: false,
    onOpenNote: vi.fn(),
    onNoteCreated: vi.fn(),
    onApplySavedSearch: vi.fn(),
    ...overrides,
  };
  render(<KnowledgeCenterPage {...props} />);
  return props;
}

afterEach(() => {
  apiState.notifications = apiState.notifications.map((item) => ({ ...item, read_at: null }));
  apiState.comments = [];
  apiState.attachments = [
    {
      id: "a1",
      note_id: "note-1",
      workspace_id: "ws1",
      uploader_id: "u1",
      storage_key: "attachments/ws1/note-1/a1.pdf",
      file_name: "brief.pdf",
      mime_type: "application/pdf",
      size: 2048,
      created_at: "2026-05-19T00:00:00.000Z",
      ocr_text: "OCR text",
      ocr_status: "ready",
      ocr_updated_at: "2026-05-19T00:00:00.000Z",
      note_title: "Launch plan",
    },
  ];
  apiState.diagnostics = { orphan_notes: [], duplicate_titles: [], unorganized_notes: [] };
  apiState.offlineDrafts = [];
  window.localStorage.removeItem("nexus-notes:ignored-orphan-notes");
  vi.clearAllMocks();
  cleanup();
});

describe("KnowledgeCenterPage", () => {
  it("applies a saved search and shows local results", async () => {
    apiState.attachments = [{
      ...apiState.attachments[0],
      file_name: "Launch.pdf",
      ocr_text: "Launch OCR text",
    }];
    const props = renderPage({
      notes: [{
        ...notes[0],
        content: "Launch body content",
        tags: [{ id: "tag-launch", name: "Launch", color: "#0ea5e9", created_at: "x", updated_at: "x" }],
        database_values: {
          "prop-status": { property_id: "prop-status", type: "single_select", value_text: "Launch ready" },
        },
      }],
    });

    fireEvent.click(await screen.findByRole("button", { name: /智能视图/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Launch notes/ }));

    expect(props.onApplySavedSearch).toHaveBeenCalledWith("Launch", {});
    expect(await screen.findByText("当前结果：Launch")).toBeInTheDocument();
    expect(screen.getAllByText((_, node) => node?.textContent === "Launch plan").length).toBeGreaterThan(0);
    expect(screen.getByText("命中：标题")).toBeInTheDocument();
    expect(screen.getByText("命中：正文")).toBeInTheDocument();
    expect(screen.getByText("命中：标签")).toBeInTheDocument();
    expect(screen.getByText("命中：数据库属性")).toBeInTheDocument();
    expect(screen.getByText("命中：附件名")).toBeInTheDocument();
    expect(screen.getByText("命中：OCR 文本")).toBeInTheDocument();
  });

  it("saves query and complete smart-view filters", async () => {
    renderPage({
      notes: [{
        ...notes[0],
        folder_id: "folder-1",
        database_id: "db1",
        tags: [{ id: "tag-1", name: "Planning", color: "#0ea5e9", created_at: "x", updated_at: "x" }],
        folder: { id: "folder-1", name: "Roadmap", created_at: "x", updated_at: "x" },
      }],
    });

    fireEvent.click(await screen.findByRole("button", { name: /智能视图/ }));
    fireEvent.change(screen.getByPlaceholderText("视图名称"), { target: { value: "Filtered launch" } });
    fireEvent.change(screen.getByPlaceholderText("搜索关键词"), { target: { value: "Launch" } });
    fireEvent.click(screen.getByRole("button", { name: "Planning" }));
    fireEvent.click(screen.getByRole("button", { name: "Roadmap" }));
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    fireEvent.click(screen.getByRole("button", { name: "Teammate" }));
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "已完成" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(createSavedSearch).toHaveBeenCalledWith(expect.objectContaining({
        name: "Filtered launch",
        query: "Launch",
        filters: expect.objectContaining({
          query: "Launch",
          sourceTypes: ["notes", "attachments", "ocr"],
          tagIds: ["tag-1"],
          folderIds: ["folder-1"],
          databaseIds: ["db1"],
          memberIds: ["u2"],
          attachmentTypes: ["pdf"],
          attachmentStatus: ["ready"],
        }),
      }));
    });
  });

  it("bulk classifies unorganized notes into a folder", async () => {
    apiState.diagnostics = {
      orphan_notes: [],
      duplicate_titles: [],
      unorganized_notes: [{ id: "note-1", title: "Launch plan", updated_at: "2026-05-19T00:00:00.000Z" }],
    };
    const props = renderPage({
      notes: [{
        ...notes[0],
        folder: { id: "folder-1", name: "Roadmap", created_at: "x", updated_at: "x" },
      }],
    });

    fireEvent.click(await screen.findByRole("button", { name: /智能视图/ }));
    fireEvent.change(screen.getByDisplayValue("收集箱"), { target: { value: "folder" } });
    fireEvent.change(screen.getByDisplayValue("选择文件夹"), { target: { value: "folder-1" } });
    fireEvent.click(screen.getByRole("button", { name: "批量归类 1" }));

    await waitFor(() => {
      expect(updateNote).toHaveBeenCalledWith("note-1", { folder_id: "folder-1", database_id: null });
      expect(props.onNoteCreated).toHaveBeenCalled();
    });
  });

  it("bulk tags and ignores orphan notes", async () => {
    apiState.diagnostics = {
      orphan_notes: [{ id: "note-1", title: "Launch plan", updated_at: "2026-05-19T00:00:00.000Z" }],
      duplicate_titles: [],
      unorganized_notes: [],
    };
    const props = renderPage({
      notes: [{
        ...notes[0],
        tags: [{ id: "tag-1", name: "Planning", color: "#0ea5e9", created_at: "x", updated_at: "x" }],
      }],
    });

    fireEvent.click(await screen.findByRole("button", { name: /智能视图/ }));
    fireEvent.change(screen.getByDisplayValue("选择标签"), { target: { value: "tag-1" } });
    fireEvent.click(screen.getByRole("button", { name: "批量加标签 1" }));

    await waitFor(() => {
      expect(updateNoteTags).toHaveBeenCalledWith("note-1", { tagIds: ["tag-1"] });
      expect(props.onNoteCreated).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "标记忽略" }));
    expect((await screen.findAllByText("暂无。")).length).toBeGreaterThan(0);
  });

  it("merges duplicate titles into the primary note without deleting originals", async () => {
    const duplicateNotes: NoteWithTags[] = [
      { ...notes[0], id: "note-1", title: "Launch plan", content: "Primary body", tags: [{ id: "tag-1", name: "Planning", color: "#0ea5e9", created_at: "x", updated_at: "x" }] },
      { ...notes[0], id: "note-2", title: "Launch plan", content: "Secondary body", tags: [{ id: "tag-2", name: "Archive", color: "#f97316", created_at: "x", updated_at: "x" }] },
    ];
    const props = renderPage({ notes: duplicateNotes });

    fireEvent.click(await screen.findByRole("button", { name: /智能视图/ }));
    fireEvent.click(await screen.findByRole("button", { name: "合并" }));

    await waitFor(() => {
      expect(updateNote).toHaveBeenCalledWith("note-1", expect.objectContaining({
        content: expect.stringContaining("Secondary body"),
      }));
      expect(updateNoteTags).toHaveBeenCalledWith("note-1", { tagIds: ["tag-1", "tag-2"] });
      expect(props.onOpenNote).toHaveBeenCalledWith("note-1");
    });
    expect(updateNote).not.toHaveBeenCalledWith("note-2", expect.anything());
  });

  it("marks all notifications as read", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /协作安全/ }));
    fireEvent.click(await screen.findByRole("button", { name: "全部已读" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "全部已读" })).not.toBeInTheDocument();
    });
  });

  it("creates a comment with selected member mention", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /协作安全/ }));
    fireEvent.change(screen.getByPlaceholderText("写评论；可在下方选择要通知的成员"), { target: { value: "请处理" } });
    fireEvent.click(screen.getByRole("button", { name: "@Teammate" }));
    fireEvent.click(screen.getByRole("button", { name: "发布评论" }));

    expect(await screen.findByText("请处理")).toBeInTheDocument();
  });

  it("deletes an attachment after confirmation", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /附件 OCR/ }));
    expect(await screen.findByText("brief.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(screen.queryByText("brief.pdf")).not.toBeInTheDocument();
    });
  });

  it("filters attachments by query, type, OCR status, note, and date range", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /附件 OCR/ }));
    fireEvent.change(screen.getByPlaceholderText("按文件名、OCR、笔记标题搜索"), { target: { value: "brief" } });
    fireEvent.change(screen.getByDisplayValue("全部类型"), { target: { value: "pdf" } });
    fireEvent.change(screen.getByDisplayValue("全部状态"), { target: { value: "ready" } });
    fireEvent.change(screen.getByDisplayValue("全部笔记"), { target: { value: "note-1" } });
    fireEvent.change(screen.getByLabelText("附件起始日期"), { target: { value: "2026-05-01" } });
    fireEvent.change(screen.getByLabelText("附件结束日期"), { target: { value: "2026-05-20" } });
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));

    await waitFor(() => {
      expect(listAttachmentCenter).toHaveBeenLastCalledWith({
        query: "brief",
        type: "pdf",
        status: "ready",
        noteId: "note-1",
        from: "2026-05-01",
        to: "2026-05-20",
      });
    });
  });

  it("shows OCR failure reason and retries failed attachments in bulk", async () => {
    apiState.attachments = [{
      ...apiState.attachments[0],
      ocr_status: "failed",
      ocr_text: "bad image",
    }];
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /附件 OCR/ }));
    expect(await screen.findByText("失败原因：bad image")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "批量重试失败项 1" }));

    await waitFor(() => {
      expect(runAttachmentOcr).toHaveBeenCalledWith("a1", { status: "processing" });
      expect(runAttachmentOcr).toHaveBeenCalledWith("a1", { status: "ready", text: "recognized text" });
    });
  });

  it("generates a clipper bookmarklet and opens captured results", async () => {
    const props = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /捕获导入/ }));
    expect(await screen.findByText("书签脚本")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制书签脚本" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("网页标题"), { target: { value: "Captured page" } });
    fireEvent.change(screen.getByPlaceholderText("URL"), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "保存捕获" }));

    await waitFor(() => {
      expect(clipperCapture).toHaveBeenCalledWith(expect.objectContaining({
        title: "Captured page",
        url: "https://example.com",
        target: "inbox",
      }));
      expect(props.onOpenNote).toHaveBeenCalledWith("clip-1");
    });
  });

  it("surfaces offline draft conflicts and opens the target note", async () => {
    apiState.offlineDrafts = [{
      id: "draft-1",
      workspace_id: "ws1",
      user_id: "u1",
      note_id: "note-1",
      title: "Local changes",
      content: "Draft body",
      status: "pending",
      created_at: "2026-05-19T00:00:00.000Z",
      updated_at: "2026-05-19T00:00:00.000Z",
      synced_at: null,
    }];
    vi.mocked(syncOfflineDraft).mockRejectedValueOnce(new Error("target note changed"));
    const props = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /捕获导入/ }));
    fireEvent.click(await screen.findByRole("button", { name: "同步并打开" }));

    expect(await screen.findByText("同步冲突")).toBeInTheDocument();
    expect(screen.getByText("目标笔记在草稿保存后已更新，请先打开笔记确认后再同步。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开目标笔记" }));

    expect(props.onOpenNote).toHaveBeenCalledWith("note-1");
  });
});
