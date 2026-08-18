import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { ApiClientError } from "@/api/client";
import {
  forgotPasswordWithTurnstile,
  getCurrentUser,
  login,
  logout,
  register,
  resendVerificationCode,
  resetPassword,
  verifyEmailCode,
} from "@/api/auth";
import { downloadAll, downloadNote, downloadNoteMarkdown, type AllExportFormat } from "@/api/export";
import { createFolder, deleteFolder, getFolders, updateFolder } from "@/api/folders";
import { getProfile, updateProfile, uploadAvatar } from "@/api/profile";
import { getDueReminders, getReminders } from "@/api/reminders";
import {
  getGraph,
  getLocalGraph,
  getNoteBacklinks,
  getNoteLinks,
  getNoteVersions,
  getRecentNotes,
  getTrashedNotes,
  openOrCreateWikiLink,
  restoreNoteVersion,
  updateNote,
  updateNoteTags,
} from "@/api/notes";
import { createTag, getTags } from "@/api/tags";
import {
  acceptWorkspaceInvite,
  createWorkspace as createWorkspaceApi,
  getWorkspaceMembers,
  getWorkspaces,
  inviteWorkspaceMember,
  switchWorkspace as switchWorkspaceApi,
} from "@/api/workspaces";
import { BrandMark } from "@/components/branding/BrandMark";
import { DatabasePage } from "@/components/database/DatabasePage";
import { EditorHeader } from "@/components/editor/EditorHeader";
import { NoteEditor } from "@/components/editor/NoteEditor";
import { LazyMarkdownPreview, preloadMarkdownPreview } from "@/components/editor/markdownPreviewLoader";
import { PageErrorBoundary } from "@/components/error/AppErrorBoundary";
import { AppShell } from "@/components/layout/AppShell";
import { RightPanel } from "@/components/layout/RightPanel";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopTabs } from "@/components/layout/TopTabs";
import { EmptyState } from "@/components/notes/EmptyState";
import { NoteListPanel } from "@/components/notes/NoteListPanel";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuthBootstrap } from "@/hooks/useAuthBootstrap";
import { useDatabaseData } from "@/hooks/useDatabaseData";
import { useDatabaseMutations } from "@/hooks/useDatabaseMutations";
import { hasDueReminder, useKnowledgeActions } from "@/hooks/useKnowledgeActions";
import { useMutationRunner } from "@/hooks/useMutationRunner";
import { useNoteMutations } from "@/hooks/useNoteMutations";
import { useNotesData } from "@/hooks/useNotesData";
import { useShareFlow } from "@/hooks/useShareFlow";
import { useTheme } from "@/hooks/useTheme";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { extractOutline } from "@/lib/markdown";
import { buildNoteDeepLink, copyTextToClipboard } from "@/lib/share";
import { noteTemplates } from "@/lib/noteTemplates";
import { getErrorMessage } from "@/lib/errorMessages";
import { decodeEscapedUnicode } from "@/lib/utils";
import { useAppStore, type LibraryView } from "@/store/useAppStore";
import type { GraphData, NoteLink, NoteWithTags } from "@/types/note";
import type { Workspace, WorkspaceInviteResult, WorkspaceMember } from "@/types/workspace";

const emptyGraph: GraphData = { nodes: [], edges: [] };
const AuthPanel = lazy(() => import("@/components/auth/AuthPanel").then((mod) => ({ default: mod.AuthPanel })));
const GraphPage = lazy(() => import("@/components/graph/GraphPage").then((mod) => ({ default: mod.GraphPage })));
const KnowledgeCenterPage = lazy(() => import("@/components/knowledge/KnowledgeCenterPage").then((mod) => ({ default: mod.KnowledgeCenterPage })));
const ReminderCenterPage = lazy(() => import("@/components/notes/ReminderCenterPage").then((mod) => ({ default: mod.ReminderCenterPage })));
const HistoryDialog = lazy(() => import("@/components/ui/HistoryDialog").then((mod) => ({ default: mod.HistoryDialog })));
const SettingsDialog = lazy(() => import("@/components/ui/SettingsDialog").then((mod) => ({ default: mod.SettingsDialog })));
const ShareDialog = lazy(() => import("@/components/ui/ShareDialog").then((mod) => ({ default: mod.ShareDialog })));
const TemplatePickerDialog = lazy(() => import("@/components/ui/TemplatePickerDialog").then((mod) => ({ default: mod.TemplatePickerDialog })));
const DeleteConfirmDialog = lazy(() => import("@/components/notes/DeleteConfirmDialog").then((mod) => ({ default: mod.DeleteConfirmDialog })));
const FolderDialog = lazy(() => import("@/components/ui/FolderDialog").then((mod) => ({ default: mod.FolderDialog })));
const MoveFolderDialog = lazy(() => import("@/components/ui/MoveFolderDialog").then((mod) => ({ default: mod.MoveFolderDialog })));
const ReminderQuickDialog = lazy(() => import("@/components/ui/ReminderQuickDialog").then((mod) => ({ default: mod.ReminderQuickDialog })));
const QuickCaptureDialog = lazy(() => import("@/components/ui/QuickCaptureDialog").then((mod) => ({ default: mod.QuickCaptureDialog })));
const ShortcutsDialog = lazy(() => import("@/components/ui/ShortcutsDialog").then((mod) => ({ default: mod.ShortcutsDialog })));
let idlePrefetchScheduled = false;
let commandPalettePromise: Promise<{ default: typeof import("@/components/ui/CommandPalette").CommandPalette }> | null = null;

function loadCommandPalette() {
  if (!commandPalettePromise) {
    commandPalettePromise = import("@/components/ui/CommandPalette")
      .then((mod) => ({ default: mod.CommandPalette }))
      .catch((error) => {
        commandPalettePromise = null;
        throw error;
      });
  }

  return commandPalettePromise;
}

function preloadCommandPalette() {
  return loadCommandPalette().then(() => undefined);
}

const CommandPalette = lazy(loadCommandPalette);

function SharedPreviewFallback() {
  return (
    <div className="mx-auto max-w-[760px] px-6 py-8 md:px-10 lg:py-12">
      <div className="space-y-4 rounded-[24px] border border-border/70 bg-white/50 p-6 dark:bg-white/[0.03]">
        <div className="h-5 w-32 animate-pulse rounded-full bg-muted/70" />
        <div className="h-9 w-1/2 animate-pulse rounded-xl bg-muted/60" />
        <div className="space-y-3 pt-2">
          <div className="h-4 w-full animate-pulse rounded-full bg-muted/50" />
          <div className="h-4 w-[88%] animate-pulse rounded-full bg-muted/50" />
          <div className="h-4 w-[74%] animate-pulse rounded-full bg-muted/50" />
        </div>
        <p className="pt-1 text-sm text-muted-foreground">正在加载分享内容...</p>
      </div>
    </div>
  );
}

