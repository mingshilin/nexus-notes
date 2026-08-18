import { toast } from "sonner";
import {
  archiveNote,
  clearTrash,
  createNote,
  deleteNote,
  deleteNotePermanent,
  restoreNote,
  unarchiveNote,
  updateNote,
} from "@/api/notes";
import { getErrorMessage } from "@/lib/errorMessages";
import type { NoteTemplate } from "@/lib/noteTemplates";
import type { MutationRunner } from "@/hooks/useMutationRunner";
import type { LibraryView } from "@/store/useAppStore";
import type { NoteWithTags } from "@/types/note";
import type { AuthUser } from "@/types/auth";

interface NoteMutationParams {
  user: AuthUser | null;
  libraryView: LibraryView;
  isWorkspaceReadonly: boolean;
  selectedFolderId: string | null;
  selectedDatabaseId: string | null;
  selectedNoteBase: NoteWithTags | null;
  titleDraft: string;
  contentDraft: string;
  moveFolderValue: string | null;
  deletingNoteId: string | null;
  permanentDeleteMode: boolean;
  batchSelectedIds: string[];
  listNotes: NoteWithTags[];
  allKnownNotes: Map<string, NoteWithTags>;
  pageSize: number;
  total: number;
  saveTimerRef: React.MutableRefObject<number | undefined>;
  assertCanWrite: () => void;
  runMutation: MutationRunner;
  refreshDataSilently: (reason: string, lightweight?: boolean, debounceMs?: number) => void;
  loadData: (options?: { silent?: boolean; reason?: string; lightweight?: boolean }) => Promise<void>;
  selectLocalNote: (note: NoteWithTags) => void;
  selectNote: (id: string) => Promise<void>;
  reconcileVisibleNote: (note: NoteWithTags) => void;
  reconcileVisibleNotesBulk: (notes: NoteWithTags[]) => void;
  upsertNote: (note: NoteWithTags) => void;
  removeNote: (id: string) => void;
  closeTab: (id: string) => void;
  setSaveStatus: (status: "idle" | "saving" | "saved" | "failed", error?: string | null) => void;
  setLibraryView: (view: LibraryView) => void;
  setTitleAutoFocus: (value: boolean) => void;
  setDeleteDialog: (open: boolean, noteId?: string | null) => void;
  setPermanentDeleteMode: (value: boolean) => void;
  setBatchSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  setBatchMode: React.Dispatch<React.SetStateAction<boolean>>;
  setMoveFolderOpen: (value: boolean) => void;
  setMoveFolderLoading: (value: boolean) => void;
  setPagination: (payload: { page: number; pageSize: number; total: number }) => void;
  setTrashNotes: (notes: NoteWithTags[]) => void;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  handler: (item: T) => Promise<void>,
) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) break;
      await handler(item);
    }
  });
  await Promise.all(workers);
}

