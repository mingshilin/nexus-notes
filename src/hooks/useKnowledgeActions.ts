import { useState } from "react";
import { toast } from "sonner";
import {
  createReminder,
  deleteReminder,
  toggleReminderComplete,
  updateReminder,
} from "@/api/reminders";
import {
  createNote,
  ensureTodayDailyNote,
  getNotes,
  updateNote,
  uploadNoteAttachment,
} from "@/api/notes";
import { getErrorMessage } from "@/lib/errorMessages";
import type { MutationRunner } from "@/hooks/useMutationRunner";
import type { LibraryView } from "@/store/useAppStore";
import type {
  CreateReminderPayload,
  NoteWithTags,
  Reminder,
  UpdateReminderPayload,
} from "@/types/note";

type QuickCapturePayload = {
  target: "inbox" | "daily" | "database";
  databaseId?: string | null;
  title: string;
  content: string;
};

interface KnowledgeActionsParams {
  reminders: Reminder[];
  selectedNoteBase: NoteWithTags | null;
  activeDailyDate: string;
  libraryView: LibraryView;
  selectedFolderId: string | null;
  pageSize: number;
  total: number;
  assertCanWrite: () => void;
  runMutation: MutationRunner;
  setReminders: (reminders: Reminder[]) => void;
  setHasDueReminders: (value: boolean) => void;
  setActiveDailyDate: (value: string) => void;
  setLibraryView: (view: LibraryView) => void;
  setPagination: (payload: { page: number; pageSize: number; total: number }) => void;
  setAccountMenuOpen: (value: boolean) => void;
  setMobileInspectorOpen: (value: boolean) => void;
  setMobilePrimaryPane: (value: "list" | "main") => void;
  setSearchQuery: (value: string) => void;
  setSelectedFolderId: (id: string | null) => void;
  setSelectedDatabaseId: (id: string | null) => void;
  setSelectedTagId: (id: string | null) => void;
  setFavoriteOnly: (value: boolean) => void;
  markMobileNavigation: () => void;
  upsertNote: (note: NoteWithTags) => void;
  selectNote: (id: string) => Promise<void>;
  refreshDataSilently: (reason: string, lightweight?: boolean, debounceMs?: number) => void;
}

export function hasDueReminder(list: Reminder[]) {
  return list.some((item) => !item.completed_at && new Date(item.due_at).getTime() <= Date.now());
}