function CommandPaletteFallback() {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/28 px-3 pt-[10vh] backdrop-blur-sm">
      <div className="mac-glass w-full max-w-3xl rounded-[24px] border border-border/70 bg-white/90 p-4 dark:bg-[#16181d]/95">
        <div className="space-y-3">
          <div className="h-11 animate-pulse rounded-[14px] bg-muted/55" />
          <div className="space-y-2 px-1">
            <div className="h-10 animate-pulse rounded-[14px] bg-muted/45" />
            <div className="h-10 animate-pulse rounded-[14px] bg-muted/35" />
            <div className="h-10 animate-pulse rounded-[14px] bg-muted/25" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  useTheme();

  const {
    user,
    notes,
    trashNotes,
    recentNotes,
    tags,
    folders,
    versions,
    profile,
    reminders,
    hasDueReminders,
    selectedNoteId,
    searchQuery,
    recentSearches,
    favoriteOnly,
    selectedTagId,
    selectedFolderId,
    selectedDatabaseId,
    saveStatus,
    saveError,
    theme,
    editorMode,
    mobilePrimaryPane,
    mobileInspectorOpen,
    isDeleteDialogOpen,
    deletingNoteId,
    libraryView,
    commandOpen,
    shortcutsOpen,
    openedTabs,
    rightPanelTab,
    inspectorMode,
    focusMode,
    accountMenuOpen,
    noteListView,
    noteSort,
    databaseViewPreferences,
    page,
    pageSize,
    total,
    pendingMutations,
    setUser,
    setNotes,
    setTrashNotes,
    setRecentNotes,
    upsertNote,
    removeNote,
    setTags,
    upsertTag,
    setFolders,
    upsertFolder,
    removeFolder,
    setVersions,
    setProfile,
    setReminders,
    setHasDueReminders,
    setSelectedNoteId,
    setSearchQuery,
    pushRecentSearch,
    setFavoriteOnly,
    setSelectedTagId,
    setSelectedFolderId,
    setSelectedDatabaseId,
    setSaveStatus,
    setTheme,
    setEditorMode,
    setMobilePrimaryPane,
    setMobileInspectorOpen,
    setDeleteDialog,
    setLibraryView,
    setCommandOpen,
    setShortcutsOpen,
    setPagination,
    openTab,
    closeTab,
    setRightPanelTab,
    setInspectorMode,
    setFocusMode,
    setAccountMenuOpen,
    setNoteListView,
    setNoteSort,
    setDatabaseViewPreference,
    setPendingMutation,
    resetUserScopedState,
  } = useAppStore();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [contentDraft, setContentDraft] = useState("");
  const [titleAutoFocus, setTitleAutoFocus] = useState(false);
  const [permanentDeleteMode, setPermanentDeleteMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tagName, setTagName] = useState("");
  const [tagLoading, setTagLoading] = useState(false);
  const [links, setLinks] = useState<NoteLink[]>([]);
  const [backlinks, setBacklinks] = useState<NoteLink[]>([]);
  const [graph, setGraph] = useState<GraphData>(emptyGraph);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDialogMode, setFolderDialogMode] = useState<"create" | "rename">("create");
  const [folderDialogValue, setFolderDialogValue] = useState("");
  const [folderDialogLoading, setFolderDialogLoading] = useState(false);
  const [folderDialogError, setFolderDialogError] = useState<string | null>(null);
  const [folderTarget, setFolderTarget] = useState<{ id: string; name: string } | null>(null);
  const [folderDeleteOpen, setFolderDeleteOpen] = useState(false);
  const [folderDeleteLoading, setFolderDeleteLoading] = useState(false);
  const [noteDeleteLoading, setNoteDeleteLoading] = useState(false);
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);
  const [emptyTrashLoading, setEmptyTrashLoading] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templatePickerMode, setTemplatePickerMode] = useState<"create" | "apply">("create");
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(noteTemplates[0]?.id ?? null);
  const [templateApplying, setTemplateApplying] = useState(false);
  const [moveFolderOpen, setMoveFolderOpen] = useState(false);
  const [moveFolderValue, setMoveFolderValue] = useState<string | null>(null);
  const [moveFolderLoading, setMoveFolderLoading] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyRestoring, setHistoryRestoring] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  const [databaseDialogOpen, setDatabaseDialogOpen] = useState(false);
  const [databaseName, setDatabaseName] = useState("");
  const [databaseDescription, setDatabaseDescription] = useState("");
  const [databaseIcon, setDatabaseIcon] = useState("");
  const [databaseInitialStatus, setDatabaseInitialStatus] = useState(true);
  const [databaseInitialDate, setDatabaseInitialDate] = useState(true);
  const [databaseDeleteOpen, setDatabaseDeleteOpen] = useState(false);
  const [databaseDeleteLoading, setDatabaseDeleteLoading] = useState(false);
  const [reminderDeleteTargetId, setReminderDeleteTargetId] = useState<string | null>(null);
  const [reminderDeleteLoading, setReminderDeleteLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [mobileNavigationVersion, setMobileNavigationVersion] = useState(0);
  const [insertRequest, setInsertRequest] = useState<{ id: number; text: string } | null>(null);
  const [wikiConfirmOpen, setWikiConfirmOpen] = useState(false);
  const [pendingWikiTitle, setPendingWikiTitle] = useState<string | null>(null);
  const [activeDailyDate, setActiveDailyDate] = useState(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const silentRefreshTimerRef = useRef<number | undefined>(undefined);
  const dueReminderIdsRef = useRef<Set<string>>(new Set());
  const insertSeqRef = useRef(0);

  const allKnownNotes = useMemo(() => {
    const map = new Map<string, NoteWithTags>();
    for (const note of [...notes, ...recentNotes, ...trashNotes]) map.set(note.id, note);
    return map;
  }, [notes, recentNotes, trashNotes]);

  const selectedNoteBase = selectedNoteId ? allKnownNotes.get(selectedNoteId) ?? null : null;
  const selectedNote = selectedNoteBase ? { ...selectedNoteBase, title: titleDraft, content: contentDraft } : null;
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 260);
  const currentWorkspaceId = user?.current_workspace?.id ?? null;
  const currentWorkspaceRole = user?.current_workspace?.role ?? "owner";
  const {
    databases,
    setDatabases,
    databaseProperties,
    setDatabaseProperties,
    databaseTemplates,
    setDatabaseTemplates,
    databaseDuplicateGroups,
    setDatabaseDuplicateGroups,
    currentDatabase,
    currentDatabasePreference,
    databaseView,
    clearDatabaseData,
    loadDatabaseList,
    loadSelectedDatabaseChrome,
  } = useDatabaseData({
    user,
    selectedDatabaseId,
    databaseViewPreferences,
    setDatabaseViewPreference,
  });
  const isWorkspaceReadonly = currentWorkspaceRole === "viewer";
  const outline = useMemo(() => extractOutline(contentDraft), [contentDraft]);
  const favoriteCount = notes.filter((note) => note.is_favorite).length;
  const pinnedCount = notes.filter((note) => note.is_pinned).length;
  const reminderDeleteTarget = reminderDeleteTargetId
    ? reminders.find((reminder) => reminder.id === reminderDeleteTargetId) ?? null
    : null;
  const charCount = contentDraft.length;
  const wordCount = contentDraft.trim() ? contentDraft.trim().split(/\s+/).length : 0;
  const readMinutes = Math.max(1, Math.ceil(charCount / 500));

  const {
    authLoading,
    resetToken,
    setResetToken,
    pendingInviteToken,
    setPendingInviteToken,
    pendingNoteId,
    setPendingNoteId,
    pendingInvitePreview,
  } = useAuthBootstrap({ user, setUser, handleSignedOut });

  const {
    shareDialogNoteId,
    shareDialogNote,
    publicShareSummary,
    pendingPublicShareToken,
    publicSharedNote,
    publicSharedNoteError,
    publicSharePassword,
    setPublicSharePassword,
    openShareDialog,
    closeShareDialog,
    handleCreatePublicShare,
    handleRevokePublicShare,
  } = useShareFlow({ user, allKnownNotes });

  const { runMutation } = useMutationRunner({ pendingMutations, setPendingMutation });

  function assertCanWrite() {
    if (!isWorkspaceReadonly) return;
    throw new Error("当前工作区为只读权限，无法修改内容");
  }

  function clearTransientState() {
    setTitleDraft("");
    setContentDraft("");
    setLinks([]);
    setBacklinks([]);
    setGraph(emptyGraph);
    setTagName("");
    setTagLoading(false);
    setSettingsOpen(false);
    setFolderDialogOpen(false);
    setFolderDialogMode("create");
    setFolderDialogValue("");
    setFolderDialogLoading(false);
    setFolderDialogError(null);
    setFolderTarget(null);
    setFolderDeleteOpen(false);
    setFolderDeleteLoading(false);
    setNoteDeleteLoading(false);
    setEmptyTrashOpen(false);
    setEmptyTrashLoading(false);
    setTemplatePickerOpen(false);
    setTemplatePickerMode("create");
    setActiveTemplateId(noteTemplates[0]?.id ?? null);
    setTemplateApplying(false);
    setMoveFolderOpen(false);
    setMoveFolderValue(null);
    setMoveFolderLoading(false);
    setHistoryDialogOpen(false);
    setHistoryRestoring(false);
    setMobileInspectorOpen(false);
    setAccountMenuOpen(false);
    clearDatabaseData();
    setDatabaseDialogOpen(false);
    setDatabaseDeleteOpen(false);
    setDatabaseDeleteLoading(false);
    setReminderDeleteTargetId(null);
    setReminderDeleteLoading(false);
    setDatabaseName("");
    setDatabaseDescription("");
    setDatabaseIcon("");
    setWorkspaces([]);
    setWorkspaceMembers([]);
    closeShareDialog();
    setInsertRequest(null);
    setWikiConfirmOpen(false);
    setPendingWikiTitle(null);
  }

  function requestInsertSnippet(snippet: string) {
    insertSeqRef.current += 1;
    setInsertRequest({ id: insertSeqRef.current, text: snippet });
  }

  function handleSignedOut(message?: string) {
    clearTransientState();
    resetUserScopedState();
    if (message) toast.error(message);
  }

  function markMobileNavigation() {
    setMobileNavigationVersion((value) => value + 1);
  }

  const {
    listNotes,
    selectLocalNote,
    selectNote,
    reconcileVisibleNote,
    reconcileVisibleNotesBulk,
    loadVisibleNotes,
  } = useNotesData({
    user,
    notes,
    trashNotes,
    recentNotes,
    allKnownNotes,
    selectedNoteId,
    pendingNoteId,
    page,
    pageSize,
    searchQuery,
    debouncedSearchQuery,
    selectedTagId,
    favoriteOnly,
    libraryView,
    selectedFolderId,
    selectedDatabaseId,
    activeDailyDate,
    noteSort,
    setNotes,
    setTrashNotes,
    setRecentNotes,
    upsertNote,
    setPagination,
    setSelectedNoteId,
    openTab,
    setTitleDraft,
    setContentDraft,
    setMoveFolderValue,
    setMobilePrimaryPane,
    setMobileInspectorOpen,
    setAccountMenuOpen,
    setLoading,
    setLoadError,
  });

  const {
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
  } = useKnowledgeActions({
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
  });

  const {
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
  } = useNoteMutations({
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
  });

  const {
    handleCreateDatabase,
    handleCreateDatabaseNote,
    handleDeleteCurrentDatabase,
    handleUpdateDatabaseInfo,
    handleCreateDatabaseProperty,
    handleUpdateDatabaseProperty,
    handleDeleteDatabaseProperty,
    handleCreateSavedDatabaseView,
    handleUpdateSavedDatabaseView,
    handleDeleteSavedDatabaseView,
    handleExportCurrentDatabaseCsv,
    handleImportCurrentDatabaseCsv,
    handleCreateCurrentDatabaseTemplate,
    handleUpdateCurrentDatabaseTemplate,
    handleDeleteCurrentDatabaseTemplate,
    handleBatchCurrentDatabaseNotes,
    handleUpdateDatabaseFields,
    handleUpdateNoteDatabaseValue,
    handleUpdateNoteDatabaseMembershipValue,
    handleUpdateNoteTitleInDatabase,
  } = useDatabaseMutations({
    databases,
    notes,
    selectedDatabaseId,
    currentDatabase,
    currentDatabasePreference,
    databaseName,
    databaseDescription,
    databaseIcon,
    databaseInitialStatus,
    databaseInitialDate,
    assertCanWrite,
    setDatabases,
    setDatabaseProperties,
    setDatabaseTemplates,
    setDatabaseDuplicateGroups,
    setDatabaseDialogOpen,
    setSelectedDatabaseId,
    setLibraryView,
    setNotes,
    upsertNote,
    selectNote,
    refreshDataSilently,
    navigateToListView,
    loadSelectedDatabaseChrome,
    setDatabaseViewPreference,
  });

  async function loadWorkspaceChrome(options: { includeDueReminders?: boolean; includeGraph?: boolean; reason?: string } = {}) {
    if (!user) return;
    const includeDueReminders = Boolean(options.includeDueReminders);
    const includeGraph = Boolean(options.includeGraph);
    const workspaceId = user.current_workspace?.id;
    const [tagResp, folderResp, trashResp, recentResp, graphResp, profileResp, remindersResp, dueRemindersResp, databaseResp, workspaceResp, membersResp] = await Promise.all([
      getTags().catch(() => null),
      getFolders().catch(() => null),
      getTrashedNotes({ page: 1, pageSize: 30 }).catch(() => null),
      getRecentNotes().catch(() => null),
      includeGraph || libraryView === "graph" ? getGraph().catch(() => emptyGraph) : Promise.resolve(null),
      getProfile().catch(() => null),
      getReminders(true).catch(() => []),
      includeDueReminders ? getDueReminders().catch(() => []) : Promise.resolve([]),
      loadDatabaseList().catch(() => []),
      getWorkspaces().catch(() => []),
      workspaceId ? getWorkspaceMembers(workspaceId).catch(() => []) : Promise.resolve([]),
    ]);

    if (tagResp) setTags(tagResp);
    if (folderResp) setFolders(folderResp);
    if (trashResp) setTrashNotes(trashResp.data);
    if (recentResp) setRecentNotes(recentResp.data);
    if (graphResp) setGraph(graphResp);
    setProfile(profileResp);
    setReminders(remindersResp);
    setDatabases(databaseResp);
    setWorkspaces(workspaceResp);
    setWorkspaceMembers(membersResp);
    if (includeDueReminders) {
      setHasDueReminders(dueRemindersResp.length > 0);
      for (const reminder of dueRemindersResp) {
        if (dueReminderIdsRef.current.has(reminder.id)) continue;
        dueReminderIdsRef.current.add(reminder.id);
        toast.warning(`提醒已到期：${reminder.title}`);
      }
    }
    if (import.meta.env.DEV) {
      console.debug("[loadWorkspaceChrome] completed", { reason: options.reason ?? "unknown" });
    }
  }

  async function loadData(options: { silent?: boolean; reason?: string; lightweight?: boolean } = {}) {
    await loadVisibleNotes({ silent: options.silent, reason: options.reason });
    if (!options.lightweight) {
      await loadWorkspaceChrome({
        includeDueReminders: true,
        includeGraph: true,
        reason: options.reason,
      });
    }
  }

  function refreshDataSilently(reason: string, lightweight = true, debounceMs = 260) {
    window.clearTimeout(silentRefreshTimerRef.current);
    silentRefreshTimerRef.current = window.setTimeout(() => {
      loadData({ silent: true, reason, lightweight }).catch(() => undefined);
    }, debounceMs);
  }

  useEffect(() => {
    if (!user || !pendingInviteToken) return;
    acceptWorkspaceInvite(pendingInviteToken)
      .then(() => {
        toast.success("已加入共享工作区");
        setPendingInviteToken(null);
        const url = new URL(window.location.href);
        url.searchParams.delete("invite");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        return loadData({ silent: true, reason: "accept-invite", lightweight: false }).then(() => {
          if (pendingNoteId) {
            return selectNote(pendingNoteId).then(() => setPendingNoteId(null));
          }
          return undefined;
        });
      })
      .catch((error) => {
        toast.error(getErrorMessage(error, "加入工作区失败"));
      });
  }, [user, pendingInviteToken, pendingNoteId]);

  useEffect(() => {
    if (!user || !pendingNoteId || pendingInviteToken) return;
    selectNote(pendingNoteId)
      .then(() => setPendingNoteId(null))
      .catch((error) => {
        const message =
          error instanceof ApiClientError && error.code === "NOT_FOUND"
            ? "这是工作区内部链接，请让拥有者发送独享链接或邀请邮件"
            : getErrorMessage(error, "打开分享笔记失败");
        toast.error(message);
        setPendingNoteId(null);
      });
  }, [user, pendingInviteToken, pendingNoteId]);

  useEffect(() => {
    if (!user) return;
    loadData({ reason: "workspace-bootstrap", lightweight: false }).catch(() => undefined);
  }, [user?.current_workspace?.id]);

  useEffect(() => {
    if (authLoading || idlePrefetchScheduled) return;
    if (!user && !pendingPublicShareToken) return;

    idlePrefetchScheduled = true;
    let timeoutId: number | null = null;
    let idleHandle: number | null = null;

    const warmDeferredChunks = () => {
      const tasks = [preloadMarkdownPreview()];
      if (user) tasks.push(preloadCommandPalette());
      void Promise.allSettled(tasks);
    };

    if (window.requestIdleCallback) {
      idleHandle = window.requestIdleCallback(() => warmDeferredChunks(), { timeout: 1500 });
    } else {
      timeoutId = window.setTimeout(warmDeferredChunks, 350);
    }

    return () => {
      if (idleHandle !== null && window.cancelIdleCallback) window.cancelIdleCallback(idleHandle);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [authLoading, user, pendingPublicShareToken]);

  useEffect(() => {
    if (!user) return;
    loadVisibleNotes({ reason: "dependency-change" }).catch(() => undefined);
  }, [page, pageSize, debouncedSearchQuery, selectedTagId, favoriteOnly, libraryView, selectedFolderId, selectedDatabaseId, activeDailyDate]);

  useEffect(() => {
    if (!user) return;
    if (libraryView === "graph" || libraryView === "knowledge" || libraryView === "reminders") {
      loadWorkspaceChrome({
        includeDueReminders: libraryView === "reminders",
        includeGraph: libraryView === "graph",
        reason: `library-view:${libraryView}`,
      }).catch(() => undefined);
    }
  }, [user, libraryView]);

  useEffect(() => {
    if (!selectedNoteBase) return;
    setTitleDraft(decodeEscapedUnicode(selectedNoteBase.title));
    setContentDraft(decodeEscapedUnicode(selectedNoteBase.content));
    setMoveFolderValue(selectedNoteBase.folder_id ?? null);
    setSaveStatus("idle");
    getNoteVersions(selectedNoteBase.id).then(setVersions).catch(() => setVersions([]));
    Promise.all([
      getNoteLinks(selectedNoteBase.id).catch(() => []),
      getNoteBacklinks(selectedNoteBase.id).catch(() => []),
      getLocalGraph(selectedNoteBase.id).catch(() => emptyGraph),
    ]).then(([nextLinks, nextBacklinks, nextGraph]) => {
      setLinks(nextLinks);
      setBacklinks(nextBacklinks);
      setGraph(nextGraph);
    });
  }, [selectedNoteBase?.id, setSaveStatus, setVersions]);

  useEffect(() => {
    if (!titleAutoFocus) return;
    const timeout = window.setTimeout(() => setTitleAutoFocus(false), 120);
    return () => window.clearTimeout(timeout);
  }, [titleAutoFocus]);

  useEffect(() => {
    setBatchMode(false);
    setBatchSelectedIds([]);
  }, [libraryView, searchQuery, selectedTagId, selectedFolderId, page]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (isMod && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openTemplatePicker("create");
      }
      if (isMod && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setQuickCaptureOpen(true);
      }
      if (isMod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        handleSaveNow().catch(() => undefined);
      }
      if (isMod && (event.key.toLowerCase() === "f" || event.key.toLowerCase() === "k")) {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.shiftKey && event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      }
      if (event.key === "Escape") {
        if (commandOpen) setCommandOpen(false);
        else if (isDeleteDialogOpen) setDeleteDialog(false);
        else if (historyDialogOpen) setHistoryDialogOpen(false);
        else if (moveFolderOpen) setMoveFolderOpen(false);
        else if (templatePickerOpen) setTemplatePickerOpen(false);
        else if (folderDialogOpen) setFolderDialogOpen(false);
        else if (folderDeleteOpen) setFolderDeleteOpen(false);
        else if (mobileInspectorOpen) setMobileInspectorOpen(false);
        else if (accountMenuOpen) setAccountMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    accountMenuOpen,
    commandOpen,
    folderDeleteOpen,
    folderDialogOpen,
    historyDialogOpen,
    isDeleteDialogOpen,
    mobileInspectorOpen,
    moveFolderOpen,
    setAccountMenuOpen,
    setCommandOpen,
    setDeleteDialog,
    setMobileInspectorOpen,
    setShortcutsOpen,
    templatePickerOpen,
  ]);

  async function handleCreateWorkspace(name: string) {
    const created = await createWorkspaceApi(name);
    setWorkspaces((current) =>
      [created, ...current.filter((item) => item.id !== created.id)].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    );
    toast.success("工作区已创建");
  }

  async function handleSwitchWorkspace(workspaceId: string) {
    const switched = await switchWorkspaceApi(workspaceId);
    if (user) {
      setUser({ ...user, current_workspace: switched });
    }
    setWorkspaceMembers([]);
    toast.success(`已切换到工作区：${switched.name}`);
    await loadData({ reason: "switch-workspace", lightweight: false });
  }

  async function handleInviteWorkspaceMember(payload: { email: string; role: "editor" | "viewer"; note_id?: string | null }): Promise<WorkspaceInviteResult> {
    if (!currentWorkspaceId) throw new Error("当前没有工作区");
    const result = await inviteWorkspaceMember(currentWorkspaceId, payload);
    toast.success("邀请链接已生成");
    const members = await getWorkspaceMembers(currentWorkspaceId);
    setWorkspaceMembers(members);
    return result;
  }

  async function handleExportAllFormat(format: AllExportFormat) {
    await downloadAll(format);
  }

  async function handleCopyNoteDeepLink(noteId: string) {
    await copyTextToClipboard(buildNoteDeepLink(noteId));
    toast.success("已复制笔记链接");
  }

  async function handleCreateNoteInvite(noteId: string, payload: { email: string; role: "editor" | "viewer" }) {
    const result = await handleInviteWorkspaceMember({ ...payload, note_id: noteId });
    return { invite_url: result.invite_url };
  }

  function toggleBatchNote(id: string) {
    setBatchSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleBatchMode() {
    setBatchMode((current) => !current);
    setBatchSelectedIds([]);
  }

  function selectAllVisible() {
    setBatchSelectedIds(listNotes.map((note) => note.id));
  }

  async function handleCopyInternalLink() {
    if (!selectedNoteBase) return;
    await copyTextToClipboard(`[[${decodeEscapedUnicode(selectedNoteBase.title || "无标题笔记")}]]`);
    toast.success("已复制内部链接");
  }

  async function handleToggleTag(tagId: string) {
    assertCanWrite();
    if (!selectedNoteBase || libraryView === "trash") return;
    const nextTagIds = selectedNoteBase.tags.some((tag) => tag.id === tagId)
      ? selectedNoteBase.tags.filter((tag) => tag.id !== tagId).map((tag) => tag.id)
      : [...selectedNoteBase.tags.map((tag) => tag.id), tagId];
    const updated = await updateNoteTags(selectedNoteBase.id, { tagIds: nextTagIds });
    upsertNote(updated);
    refreshDataSilently("toggle-tag");
  }

  async function handleCreateTag() {
    assertCanWrite();
    const normalized = tagName.trim();
    if (!normalized) return;
    setTagLoading(true);
    try {
      const created = await createTag({ name: normalized });
      upsertTag(created);
      setTagName("");
      if (selectedNoteBase) {
        const updated = await updateNoteTags(selectedNoteBase.id, {
          tagIds: [...selectedNoteBase.tags.map((tag) => tag.id), created.id],
        });
        upsertNote(updated);
      }
      toast.success("已创建标签");
      refreshDataSilently("create-tag");
    } finally {
      setTagLoading(false);
    }
  }

  function openTemplatePicker(mode: "create" | "apply") {
    setTemplatePickerMode(mode);
    setActiveTemplateId(noteTemplates.find((template) => template.id === "blank")?.id ?? noteTemplates[0]?.id ?? null);
    setTemplatePickerOpen(true);
  }

  async function handleConfirmTemplatePicker() {
    assertCanWrite();
    const activeTemplate = noteTemplates.find((template) => template.id === activeTemplateId);
    if (!activeTemplate) return;
    setTemplateApplying(true);
    try {
      if (templatePickerMode === "create" || !selectedNoteBase) {
        await handleCreateNote(activeTemplate);
      } else {
        const updated = await updateNote(selectedNoteBase.id, {
          title: activeTemplate.title,
          content: activeTemplate.content,
        });
        upsertNote(updated);
        setTitleDraft(updated.title);
        setContentDraft(updated.content);
      }
      setTemplatePickerOpen(false);
      toast.success(templatePickerMode === "create" ? "已从模板创建笔记" : "已应用模板");
      refreshDataSilently("apply-template");
    } finally {
      setTemplateApplying(false);
      setQuickCaptureOpen(false);
    }
  }

  function openCreateFolderDialog() {
    setFolderDialogMode("create");
    setFolderDialogValue("");
    setFolderDialogError(null);
    setFolderTarget(null);
    setFolderDialogOpen(true);
  }

  function openRenameFolderDialog(folder: { id: string; name: string }) {
    setFolderDialogMode("rename");
    setFolderDialogValue(folder.name);
    setFolderDialogError(null);
    setFolderTarget(folder);
    setFolderDialogOpen(true);
  }

  function openDeleteFolderDialog(folder: { id: string; name: string }) {
    setFolderTarget(folder);
    setFolderDeleteOpen(true);
  }

  function openCreateDatabaseDialog() {
    setDatabaseName("");
    setDatabaseDescription("");
    setDatabaseIcon("");
    setDatabaseInitialStatus(true);
    setDatabaseInitialDate(true);
    setDatabaseDialogOpen(true);
  }

  async function handleSubmitFolderDialog() {
    assertCanWrite();
    const name = folderDialogValue.trim();
    if (!name) {
      setFolderDialogError("文件夹名称不能为空");
      return;
    }
    setFolderDialogLoading(true);
    setFolderDialogError(null);
    try {
      if (folderDialogMode === "create") {
        const created = await createFolder({ name });
        upsertFolder(created);
        setLibraryView("folder");
        setSelectedFolderId(created.id);
        toast.success("已创建文件夹");
      } else if (folderTarget) {
        const updated = await updateFolder(folderTarget.id, { name });
        upsertFolder(updated);
        toast.success("已重命名文件夹");
      }
      setFolderDialogOpen(false);
      setFolderDialogValue("");
      setFolderTarget(null);
      refreshDataSilently("folder-dialog-submit");
    } catch (error) {
      const message = getErrorMessage(error, "文件夹操作失败");
      setFolderDialogError(message);
      toast.error(message);
    } finally {
      setFolderDialogLoading(false);
    }
  }

  async function handleConfirmDeleteFolder() {
    assertCanWrite();
    if (!folderTarget) return;
    setFolderDeleteLoading(true);
    try {
      await deleteFolder(folderTarget.id);
      removeFolder(folderTarget.id);
      setFolderDeleteOpen(false);
      setFolderTarget(null);
      toast.success("已删除文件夹");
      refreshDataSilently("delete-folder");
    } catch (error) {
      toast.error(getErrorMessage(error, "删除文件夹失败"));
    } finally {
      setFolderDeleteLoading(false);
    }
  }

  async function confirmNoteDelete() {
    setNoteDeleteLoading(true);
    try {
      await handleDeleteConfirm();
    } catch (error) {
      toast.error(getErrorMessage(error, "删除失败"));
    } finally {
      setNoteDeleteLoading(false);
    }
  }

  async function confirmEmptyTrash() {
    setEmptyTrashLoading(true);
    try {
      await handleEmptyTrash();
      setEmptyTrashOpen(false);
    } catch (error) {
      toast.error(getErrorMessage(error, "清空回收站失败"));
    } finally {
      setEmptyTrashLoading(false);
    }
  }

  async function confirmDeleteReminder() {
    if (!reminderDeleteTargetId) return;
    setReminderDeleteLoading(true);
    try {
      await handleDeleteReminder(reminderDeleteTargetId);
      setReminderDeleteTargetId(null);
    } catch (error) {
      toast.error(getErrorMessage(error, "提醒删除失败"));
    } finally {
      setReminderDeleteLoading(false);
    }
  }

  async function confirmDeleteDatabase() {
    setDatabaseDeleteLoading(true);
    try {
      await handleDeleteCurrentDatabase();
      setDatabaseDeleteOpen(false);
    } catch (error) {
      toast.error(getErrorMessage(error, "数据库删除失败"));
    } finally {
      setDatabaseDeleteLoading(false);
    }
  }

  function openMoveFolderDialog() {
    if (!selectedNoteBase) return;
    setMoveFolderValue(selectedNoteBase.folder_id ?? null);
    setMoveFolderOpen(true);
  }

  function requestWikiLink(title: string) {
    setPendingWikiTitle(title);
    setWikiConfirmOpen(true);
  }

  async function handleConfirmWikiLink() {
    if (!pendingWikiTitle) return;
    const title = pendingWikiTitle;
    setWikiConfirmOpen(false);
    setPendingWikiTitle(null);
    const note = await openOrCreateWikiLink(title);
    upsertNote(note);
    await selectNote(note.id);
  }

  async function handleRestoreVersion(versionId: string) {
    if (!selectedNoteBase) return;
    setHistoryRestoring(true);
    try {
      const note = await restoreNoteVersion(selectedNoteBase.id, versionId);
      upsertNote(note);
      setTitleDraft(note.title);
      setContentDraft(note.content);
      toast.success("已恢复历史版本");
      setHistoryDialogOpen(false);
    } catch (error) {
      toast.error(getErrorMessage(error, "恢复版本失败"));
    } finally {
      setHistoryRestoring(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
      handleSignedOut();
      toast.success("已退出登录");
    } catch (error) {
      toast.error(getErrorMessage(error, "退出登录失败"));
    }
  }

  function handleViewChange(view: LibraryView, folderId: string | null = null) {
    if (view === "graph" || view === "knowledge" || view === "reminders") {
      navigateToStandaloneView(view);
      return;
    }
    if (view === "daily") {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      setActiveDailyDate(`${year}-${month}-${day}`);
    }
    if (view === "database") {
      navigateToListView(view, { databaseId: folderId });
      return;
    }
    navigateToListView(view, { folderId });
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

  function navigateToStandaloneView(view: Extract<LibraryView, "graph" | "knowledge" | "reminders">) {
    setSearchQuery("");
    setSelectedFolderId(null);
    setSelectedDatabaseId(null);
    setSelectedTagId(null);
    setFavoriteOnly(false);
    setPagination({ page: 1, pageSize, total });
    setAccountMenuOpen(false);
    setMobileInspectorOpen(false);
    setMobilePrimaryPane("main");
    setLibraryView(view);
    markMobileNavigation();
  }

  function resolveFilterTargetView(): Exclude<LibraryView, "graph" | "knowledge" | "reminders"> {
    if (libraryView === "graph" || libraryView === "knowledge" || libraryView === "reminders" || libraryView === "trash" || libraryView === "recent") {
      return "all";
    }
    return libraryView;
  }

  function handleSearch(value: string) {
    setSearchQuery(value);
    setPagination({ page: 1, pageSize, total });
    if (value.trim().length >= 2) pushRecentSearch(value.trim());
  }

  function handlePrevPage() {
    if (page <= 1) return;
    setPagination({ page: page - 1, pageSize, total });
  }

  function handleNextPage() {
    if (page * pageSize >= total) return;
    setPagination({ page: page + 1, pageSize, total });
  }

  if (authLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading...</div>;
  }

  if (pendingPublicShareToken && (publicSharedNote || publicSharedNoteError)) {
    return (
      <div className="min-h-screen bg-[var(--surface-editor)]">
        <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-10 md:px-8">
          <div className="mb-8 flex items-center gap-3">
            <BrandMark compact />
            <div>
              <h1 className="text-xl font-semibold">{publicSharedNote?.note.title || "独享分享"}</h1>
              <p className="text-sm text-muted-foreground">
                {publicSharedNote
                  ? `来自 ${publicSharedNote.workspace_name} · 分享者 ${publicSharedNote.shared_by} · 只读`
                  : publicSharedNoteError}
              </p>
            </div>
          </div>
          {publicSharedNote ? (
            <div className="surface-card flex-1 p-0">
              <div className="border-b px-6 py-4" style={{ borderColor: "var(--border-subtle)" }}>
                <div className="text-sm text-muted-foreground">公开单篇分享</div>
                <div className="mt-1 text-2xl font-semibold">{publicSharedNote.note.title || "无标题笔记"}</div>
              </div>
              <PageErrorBoundary
                title="分享预览加载失败"
                description="Markdown 分享预览暂时无法渲染。你可以重试，或刷新页面重新加载分享内容。"
                resetKey={publicSharedNote.note.id}
              >
                <Suspense fallback={<SharedPreviewFallback />}>
                  <LazyMarkdownPreview
                    content={publicSharedNote.note.content}
                    onChangeContent={() => undefined}
                    onOpenWikiLink={() => undefined}
                    interactive={false}
                  />
                </Suspense>
              </PageErrorBoundary>
            </div>
          ) : (
            <div className="surface-card flex flex-1 items-center justify-center p-10 text-center text-muted-foreground">
              <div className="w-full max-w-sm space-y-3">
                <div>{publicSharedNoteError ?? "分享链接不存在或已失效"}</div>
                <Input
                  type="password"
                  value={publicSharePassword}
                  onChange={(event) => setPublicSharePassword(event.target.value)}
                  placeholder="如果分享设置了密码，请输入访问密码"
                  className="rounded-[12px]"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <PageErrorBoundary
        title="登录页面加载失败"
        description="认证模块暂时无法渲染。请重试，或刷新页面重新加载登录入口。"
        resetKey={resetToken ?? pendingInviteToken ?? "auth"}
        className="min-h-screen"
      >
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading...</div>}>
          <AuthPanel
            loading={false}
            resetToken={resetToken}
            invitePreview={pendingInvitePreview}
            onLogin={async (payload) => {
              await login(payload);
              const current = await getCurrentUser();
              setUser(current);
              toast.success("登录成功");
            }}
            onRegister={async (payload) => {
              const pending = await register(payload);
              toast.success("验证码已发送到你的邮箱");
              return pending;
            }}
            onVerifyEmailCode={async (payload) => {
              const current = await verifyEmailCode(payload);
              setUser(current);
              toast.success("邮箱验证成功");
            }}
            onResendVerificationCode={async (email) => {
              const pending = await resendVerificationCode(email);
              toast.success("验证码已重新发送");
              return pending;
            }}
            onForgotPassword={async (email, turnstileToken) => {
              await forgotPasswordWithTurnstile(email, turnstileToken);
              toast.success("如果邮箱存在，已发送重置链接");
            }}
          onResetPassword={async (payload) => {
            await resetPassword(payload.token, payload.password, payload.turnstile_token);
            setResetToken(null);
            window.history.replaceState({}, "", "/");
            toast.success("密码已重置，请重新登录");
          }}
          />
        </Suspense>
      </PageErrorBoundary>
    );
  }

  const topTabs = (
    <TopTabs
      tabs={openedTabs}
      notesById={allKnownNotes}
      activeId={selectedNoteId}
      onSelect={(id) => selectNote(id).catch((error) => toast.error(getErrorMessage(error, "打开笔记失败")))}
      onClose={closeTab}
      onCreate={() => openTemplatePicker("create")}
    />
  );

  const sidebarProps = {
    noteCount: notes.length,
    favoriteCount,
    pinnedCount,
    trashCount: trashNotes.length,
    dueReminderCount: hasDueReminders ? reminders.filter((item) => !item.completed_at && new Date(item.due_at).getTime() <= Date.now()).length : 0,
    databases,
    folders,
    tags,
    libraryView,
    selectedFolderId,
    selectedDatabaseId,
    selectedTagId,
    theme,
    userEmail: profile?.email ?? user.email,
    userName: profile?.display_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    accountMenuOpen,
    onViewChange: handleViewChange,
    onTagToggle: (tagId: string | null) => {
      navigateToListView("all", { tagId });
    },
    onCreateNote: () => openTemplatePicker("create"),
    onCreateDatabase: openCreateDatabaseDialog,
    onCreateFolder: openCreateFolderDialog,
    onRenameFolder: openRenameFolderDialog,
    onDeleteFolder: openDeleteFolderDialog,
    onOpenCommand: () => setCommandOpen(true),
    onOpenSettings: () => {
      setAccountMenuOpen(false);
      setSettingsOpen(true);
    },
    onOpenReminders: () => {
      setAccountMenuOpen(false);
      handleViewChange("reminders");
    },
    onThemeChange: setTheme,
    onToggleAccountMenu: setAccountMenuOpen,
    onLogout: () => handleLogout().catch(() => undefined),
  };

  const sidebar = (
    <Sidebar
      {...sidebarProps}
    />
  );

  const mobileSidebar = <Sidebar {...sidebarProps} mobile />;

  const noteList =
    libraryView === "graph" || libraryView === "knowledge" || libraryView === "reminders"
      ? null
      : libraryView === "database" && currentDatabase
        ? (
          <PageErrorBoundary
            title="数据库页面加载失败"
            description="当前数据库视图暂时无法渲染。你可以重试，或切换到其他数据库后再回来。"
            resetKey={`${currentDatabase.id}:${databaseView}`}
          >
            <DatabasePage
              database={currentDatabase}
              properties={databaseProperties}
              templates={databaseTemplates}
              duplicateGroups={databaseDuplicateGroups}
              notes={listNotes}
              workspaceMembers={workspaceMembers}
              activeView={databaseView}
              viewPreference={currentDatabasePreference}
              selectedNoteId={selectedNoteId}
              onViewChange={(view) => setDatabaseViewPreference(currentDatabase.id, { view })}
              onPreferenceChange={(patch) => setDatabaseViewPreference(currentDatabase.id, patch)}
              onSelectNote={(id) => selectNote(id).catch((error) => toast.error(getErrorMessage(error, "打开笔记失败")))}
              onCreateNote={(templateId) => handleCreateDatabaseNote(templateId).catch((error) => toast.error(getErrorMessage(error, "数据库笔记创建失败")))}
              onRequestDeleteDatabase={() => setDatabaseDeleteOpen(true)}
              onUpdateDatabaseInfo={(payload) => handleUpdateDatabaseInfo(payload).catch((error) => {
                toast.error(getErrorMessage(error, "数据库信息更新失败"));
                throw error;
              })}
              onUpdateDatabaseField={(payload) => handleUpdateDatabaseFields(payload).catch((error) => {
                toast.error(getErrorMessage(error, "数据库配置更新失败"));
                throw error;
              })}
              onCreateProperty={(payload) => handleCreateDatabaseProperty(payload).catch((error) => {
                toast.error(getErrorMessage(error, "属性创建失败"));
                throw error;
              })}
              onUpdateProperty={(propertyId, payload) => handleUpdateDatabaseProperty(propertyId, payload).catch((error) => {
                toast.error(getErrorMessage(error, "属性更新失败"));
                throw error;
              })}
              onDeleteProperty={(propertyId) => handleDeleteDatabaseProperty(propertyId).catch((error) => {
                toast.error(getErrorMessage(error, "属性删除失败"));
                throw error;
              })}
              onUpdateNoteTitle={(noteId, title) => handleUpdateNoteTitleInDatabase(noteId, title).catch((error) => {
                toast.error(getErrorMessage(error, "标题更新失败"));
                throw error;
              })}
              onUpdateNoteValue={(noteId, payload) => handleUpdateNoteDatabaseValue(noteId, payload).catch((error) => {
                toast.error(getErrorMessage(error, "属性值更新失败"));
                throw error;
              })}
              onCreateSavedView={(payload) => handleCreateSavedDatabaseView(payload).catch((error) => {
                toast.error(getErrorMessage(error, "视图保存失败"));
                throw error;
              })}
              onUpdateSavedView={(viewId, payload) => handleUpdateSavedDatabaseView(viewId, payload).catch((error) => {
                toast.error(getErrorMessage(error, "视图更新失败"));
                throw error;
              })}
              onDeleteSavedView={(viewId) => handleDeleteSavedDatabaseView(viewId).catch((error) => {
                toast.error(getErrorMessage(error, "视图删除失败"));
                throw error;
              })}
              onExportCsv={() => handleExportCurrentDatabaseCsv().catch((error) => {
                toast.error(getErrorMessage(error, "CSV 导出失败"));
                throw error;
              })}
              onImportCsv={(file) => handleImportCurrentDatabaseCsv(file).catch((error) => {
                toast.error(getErrorMessage(error, "CSV 导入失败"));
                throw error;
              })}
              onCreateTemplate={(payload) => handleCreateCurrentDatabaseTemplate(payload).catch((error) => {
                toast.error(getErrorMessage(error, "模板保存失败"));
                throw error;
              })}
              onUpdateTemplate={(templateId, payload) => handleUpdateCurrentDatabaseTemplate(templateId, payload).catch((error) => {
                toast.error(getErrorMessage(error, "模板更新失败"));
                throw error;
              })}
              onDeleteTemplate={(templateId) => handleDeleteCurrentDatabaseTemplate(templateId).catch((error) => {
                toast.error(getErrorMessage(error, "模板删除失败"));
                throw error;
              })}
              onBatchNotes={(payload) => handleBatchCurrentDatabaseNotes(payload).catch((error) => {
                toast.error(getErrorMessage(error, "批量操作失败"));
                throw error;
              })}
            />
          </PageErrorBoundary>
        )
        : libraryView === "database"
          ? (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              选择一个数据库开始管理结构化笔记。
            </div>
          )
        : (
          <NoteListPanel
            loading={loading}
            loadError={loadError}
            libraryView={libraryView}
            notes={listNotes}
            folders={folders}
            tags={tags}
            selectedNoteId={selectedNoteId}
            searchQuery={searchQuery}
            recentSearches={recentSearches}
            favoriteOnly={favoriteOnly}
            selectedTagId={selectedTagId}
            page={page}
            pageSize={pageSize}
            total={total}
            noteListView={noteListView}
            noteSort={noteSort}
            activeDailyDate={libraryView === "daily" ? activeDailyDate : undefined}
            isTrashView={libraryView === "trash"}
            batchMode={batchMode}
            batchSelectedIds={batchSelectedIds}
            onSearch={handleSearch}
            onUseRecentSearch={handleSearch}
            onFavoriteToggle={() => {
              navigateToListView(resolveFilterTargetView(), { folderId: selectedFolderId, tagId: selectedTagId, favoriteOnly: !favoriteOnly, databaseId: selectedDatabaseId });
            }}
            onTagToggle={(id) => {
              navigateToListView(resolveFilterTargetView(), { folderId: selectedFolderId, tagId: id, favoriteOnly, databaseId: selectedDatabaseId });
            }}
            onSelectNote={(id) => selectNote(id).catch((error) => toast.error(getErrorMessage(error, "打开笔记失败")))}
            onShareNote={(id) => openShareDialog(id)}
            onExportNote={(id, format) => {
              downloadNote(id, format).catch((error) => toast.error(getErrorMessage(error, "导出失败")));
            }}
            onToggleBatchMode={toggleBatchMode}
            onToggleBatchNote={toggleBatchNote}
            onSelectAllVisible={selectAllVisible}
            onClearBatchSelection={() => setBatchSelectedIds([])}
            onBatchDelete={() => handleBatchDelete().catch(() => undefined)}
            onBatchArchive={() => handleBatchArchive().catch(() => undefined)}
            onBatchPin={() => handleBatchPin().catch(() => undefined)}
            onBatchMoveFolder={(folderId) => handleBatchMoveFolder(folderId).catch(() => undefined)}
            onQuickDelete={(id) => {
              setPermanentDeleteMode(libraryView === "trash");
              setDeleteDialog(true, id);
            }}
            onCreateNote={() => {
              if (libraryView === "daily") {
                handleOpenOrCreateDailyNote(activeDailyDate).catch((error) => toast.error(getErrorMessage(error, "每日笔记创建失败")));
                return;
              }
              openTemplatePicker("create");
            }}
            onOpenTemplatePicker={() => openTemplatePicker("create")}
            onDailyDateChange={setActiveDailyDate}
            onSetListView={setNoteListView}
            onSetNoteSort={setNoteSort}
            onPrevPage={handlePrevPage}
            onNextPage={handleNextPage}
            onRetryLoad={() => loadData().catch(() => undefined)}
          />
        );

  const suspenseFallback = <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading...</div>;
  const main = libraryView === "graph" ? (
    <PageErrorBoundary
      title="图谱页面加载失败"
      description="图谱视图暂时无法渲染。你可以重试，或切换到其他视图继续使用笔记。"
      resetKey={`graph:${selectedNoteId ?? "all"}`}
    >
      <Suspense fallback={suspenseFallback}>
        <GraphPage graph={graph} selectedNoteId={selectedNoteId} onSelectNode={(id) => selectNote(id).catch(() => undefined)} />
      </Suspense>
    </PageErrorBoundary>
  ) : libraryView === "knowledge" ? (
    <PageErrorBoundary
      title="知识中心加载失败"
      description="知识中心暂时无法渲染。你可以重试，或返回笔记列表继续工作。"
      resetKey={`knowledge:${selectedNoteId ?? "none"}`}
    >
      <Suspense fallback={suspenseFallback}>
        <KnowledgeCenterPage
          notes={[...notes, ...recentNotes, ...trashNotes]}
          reminders={reminders}
          databases={databases}
          selectedNoteId={selectedNoteId}
          workspaceMembers={workspaceMembers}
          readOnly={isWorkspaceReadonly}
          onOpenNote={(id) => selectNote(id).catch((error) => toast.error(getErrorMessage(error, "打开笔记失败")))}
          onNoteCreated={(note) => {
            upsertNote(note);
            selectNote(note.id).catch(() => undefined);
            refreshDataSilently("knowledge-note-created", true, 420);
          }}
          onApplySavedSearch={(query, filters) => {
            const pickFilterId = (pluralKey: string, singularKey: string) => {
              const pluralValue = filters?.[pluralKey];
              if (Array.isArray(pluralValue)) {
                const first = pluralValue.find((item): item is string => typeof item === "string" && item.trim().length > 0);
                if (first) return first;
              }
              const singularValue = filters?.[singularKey];
              return typeof singularValue === "string" && singularValue.trim() ? singularValue : null;
            };
            const folderId = pickFilterId("folderIds", "folderId");
            const databaseId = pickFilterId("databaseIds", "databaseId");
            const tagId = pickFilterId("tagIds", "tagId");
            const onlyFavorites = filters?.favoriteOnly === true;
            setLibraryView(databaseId ? "database" : folderId ? "folder" : onlyFavorites ? "favorites" : "all");
            setSelectedFolderId(folderId);
            setSelectedDatabaseId(databaseId);
            setSelectedTagId(tagId);
            setFavoriteOnly(onlyFavorites);
            handleSearch(query);
          }}
        />
      </Suspense>
    </PageErrorBoundary>
  ) : libraryView === "reminders" ? (
    <PageErrorBoundary
      title="提醒中心加载失败"
      description="提醒中心暂时无法渲染。你可以重试，或切换回笔记列表。"
      resetKey={`reminders:${reminders.length}`}
    >
      <Suspense fallback={suspenseFallback}>
        <ReminderCenterPage
          reminders={reminders}
          notes={notes}
          onOpenNote={(id) => selectNote(id).catch(() => undefined)}
          onCreate={(payload) => handleCreateReminder(payload).catch((error) => toast.error(getErrorMessage(error, "提醒创建失败")))}
          onToggleComplete={(id) => handleToggleReminderComplete(id).catch((error) => toast.error(getErrorMessage(error, "提醒更新失败")))}
          onUpdate={(id, payload) => handleUpdateReminder(id, payload).catch((error) => toast.error(getErrorMessage(error, "提醒更新失败")))}
          onDelete={(id) => setReminderDeleteTargetId(id)}
        />
      </Suspense>
    </PageErrorBoundary>
  ) : selectedNote ? (
    <div className="flex h-full flex-col" style={{ background: "var(--surface-editor)" }}>
      <EditorHeader
        note={selectedNote}
        editorMode={editorMode}
        saveStatus={saveStatus}
        saveError={saveError}
        focusMode={focusMode}
        inspectorOpen={mobileInspectorOpen}
        readOnly={isWorkspaceReadonly}
        onModeChange={setEditorMode}
        onSaveNow={() => handleSaveNow().catch((error) => toast.error(getErrorMessage(error, "保存失败")))}
        onRetrySave={() => handleSaveNow().catch((error) => toast.error(getErrorMessage(error, "保存失败")))}
        onToggleFavorite={() => handleToggleFavorite().catch((error) => toast.error(getErrorMessage(error, "收藏状态更新失败")))}
        onTogglePinned={() => handleTogglePinned().catch((error) => toast.error(getErrorMessage(error, "置顶操作失败")))}
        onArchiveToggle={() => handleArchiveToggle().catch((error) => toast.error(getErrorMessage(error, "归档操作失败")))}
        onDuplicate={() => handleDuplicateCurrent().catch((error) => toast.error(getErrorMessage(error, "复制笔记失败")))}
        onCopyInternalLink={() => handleCopyInternalLink().catch((error) => toast.error(getErrorMessage(error, "复制链接失败")))}
        onFocusModeToggle={() => setFocusMode(!focusMode)}
        onOpenHistory={() => setHistoryDialogOpen(true)}
        onOpenMoveFolder={openMoveFolderDialog}
        onOpenTemplatePicker={() => openTemplatePicker("apply")}
        onOpenQuickReminder={() => setQuickReminderOpen(true)}
        onShare={() => {
          if (!selectedNoteBase) return;
          openShareDialog(selectedNoteBase.id);
        }}
        onExportMarkdown={() => selectedNoteBase ? downloadNoteMarkdown(selectedNoteBase.id).catch((error) => toast.error(getErrorMessage(error, "导出失败"))) : undefined}
        onExportMenuOpen={(format) =>
          selectedNoteBase
            ? downloadNote(selectedNoteBase.id, format).catch((error) => toast.error(getErrorMessage(error, "导出失败")))
            : toast.error("请先选择一篇笔记")
        }
        onDelete={() => {
          setPermanentDeleteMode(libraryView === "trash");
          setDeleteDialog(true, selectedNoteBase?.id ?? null);
        }}
        onToggleInspector={() => setMobileInspectorOpen(!mobileInspectorOpen)}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {libraryView === "trash" ? (
          <div className="border-b border-border/70 bg-amber-50 px-6 py-2 text-sm text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">
            这篇笔记当前位于回收站。            <button type="button" className="ml-3 font-medium underline" onClick={() => handleRestoreCurrent().catch((error) => toast.error(getErrorMessage(error, "恢复失败")))}>
              恢复
            </button>
          </div>
        ) : null}
        <NoteEditor
          title={titleDraft}
          content={contentDraft}
          editorMode={editorMode}
          titleAutoFocus={titleAutoFocus}
          readOnly={isWorkspaceReadonly || libraryView === "trash"}
          onTitleChange={(value) => {
            setTitleDraft(value);
            queueAutosave(value, contentDraft);
          }}
          onContentChange={(value) => {
            setContentDraft(value);
            queueAutosave(titleDraft, value);
          }}
          insertRequest={insertRequest}
          onOpenWikiLink={(title) => requestWikiLink(title)}
          onUploadAttachment={(file) => handleUploadAttachmentToNote(file)}
        />
      </div>
      <footer
        className="glass-toolbar flex h-8 shrink-0 items-center justify-between border-t px-6 text-[11px] text-muted-foreground"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <span>最后编辑：{selectedNote.updated_at ? decodeEscapedUnicode(new Date(selectedNote.updated_at).toLocaleString("zh-CN")) : "刚刚"}</span>
        <span>{wordCount} 词 · 预计 {readMinutes} 分钟阅读</span>
      </footer>
    </div>
  ) : (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        icon={FileText}
        title={loading ? "正在加载..." : "选择一篇笔记开始编辑"}
        description="使用左侧导航或命令面板打开笔记。"
        actionLabel="新建笔记"
        onAction={() => openTemplatePicker("create")}
      />
    </div>
  );

  const rightPanel = (
    <RightPanel
      note={selectedNote}
      folders={folders}
      allTags={tags}
      databases={databases}
      databaseProperties={databaseProperties}
      workspaceMembers={workspaceMembers}
      versions={versions}
      outline={outline}
      graph={graph}
      links={links}
      backlinks={backlinks}
      activeTab={rightPanelTab}
      inspectorMode={inspectorMode}
      charCount={charCount}
      wordCount={wordCount}
      readMinutes={readMinutes}
      tagName={tagName}
      tagLoading={tagLoading}
      onTabChange={setRightPanelTab}
      onInspectorModeChange={setInspectorMode}
      onAssignFolder={(folderId) => handleAssignFolder(folderId).catch((error) => toast.error(getErrorMessage(error, "移动文件夹失败")))}
      onAssignDatabase={(databaseId) => {
        if (!selectedNoteBase) return;
        handleUpdateNoteDatabaseMembershipValue(selectedNoteBase.id, databaseId).catch((error) => toast.error(getErrorMessage(error, "数据库归属更新失败")));
      }}
      onToggleTag={(id) => handleToggleTag(id).catch((error) => toast.error(getErrorMessage(error, "标签更新失败")))}
      onTagNameChange={setTagName}
      onCreateTag={() => handleCreateTag().catch((error) => toast.error(getErrorMessage(error, "标签创建失败")))}
      onUpdateDatabaseValue={(payload) => {
        if (!selectedNoteBase) return;
        handleUpdateNoteDatabaseValue(selectedNoteBase.id, payload).catch((error) => toast.error(getErrorMessage(error, "属性值更新失败")));
      }}
      onRestoreVersion={(versionId) => handleRestoreVersion(versionId).catch(() => undefined)}
      onOpenNode={(id) => selectNote(id).catch(() => undefined)}
      onOpenWikiTarget={(target, isId) => (isId ? selectNote(target).catch(() => undefined) : requestWikiLink(target))}
      onOpenSettings={() => setSettingsOpen(true)}
      onInsertSnippet={requestInsertSnippet}
    />
  );

  return (
    <>
      <AppShell
        topTabs={topTabs}
        sidebar={focusMode ? null : sidebar}
        mobileSidebar={focusMode ? null : mobileSidebar}
        noteList={focusMode ? null : noteList}
        main={main}
        rightPanel={focusMode ? null : rightPanel}
        mobilePrimaryPane={mobilePrimaryPane}
        mobileInspectorOpen={mobileInspectorOpen}
        mobileNavigationVersion={mobileNavigationVersion}
        onShowList={() => {
          setMobileInspectorOpen(false);
          setMobilePrimaryPane("list");
        }}
        onShowMain={() => {
          setMobileInspectorOpen(false);
          setMobilePrimaryPane("main");
        }}
        onToggleInspector={() => setMobileInspectorOpen(!mobileInspectorOpen)}
      />

      {isDeleteDialogOpen ? (
        <Suspense fallback={null}>
          <DeleteConfirmDialog
            open={isDeleteDialogOpen}
            title={selectedNote?.title ?? ""}
            permanent={permanentDeleteMode}
            loading={noteDeleteLoading}
            onOpenChange={(open) => {
              if (noteDeleteLoading) return;
              setDeleteDialog(open, deletingNoteId);
              if (!open) setPermanentDeleteMode(false);
            }}
            onConfirm={() => void confirmNoteDelete()}
          />
        </Suspense>
      ) : null}

      {folderDialogOpen ? (
        <Suspense fallback={null}>
          <FolderDialog
            open={folderDialogOpen}
            mode={folderDialogMode}
            value={folderDialogValue}
            loading={folderDialogLoading}
            error={folderDialogError}
            onOpenChange={setFolderDialogOpen}
            onValueChange={setFolderDialogValue}
            onSubmit={() => handleSubmitFolderDialog().catch(() => undefined)}
          />
        </Suspense>
      ) : null}

      {folderDeleteOpen ? (
        <Suspense fallback={null}>
          <ConfirmDialog
            open={folderDeleteOpen}
            title="删除文件夹"
            description={folderTarget ? `文件夹“${decodeEscapedUnicode(folderTarget.name)}”将被删除，当前文件夹下的笔记会回到 Inbox。` : "确认删除当前文件夹吗？"}
            confirmLabel="删除文件夹"
            destructive
            loading={folderDeleteLoading}
            onOpenChange={(open) => {
              if (folderDeleteLoading) return;
              setFolderDeleteOpen(open);
            }}
            onConfirm={() => handleConfirmDeleteFolder().catch(() => undefined)}
          />
        </Suspense>
      ) : null}

      {databaseDeleteOpen ? (
        <Suspense fallback={null}>
          <ConfirmDialog
            open={databaseDeleteOpen}
            title="删除数据库"
            description={currentDatabase ? `数据库“${decodeEscapedUnicode(currentDatabase.name)}”将被删除，其中的笔记会保留，并从该数据库中移出。` : "确认删除当前数据库吗？"}
            confirmLabel="删除数据库"
            destructive
            loading={databaseDeleteLoading}
            onOpenChange={(open) => {
              if (databaseDeleteLoading) return;
              setDatabaseDeleteOpen(open);
            }}
            onConfirm={() => void confirmDeleteDatabase()}
          />
        </Suspense>
      ) : null}

      {emptyTrashOpen ? (
        <Suspense fallback={null}>
          <ConfirmDialog
            open={emptyTrashOpen}
            title="清空回收站"
            description="回收站中的笔记将被永久删除，不可恢复。"
            confirmLabel="清空回收站"
            destructive
            loading={emptyTrashLoading}
            onOpenChange={(open) => {
              if (emptyTrashLoading) return;
              setEmptyTrashOpen(open);
            }}
            onConfirm={() => void confirmEmptyTrash()}
          />
        </Suspense>
      ) : null}

      {reminderDeleteTargetId ? (
        <Suspense fallback={null}>
          <ConfirmDialog
            open={Boolean(reminderDeleteTargetId)}
            title="删除提醒"
            description={reminderDeleteTarget ? `提醒“${decodeEscapedUnicode(reminderDeleteTarget.title)}”将被删除。` : "确认删除这个提醒吗？"}
            confirmLabel="删除提醒"
            destructive
            loading={reminderDeleteLoading}
            onOpenChange={(open) => {
              if (reminderDeleteLoading) return;
              if (!open) setReminderDeleteTargetId(null);
            }}
            onConfirm={() => void confirmDeleteReminder()}
          />
        </Suspense>
      ) : null}

      <Dialog open={databaseDialogOpen} onOpenChange={setDatabaseDialogOpen}>
        <DialogContent className="mac-glass max-w-lg rounded-[24px]">
          <DialogHeader>
            <DialogTitle>新建数据库</DialogTitle>
            <DialogDescription>创建一个独立数据库，用表格、看板和日历管理这批笔记。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Input value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} placeholder="数据库名称" className="rounded-[12px]" />
            <Input value={databaseIcon} onChange={(event) => setDatabaseIcon(event.target.value)} placeholder="图标或 emoji，可选" className="rounded-[12px]" />
            <textarea
              value={databaseDescription}
              onChange={(event) => setDatabaseDescription(event.target.value)}
              placeholder="数据库描述，可选"
              className="min-h-24 rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <div className="grid gap-2 rounded-[14px] border border-border/70 bg-white/55 p-3 text-sm dark:bg-white/[0.04]">
              <label className="flex items-center justify-between gap-3">
                <span>
                  <span className="block font-medium">初始 Status 属性</span>
                  <span className="text-xs text-muted-foreground">创建 To do / Doing / Done 单选，并绑定看板。</span>
                </span>
                <input type="checkbox" checked={databaseInitialStatus} onChange={(event) => setDatabaseInitialStatus(event.target.checked)} />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>
                  <span className="block font-medium">初始 Date 属性</span>
                  <span className="text-xs text-muted-foreground">创建日期字段，并绑定日历。</span>
                </span>
                <input type="checkbox" checked={databaseInitialDate} onChange={(event) => setDatabaseInitialDate(event.target.checked)} />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="rounded-[12px]" onClick={() => setDatabaseDialogOpen(false)}>
                取消
              </Button>
              <Button
                className="rounded-[12px]"
                disabled={!databaseName.trim()}
                onClick={() => handleCreateDatabase().catch((error) => toast.error(getErrorMessage(error, "数据库创建失败")))}
              >
                创建数据库
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {wikiConfirmOpen ? (
        <Suspense fallback={null}>
          <ConfirmDialog
            open={wikiConfirmOpen}
            title="打开内部链接"
            description={pendingWikiTitle ? `将打开《${decodeEscapedUnicode(pendingWikiTitle)}》，如果不存在会自动创建。` : "确认打开内部链接？"}
            confirmLabel="继续"
            onOpenChange={(open) => {
              setWikiConfirmOpen(open);
              if (!open) setPendingWikiTitle(null);
            }}
            onConfirm={() => handleConfirmWikiLink().catch((error) => toast.error(getErrorMessage(error, "内部链接打开失败")))}
          />
        </Suspense>
      ) : null}

      {templatePickerOpen ? (
        <Suspense fallback={null}>
          <TemplatePickerDialog
            open={templatePickerOpen}
            mode={templatePickerMode}
            templates={noteTemplates}
            activeTemplateId={activeTemplateId}
            loading={templateApplying}
            onOpenChange={setTemplatePickerOpen}
            onSelectTemplate={setActiveTemplateId}
            onConfirm={() => handleConfirmTemplatePicker().catch(() => undefined)}
          />
        </Suspense>
      ) : null}

      {quickCaptureOpen ? (
        <Suspense fallback={null}>
          <QuickCaptureDialog
            open={quickCaptureOpen}
            databases={databases}
            onOpenChange={setQuickCaptureOpen}
            onSubmit={(payload) => handleQuickCapture(payload).catch((error) => {
              toast.error(getErrorMessage(error, "快速捕获失败"));
            })}
          />
        </Suspense>
      ) : null}

      {moveFolderOpen ? (
        <Suspense fallback={null}>
          <MoveFolderDialog
            open={moveFolderOpen}
            folders={folders}
            selectedFolderId={moveFolderValue}
            loading={moveFolderLoading}
            onOpenChange={setMoveFolderOpen}
            onSelectFolder={setMoveFolderValue}
            onConfirm={() => handleConfirmMoveFolder().catch(() => undefined)}
          />
        </Suspense>
      ) : null}

      {historyDialogOpen ? (
        <Suspense fallback={null}>
          <HistoryDialog
            open={historyDialogOpen}
            versions={versions}
            loading={historyRestoring}
            onOpenChange={setHistoryDialogOpen}
            onRestore={(versionId) => handleRestoreVersion(versionId).catch(() => undefined)}
          />
        </Suspense>
      ) : null}

      <input
        ref={importInputRef}
        type="file"
        accept=".md,text/markdown,text/plain"
        multiple
        className="hidden"
        onChange={(event) => {
          handleImportMarkdown(event.target.files).catch((error) => toast.error(getErrorMessage(error, "导入失败")));
          event.currentTarget.value = "";
        }}
      />

      {commandOpen ? (
        <Suspense fallback={<CommandPaletteFallback />}>
          <CommandPalette
            open={commandOpen}
            notes={[...notes, ...recentNotes]}
            folders={folders}
            tags={tags}
            onOpenChange={setCommandOpen}
            onViewChange={handleViewChange}
            onSelectNote={(id: string) => selectNote(id).catch(() => undefined)}
            onTagSelect={(id: string) => navigateToListView("all", { tagId: id })}
            onCreateNote={() => openTemplatePicker("create")}
            onQuickCapture={() => setQuickCaptureOpen(true)}
            onOpenTodayDailyNote={() => handleDailyNote().catch((error) => toast.error(getErrorMessage(error, "每日笔记打开失败")))}
            onOpenTemplatePicker={() => openTemplatePicker("create")}
            onDuplicateCurrent={() => handleDuplicateCurrent().catch((error) => toast.error(getErrorMessage(error, "复制笔记失败")))}
            onCopyInternalLink={() => handleCopyInternalLink().catch((error) => toast.error(getErrorMessage(error, "复制链接失败")))}
            onImportMarkdown={() => importInputRef.current?.click()}
            onExportCurrent={() => selectedNoteBase ? downloadNote(selectedNoteBase.id, "md").catch((error) => toast.error(getErrorMessage(error, "导出失败"))) : toast.error("请先选择一篇笔记")}
            onExportAll={() => handleExportAllFormat("zip").catch((error) => toast.error(getErrorMessage(error, "导出失败")))}
            onCreateDatabase={openCreateDatabaseDialog}
            onCreateFolder={openCreateFolderDialog}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
            onToggleFocusMode={() => setFocusMode(!focusMode)}
            focusMode={focusMode}
          />
        </Suspense>
      ) : null}

      {settingsOpen ? (
        <Suspense fallback={null}>
        <SettingsDialog
          open={settingsOpen}
          theme={theme}
          profile={profile}
          reminders={reminders}
          notes={notes}
          workspaces={workspaces}
          workspaceMembers={workspaceMembers}
          currentWorkspaceId={currentWorkspaceId}
          currentWorkspaceRole={currentWorkspaceRole}
          onOpenChange={setSettingsOpen}
          onThemeChange={setTheme}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onExportAllFormat={(format) => handleExportAllFormat(format).catch((error) => toast.error(getErrorMessage(error, "导出失败")))}
          onEmptyTrash={() =>
            setEmptyTrashOpen(true)
          }
          onLogout={() => handleLogout().catch(() => undefined)}
          onSaveProfile={async (payload) => {
            const updated = await updateProfile(payload);
            setProfile(updated);
            setUser(updated);
            toast.success("个人资料已保存");
          }}
          onUploadAvatar={async (file) => {
            try {
              const updated = await uploadAvatar(file);
              setProfile(updated);
              setUser(updated);
              toast.success("头像已更新");
            } catch (error) {
              toast.error(getErrorMessage(error, "头像上传失败"));
            }
          }}
          onCreateReminder={handleCreateReminder}
          onToggleReminderComplete={handleToggleReminderComplete}
          onDeleteReminder={(id) => {
            setReminderDeleteTargetId(id);
            return Promise.resolve();
          }}
          onCreateWorkspace={(name) => handleCreateWorkspace(name)}
          onSwitchWorkspace={(workspaceId) => handleSwitchWorkspace(workspaceId)}
          onInviteWorkspaceMember={(payload) => handleInviteWorkspaceMember(payload)}
        />
        </Suspense>
      ) : null}

      {Boolean(shareDialogNoteId && shareDialogNote) ? (
        <Suspense fallback={null}>
        <ShareDialog
          open={Boolean(shareDialogNoteId && shareDialogNote)}
          noteTitle={shareDialogNote?.title}
          canInvite={currentWorkspaceRole === "owner"}
          canCreatePublicShare={!isWorkspaceReadonly}
          publicShareSummary={publicShareSummary}
          onOpenChange={(open) => {
            if (!open) {
              closeShareDialog();
            }
          }}
          onCopyDeepLink={() => {
            if (!shareDialogNoteId) throw new Error("请先选择要分享的笔记");
            return handleCopyNoteDeepLink(shareDialogNoteId);
          }}
          onCreatePublicShare={
            !isWorkspaceReadonly && shareDialogNoteId
              ? (expiresIn, password) => handleCreatePublicShare(shareDialogNoteId, expiresIn, password)
              : undefined
          }
          onRevokePublicShare={
            !isWorkspaceReadonly && shareDialogNoteId
              ? () => handleRevokePublicShare(shareDialogNoteId)
              : undefined
          }
          onCreateInvite={
            currentWorkspaceRole === "owner" && shareDialogNoteId
              ? (payload) => handleCreateNoteInvite(shareDialogNoteId, payload)
              : undefined
          }
        />
        </Suspense>
      ) : null}

      {quickReminderOpen ? (
        <Suspense fallback={null}>
          <ReminderQuickDialog
            open={quickReminderOpen}
            noteTitle={selectedNoteBase?.title}
            loading={quickReminderSaving}
            onOpenChange={setQuickReminderOpen}
            onSubmit={handleCreateQuickReminder}
          />
        </Suspense>
      ) : null}

      {shortcutsOpen ? (
        <Suspense fallback={null}>
          <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        </Suspense>
      ) : null}
    </>
  );
}


