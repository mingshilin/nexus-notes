import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasDueReminder, useKnowledgeActions } from "@/hooks/useKnowledgeActions";
import type { NoteWithTags, Reminder } from "@/types/note";

const notesApi = vi.hoisted(() => ({
  createNote: vi.fn(),
  ensureTodayDailyNote: vi.fn(),
  getNotes: vi.fn(),
  updateNote: vi.fn(),
  uploadNoteAttachment: vi.fn(),
}));

const remindersApi = vi.hoisted(() => ({
  createReminder: vi.fn(),
  deleteReminder: vi.fn(),
  toggleReminderComplete: vi.fn(),
  updateReminder: vi.fn(),
}));

vi.mock("@/api/notes", () => notesApi);
vi.mock("@/api/reminders", () => remindersApi);
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function makeNote(overrides: Partial<NoteWithTags> = {}): NoteWithTags {
  return {
    id: overrides.id ?? "note-1",
    folder_id: overrides.folder_id ?? null,
    database_id: overrides.database_id,
    title: overrides.title ?? "Alpha",
    content: overrides.content ?? "Body",
    is_favorite: overrides.is_favorite ?? false,
    is_pinned: overrides.is_pinned ?? false,
    is_daily: overrides.is_daily ?? false,
    daily_date: overrides.daily_date ?? null,
    created_at: overrides.created_at ?? "2026-05-19T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-05-20T00:00:00.000Z",
    deleted_at: overrides.deleted_at ?? null,
    archived_at: overrides.archived_at ?? null,
    last_opened_at: overrides.last_opened_at ?? null,
    tags: overrides.tags ?? [],
    folder: overrides.folder ?? null,
    database_values: overrides.database_values,
  };
}

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: overrides.id ?? "reminder-1",
    user_id: overrides.user_id ?? "u1",
    workspace_id: overrides.workspace_id ?? "ws-1",
    note_id: overrides.note_id ?? "note-1",
    note_title: overrides.note_title ?? "Alpha",
    title: overrides.title ?? "Follow up",
    description: overrides.description ?? "",
    due_at: overrides.due_at ?? "2026-05-20T00:00:00.000Z",
    completed_at: overrides.completed_at ?? null,
    notified_at: overrides.notified_at ?? null,
    created_at: overrides.created_at ?? "2026-05-19T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-05-20T00:00:00.000Z",
  };
}