export function useNoteMutations(params: NoteMutationParams) {
  const {
    user,
    libraryView,
    isWorkspaceReadonly,
    selectedFolderId,
    selectedDatabaseId,
    selectedNoteBase,
    titleDraft,
    contentDraft,
    moveFolderValue,
    deletingNoteId,
    permanentDeleteMode,
    batchSelectedIds,
    listNotes,
    allKnownNotes,
    pageSize,
    total,
    saveTimerRef,
    assertCanWrite,
    runMutation,
    refreshDataSilently,
    loadData,
    selectLocalNote,
    selectNote,
    reconcileVisibleNote,
    reconcileVisibleNotesBulk,
    upsertNote,
    removeNote,
    closeTab,
    setSaveStatus,
    setLibraryView,
    setTitleAutoFocus,
    setDeleteDialog,
    setPermanentDeleteMode,
    setBatchSelectedIds,
    setBatchMode,
    setMoveFolderOpen,
    setMoveFolderLoading,
    setPagination,
    setTrashNotes,
  } = params;

  async function persistNote(id: string, title: string, content: string) {
    if (!user || libraryView === "trash") return;
    setSaveStatus("saving");
    try {
      const updated = await updateNote(id, { title, content });
      upsertNote(updated);
      setSaveStatus("saved");
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => setSaveStatus("idle"), 1200);
    } catch (error) {
      setSaveStatus("failed", getErrorMessage(error, "保存失败"));
    }
  }

  function queueAutosave(nextTitle: string, nextContent: string) {
    if (!selectedNoteBase || libraryView === "trash" || isWorkspaceReadonly) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      persistNote(selectedNoteBase.id, nextTitle, nextContent).catch(() => undefined);
    }, 700);
  }

  async function handleSaveNow() {
    if (!selectedNoteBase || libraryView === "trash" || isWorkspaceReadonly) return;
    window.clearTimeout(saveTimerRef.current);
    await persistNote(selectedNoteBase.id, titleDraft, contentDraft);
  }

  async function handleCreateNote(template: NoteTemplate | null) {
    return runMutation("note:create", async () => {
      assertCanWrite();
      const startedAt = performance.now();
      const now = new Date().toISOString();
      const tempId = `temp-${crypto.randomUUID()}`;
      const optimistic: NoteWithTags = {
        id: tempId,
        folder_id: libraryView === "folder" ? selectedFolderId : null,
        database_id: libraryView === "database" ? selectedDatabaseId : null,
        title: template ? template.title : "无标题笔记",
        content: template ? template.content : "",
        is_favorite: false,
        is_pinned: false,
        is_daily: false,
        daily_date: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        archived_at: null,
        last_opened_at: now,
        tags: [],
        folder: null,
      };
      upsertNote(optimistic);
      setLibraryView(libraryView === "trash" ? "all" : libraryView);
      setTitleAutoFocus(true);
      selectLocalNote(optimistic);
      try {
        const created = await createNote({
          title: template ? template.title : "",
          content: template ? template.content : "",
          folder_id: libraryView === "folder" ? selectedFolderId : null,
          database_id: libraryView === "database" ? selectedDatabaseId : null,
        });
        removeNote(tempId);
        closeTab(tempId);
        upsertNote(created);
        await selectNote(created.id);
      } catch (error) {
        removeNote(tempId);
        closeTab(tempId);
        throw error;
      }
      if (import.meta.env.DEV) {
        console.debug("[create-note] local-update-ms", Math.round(performance.now() - startedAt));
      }
      refreshDataSilently("create-note", true, 700);
    });
  }

  async function handleBatchDelete() {
    return runMutation("note:batch-delete", async () => {
      assertCanWrite();
      if (batchSelectedIds.length === 0) return;
      const permanent = libraryView === "trash";
      const ids = [...batchSelectedIds];
      const cachedNotes = ids
        .map((id) => allKnownNotes.get(id))
        .filter((note): note is NoteWithTags => Boolean(note));
      try {
        const startedAt = performance.now();
        for (const id of ids) removeNote(id);
        if (!permanent) {
          const deletedAt = new Date().toISOString();
          for (const cached of cachedNotes) {
            upsertNote({
              ...cached,
              deleted_at: deletedAt,
              updated_at: deletedAt,
            });
          }
        }
        await runWithConcurrency(ids, 4, async (id) => {
          if (permanent) {
            await deleteNotePermanent(id);
          } else {
            await deleteNote(id);
          }
        });
        setBatchSelectedIds([]);
        setBatchMode(false);
        toast.success(permanent ? "已批量永久删除" : "已批量移入回收站");
        if (import.meta.env.DEV) {
          console.debug("[batch-delete] completed", { count: ids.length, ms: Math.round(performance.now() - startedAt) });
        }
        refreshDataSilently("batch-delete");
      } catch (error) {
        await loadData({ silent: true, reason: "batch-delete-rollback", lightweight: false }).catch(() => {
          for (const cached of cachedNotes) upsertNote(cached);
        });
        toast.error(getErrorMessage(error, permanent ? "批量永久删除失败" : "批量删除失败"));
      }
    }, { showErrorToast: false });
  }

  async function handleBatchArchive() {
    assertCanWrite();
    if (batchSelectedIds.length === 0) return;
    try {
      const ids = [...batchSelectedIds];
      const startedAt = performance.now();
      const updatedNotes: NoteWithTags[] = [];
      await runWithConcurrency(ids, 4, async (id) => {
        const updated = await archiveNote(id);
        updatedNotes.push(updated);
      });
      reconcileVisibleNotesBulk(updatedNotes);
      setBatchSelectedIds([]);
      setBatchMode(false);
      toast.success("已批量归档");
      if (import.meta.env.DEV) {
        console.debug("[batch-archive] completed", { count: ids.length, ms: Math.round(performance.now() - startedAt) });
      }
      refreshDataSilently("batch-archive");
    } catch (error) {
      toast.error(getErrorMessage(error, "批量归档失败"));
    }
  }

  async function handleBatchPin() {
    assertCanWrite();
    if (batchSelectedIds.length === 0) return;
    const selectedNotes = listNotes.filter((note) => batchSelectedIds.includes(note.id));
    const nextPinned = !selectedNotes.every((note) => note.is_pinned);
    try {
      const startedAt = performance.now();
      const updatedNotes: NoteWithTags[] = [];
      await runWithConcurrency(selectedNotes, 4, async (note) => {
        const updated = await updateNote(note.id, { is_pinned: nextPinned });
        updatedNotes.push(updated);
      });
      reconcileVisibleNotesBulk(updatedNotes);
      setBatchSelectedIds([]);
      setBatchMode(false);
      toast.success(nextPinned ? "已批量置顶" : "已批量取消置顶");
      if (import.meta.env.DEV) {
        console.debug("[batch-pin] completed", { count: selectedNotes.length, ms: Math.round(performance.now() - startedAt) });
      }
      refreshDataSilently("batch-pin");
    } catch (error) {
      toast.error(getErrorMessage(error, "批量置顶失败"));
    }
  }

  async function handleBatchMoveFolder(folderId: string | null) {
    assertCanWrite();
    if (batchSelectedIds.length === 0) return;
    const selectedNotes = listNotes.filter((note) => batchSelectedIds.includes(note.id));
    try {
      const startedAt = performance.now();
      const updatedNotes: NoteWithTags[] = [];
      await runWithConcurrency(selectedNotes, 4, async (note) => {
        const updated = await updateNote(note.id, { folder_id: folderId });
        updatedNotes.push(updated);
      });
      reconcileVisibleNotesBulk(updatedNotes);
      setBatchSelectedIds([]);
      setBatchMode(false);
      toast.success(folderId ? "已批量移动到文件夹" : "已批量移回 Inbox");
      if (import.meta.env.DEV) {
        console.debug("[batch-move-folder] completed", { count: selectedNotes.length, ms: Math.round(performance.now() - startedAt) });
      }
      refreshDataSilently("batch-move-folder");
    } catch (error) {
      toast.error(getErrorMessage(error, "批量移动文件夹失败"));
    }
  }

  async function handleDuplicateCurrent() {
    assertCanWrite();
    if (!selectedNoteBase) return;
    const created = await createNote({
      title: `${selectedNoteBase.title || "无标题笔记"} 副本`,
      content: selectedNoteBase.content,
      folder_id: selectedNoteBase.folder_id,
      is_favorite: selectedNoteBase.is_favorite,
    });
    upsertNote(created);
    await selectNote(created.id);
    toast.success("已复制为新笔记");
    refreshDataSilently("duplicate-note");
  }

  async function handleDeleteConfirm() {
    const targetId = deletingNoteId ?? selectedNoteBase?.id;
    if (!targetId) return;
    let cached: NoteWithTags | null = null;
    return runMutation(`note:delete:${targetId}`, async () => {
      assertCanWrite();
      const startedAt = performance.now();
      cached = allKnownNotes.get(targetId) ?? null;
      setDeleteDialog(false);
      setPermanentDeleteMode(false);
      removeNote(targetId);
      if (!permanentDeleteMode && cached) {
        const deletedAt = new Date().toISOString();
        upsertNote({
          ...cached,
          deleted_at: deletedAt,
          updated_at: deletedAt,
        });
      }
      try {
        if (permanentDeleteMode) {
          await deleteNotePermanent(targetId);
          toast.success("已永久删除");
        } else {
          await deleteNote(targetId);
          toast.success("已移入回收站");
        }
      } catch (error) {
        if (cached) upsertNote(cached);
        throw error;
      }
      if (import.meta.env.DEV) {
        console.debug("[delete-note] local-update-ms", Math.round(performance.now() - startedAt));
      }
      refreshDataSilently("delete-confirm", true, 700);
    }, {
      errorMessage: permanentDeleteMode ? "永久删除失败" : "删除失败",
      rollback: () => {
        if (cached) upsertNote(cached);
      },
    });
  }

  async function handleConfirmMoveFolder() {
    assertCanWrite();
    if (!selectedNoteBase) return;
    setMoveFolderLoading(true);
    try {
      const updated = await updateNote(selectedNoteBase.id, { folder_id: moveFolderValue });
      upsertNote(updated);
      setMoveFolderOpen(false);
      toast.success(moveFolderValue ? "已移动到文件夹" : "已移回 Inbox");
      refreshDataSilently("move-folder");
    } catch (error) {
      toast.error(getErrorMessage(error, "移动文件夹失败"));
    } finally {
      setMoveFolderLoading(false);
    }
  }

  async function handleRestoreCurrent() {
    assertCanWrite();
    if (!selectedNoteBase) return;
    const restored = await restoreNote(selectedNoteBase.id);
    reconcileVisibleNote(restored);
    setLibraryView("all");
    await selectNote(restored.id);
    refreshDataSilently("restore-note");
  }

  async function handleTogglePinned() {
    assertCanWrite();
    if (!selectedNoteBase || libraryView === "trash") return;
    const updated = await updateNote(selectedNoteBase.id, {
      is_pinned: !selectedNoteBase.is_pinned,
      title: titleDraft,
      content: contentDraft,
    });
    reconcileVisibleNote(updated);
    toast.success(updated.is_pinned ? "已置顶" : "已取消置顶");
    refreshDataSilently("toggle-pinned");
  }

  async function handleToggleFavorite() {
    assertCanWrite();
    if (!selectedNoteBase || libraryView === "trash") return;
    const updated = await updateNote(selectedNoteBase.id, {
      is_favorite: !selectedNoteBase.is_favorite,
      title: titleDraft,
      content: contentDraft,
    });
    reconcileVisibleNote(updated);
    toast.success(updated.is_favorite ? "已收藏" : "已取消收藏");
    refreshDataSilently("toggle-favorite");
  }

  async function handleArchiveToggle() {
    assertCanWrite();
    if (!selectedNoteBase || libraryView === "trash") return;
    const updated = selectedNoteBase.archived_at ? await unarchiveNote(selectedNoteBase.id) : await archiveNote(selectedNoteBase.id);
    reconcileVisibleNote(updated);
    toast.success(updated.archived_at ? "已归档" : "已恢复到笔记列表");
    refreshDataSilently("toggle-archive");
  }

  async function handleAssignFolder(folderId: string | null) {
    assertCanWrite();
    if (!selectedNoteBase || libraryView === "trash") return;
    const updated = await updateNote(selectedNoteBase.id, { folder_id: folderId });
    reconcileVisibleNote(updated);
    refreshDataSilently("assign-folder");
  }

  async function handleEmptyTrash() {
    await clearTrash();
    setTrashNotes([]);
    if (libraryView === "trash") setPagination({ page: 1, pageSize, total: 0 });
    refreshDataSilently("empty-trash");
  }

  return {
    persistNote,
    queueAutosave,
    handleSaveNow,
    handleCreateNote,
    handleBatchDelete,
    handleBatchArchive,
    handleBatchPin,
    handleBatchMoveFolder,
    handleDuplicateCurrent,
    handleDeleteConfirm,
    handleConfirmMoveFolder,
    handleRestoreCurrent,
    handleTogglePinned,
    handleToggleFavorite,
    handleArchiveToggle,
    handleAssignFolder,
    handleEmptyTrash,
  };
}