function readFileText(file: File) {
  if (typeof file.text === "function") return file.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

export function useKnowledgeActions(params: KnowledgeActionsParams) {
  const {
    reminders,
    selectedNoteBase,
    activeDailyDate,
    libraryView,
    selectedFolderId,
  pageSize,
  total,
  assertCanWrite,
  runMutation,
    setReminders,
    setHasDueReminders,
    setActiveDailyDate,
    setLibraryView,
    setPagination,
    setAccountMenuOpen,
    setMobileInspectorOpen,
    setMobilePrimaryPane,
    setSearchQuery,
    setSelectedFolderId,
    setSelectedDatabaseId,
    setSelectedTagId,
    setFavoriteOnly,
    markMobileNavigation,
    upsertNote,
    selectNote,
    refreshDataSilently,
  } = params;

  const [quickReminderOpen, setQuickReminderOpen] = useState(false);
  const [quickReminderSaving, setQuickReminderSaving] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);

  function applyReminderList(nextReminders: Reminder[]) {
    setReminders(nextReminders);
    setHasDueReminders(hasDueReminder(nextReminders));
  }

  function navigateToListView(
    view: Exclude<LibraryView, "graph" | "knowledge" | "reminders">,
    options: { folderId?: string | null; tagId?: string | null; favoriteOnly?: boolean; databaseId?: string | null } = {},
  ) {
    setSearchQuery("");
    setSelectedFolderId(options.folderId ?? null);
    setSelectedDatabaseId(options.databaseId ?? null);
    setSelectedTagId(options.tagId ?? null);
    setFavoriteOnly(options.favoriteOnly ?? false);
    setPagination({ page: 1, pageSize, total });
    setAccountMenuOpen(false);
    setMobileInspectorOpen(false);
    setMobilePrimaryPane("list");
    setLibraryView(view);
    markMobileNavigation();
  }

  async function handleDailyNote() {
    assertCanWrite();
    const startedAt = performance.now();
    const daily = await ensureTodayDailyNote();
    upsertNote(daily);
    setActiveDailyDate(daily.daily_date ?? activeDailyDate);
    setLibraryView("daily");
    await selectNote(daily.id);
    if (import.meta.env.DEV) {
      console.debug("[daily-note] local-update-ms", Math.round(performance.now() - startedAt));
    }
    refreshDataSilently("daily-note", true, 420);
  }

  async function handleOpenOrCreateDailyNote(date: string) {
    return runMutation(`daily-note:${date}`, async () => {
      assertCanWrite();
      setActiveDailyDate(date);
      const existingResp = await getNotes({ page: 1, pageSize: 1, daily: true, dailyDate: date });
      const existing = existingResp.data[0];
      if (existing) {
        upsertNote(existing);
        setLibraryView("daily");
        await selectNote(existing.id);
        return;
      }

      const created = await createNote({
        title: `${date} 每日笔记`,
        content: `# ${date}\n\n## 今日重点\n- \n\n## 时间线\n- \n\n## 回顾\n- `,
        is_daily: true,
        daily_date: date,
      });
      upsertNote(created);
      setLibraryView("daily");
      await selectNote(created.id);
      refreshDataSilently("daily-date-create", true, 420);
    });
  }

  async function handleQuickCapture(payload: QuickCapturePayload) {
    assertCanWrite();
    if (payload.target === "daily") {
      const daily = await ensureTodayDailyNote();
      const nextContent = [daily.content, `## ${payload.title}`, payload.content].filter(Boolean).join("\n\n");
      const updated = await updateNote(daily.id, { content: nextContent });
      upsertNote(updated);
      setLibraryView("daily");
      setActiveDailyDate(updated.daily_date ?? activeDailyDate);
      await selectNote(updated.id);
      refreshDataSilently("quick-capture-daily", true, 420);
      return;
    }

    const created = await createNote({
      title: payload.title,
      content: payload.content,
      is_favorite: false,
      folder_id: null,
      database_id: payload.target === "database" ? payload.databaseId ?? null : null,
      is_daily: false,
      daily_date: null,
    });
    upsertNote(created);
    if (payload.target === "database" && payload.databaseId) {
      navigateToListView("database", { databaseId: payload.databaseId });
    } else {
      setLibraryView("inbox");
    }
    await selectNote(created.id);
    refreshDataSilently("quick-capture", true, 420);
  }

  async function handleCreateQuickReminder(payload: { title: string; description: string; due_at: string }) {
    assertCanWrite();
    if (!selectedNoteBase) return;
    setQuickReminderSaving(true);
    try {
      const created = await createReminder({
        note_id: selectedNoteBase.id,
        title: payload.title,
        description: payload.description,
        due_at: payload.due_at,
      });
      const nextReminders = [created, ...reminders];
      applyReminderList(nextReminders);
      setQuickReminderOpen(false);
      toast.success("提醒已创建");
    } catch (error) {
      toast.error(getErrorMessage(error, "提醒创建失败"));
    } finally {
      setQuickReminderSaving(false);
    }
  }

  async function handleCreateReminder(payload: CreateReminderPayload) {
    assertCanWrite();
    const created = await createReminder(payload);
    const nextReminders = [created, ...reminders];
    applyReminderList(nextReminders);
    toast.success("提醒已创建");
  }

  async function handleToggleReminderComplete(id: string) {
    assertCanWrite();
    const updated = await toggleReminderComplete(id);
    const nextReminders = reminders.map((item) => (item.id === id ? updated : item));
    applyReminderList(nextReminders);
    toast.success(updated.completed_at ? "提醒已完成" : "提醒已恢复");
  }

  async function handleUpdateReminder(id: string, payload: UpdateReminderPayload) {
    assertCanWrite();
    const updated = await updateReminder(id, payload);
    const nextReminders = reminders.map((item) => (item.id === id ? updated : item));
    applyReminderList(nextReminders);
    toast.success("提醒已更新");
  }

  async function handleDeleteReminder(id: string) {
    assertCanWrite();
    await deleteReminder(id);
    const nextReminders = reminders.filter((item) => item.id !== id);
    applyReminderList(nextReminders);
    toast.success("提醒已删除");
  }

  async function handleUploadAttachmentToNote(file: File) {
    assertCanWrite();
    if (!selectedNoteBase) throw new Error("请先选择笔记");
    const uploaded = await uploadNoteAttachment(selectedNoteBase.id, file);
    toast.success(file.type === "application/pdf" ? "PDF 已上传" : "图片已上传");
    return uploaded.markdown_url;
  }

  async function handleImportMarkdown(files: FileList | null) {
    assertCanWrite();
    if (!files || files.length === 0) return;
    const markdownFiles = Array.from(files).filter((file) => file.name.toLowerCase().endsWith(".md"));
    if (markdownFiles.length !== files.length) toast.error("仅支持导入 .md 文件");
    for (const file of markdownFiles) {
      const created = await createNote({
        title: file.name.replace(/\.md$/i, ""),
        content: await readFileText(file),
        folder_id: libraryView === "folder" ? selectedFolderId : null,
      });
      upsertNote(created);
      await selectNote(created.id);
    }
    if (markdownFiles.length > 0) {
      toast.success(`已导入 ${markdownFiles.length} 篇 Markdown`);
      refreshDataSilently("import-markdown");
    }
  }

  return {
    quickReminderOpen,
    quickReminderSaving,
    quickCaptureOpen,
    setQuickReminderOpen,
    setQuickCaptureOpen,
    handleDailyNote,
    handleOpenOrCreateDailyNote,
    handleQuickCapture,
    handleCreateQuickReminder,
    handleCreateReminder,
    handleToggleReminderComplete,
    handleUpdateReminder,
    handleDeleteReminder,
    handleUploadAttachmentToNote,
    handleImportMarkdown,
  };
}