function makeParams(overrides: Partial<Parameters<typeof useKnowledgeActions>[0]> = {}) {
  const selectedNoteBase = makeNote();
  return {
    reminders: [],
    selectedNoteBase,
    activeDailyDate: "2026-05-20",
    libraryView: "all" as const,
    selectedFolderId: null,
    pageSize: 30,
    total: 1,
    assertCanWrite: vi.fn(),
    runMutation: vi.fn(async (_key: string, task: () => Promise<unknown>) => task()),
    setReminders: vi.fn(),
    setHasDueReminders: vi.fn(),
    setActiveDailyDate: vi.fn(),
    setLibraryView: vi.fn(),
    setPagination: vi.fn(),
    setAccountMenuOpen: vi.fn(),
    setMobileInspectorOpen: vi.fn(),
    setMobilePrimaryPane: vi.fn(),
    setSearchQuery: vi.fn(),
    setSelectedFolderId: vi.fn(),
    setSelectedDatabaseId: vi.fn(),
    setSelectedTagId: vi.fn(),
    setFavoriteOnly: vi.fn(),
    markMobileNavigation: vi.fn(),
    upsertNote: vi.fn(),
    selectNote: vi.fn(),
    refreshDataSilently: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useKnowledgeActions", () => {
  it("appends quick capture content to today's daily note", async () => {
    const daily = makeNote({ id: "daily-1", content: "# Today", is_daily: true, daily_date: "2026-05-20" });
    const updated = makeNote({ id: "daily-1", content: "# Today\n\n## Idea\n\nDetails", is_daily: true, daily_date: "2026-05-20" });
    notesApi.ensureTodayDailyNote.mockResolvedValue(daily);
    notesApi.updateNote.mockResolvedValue(updated);
    const params = makeParams();

    const { result } = renderHook(() => useKnowledgeActions(params));
    await act(async () => {
      await result.current.handleQuickCapture({ target: "daily", title: "Idea", content: "Details" });
    });

    expect(notesApi.updateNote).toHaveBeenCalledWith("daily-1", { content: "# Today\n\n## Idea\n\nDetails" });
    expect(params.upsertNote).toHaveBeenCalledWith(updated);
    expect(params.setLibraryView).toHaveBeenCalledWith("daily");
    expect(params.selectNote).toHaveBeenCalledWith("daily-1");
    expect(params.refreshDataSilently).toHaveBeenCalledWith("quick-capture-daily", true, 420);
  });

  it("creates database quick captures and navigates to that database", async () => {
    const created = makeNote({ id: "created-1", database_id: "db-1", title: "Record" });
    notesApi.createNote.mockResolvedValue(created);
    const params = makeParams();

    const { result } = renderHook(() => useKnowledgeActions(params));
    await act(async () => {
      await result.current.handleQuickCapture({ target: "database", databaseId: "db-1", title: "Record", content: "Body" });
    });

    expect(notesApi.createNote).toHaveBeenCalledWith(expect.objectContaining({ title: "Record", content: "Body", database_id: "db-1" }));
    expect(params.setSelectedDatabaseId).toHaveBeenCalledWith("db-1");
    expect(params.setLibraryView).toHaveBeenCalledWith("database");
    expect(params.markMobileNavigation).toHaveBeenCalled();
    expect(params.selectNote).toHaveBeenCalledWith("created-1");
  });

  it("keeps reminder due state in sync after toggles", async () => {
    const open = makeReminder({ id: "r1", due_at: "2026-05-19T00:00:00.000Z" });
    const completed = makeReminder({ id: "r1", due_at: open.due_at, completed_at: "2026-05-20T00:00:00.000Z" });
    remindersApi.toggleReminderComplete.mockResolvedValue(completed);
    const params = makeParams({ reminders: [open] });

    const { result } = renderHook(() => useKnowledgeActions(params));
    await act(async () => {
      await result.current.handleToggleReminderComplete("r1");
    });

    expect(remindersApi.toggleReminderComplete).toHaveBeenCalledWith("r1");
    expect(params.setReminders).toHaveBeenCalledWith([completed]);
    expect(params.setHasDueReminders).toHaveBeenCalledWith(false);
  });

  it("imports only markdown files into the current folder", async () => {
    const created = makeNote({ id: "imported-1", title: "one" });
    notesApi.createNote.mockResolvedValue(created);
    const params = makeParams({ libraryView: "folder", selectedFolderId: "folder-1" });
    const markdown = new File(["# Hello"], "one.md", { type: "text/markdown" });
    const ignored = new File(["nope"], "two.txt", { type: "text/plain" });
    const files = {
      length: 2,
      item: (index: number) => [markdown, ignored][index] ?? null,
      0: markdown,
      1: ignored,
      [Symbol.iterator]: function* () {
        yield markdown;
        yield ignored;
      },
    } as unknown as FileList;

    const { result } = renderHook(() => useKnowledgeActions(params));
    await act(async () => {
      await result.current.handleImportMarkdown(files);
    });

    expect(notesApi.createNote).toHaveBeenCalledWith({ title: "one", content: "# Hello", folder_id: "folder-1" });
    expect(params.upsertNote).toHaveBeenCalledWith(created);
    expect(params.selectNote).toHaveBeenCalledWith("imported-1");
    expect(params.refreshDataSilently).toHaveBeenCalledWith("import-markdown");
  });

  it("detects only open overdue reminders as due", () => {
    expect(hasDueReminder([makeReminder({ due_at: "2026-05-19T00:00:00.000Z" })])).toBe(true);
    expect(hasDueReminder([makeReminder({ due_at: "2026-05-19T00:00:00.000Z", completed_at: "2026-05-20T00:00:00.000Z" })])).toBe(false);
  });
});
