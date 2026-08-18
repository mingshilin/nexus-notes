import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  getDatabaseFieldPermissions,
  getDatabasePermissions,
  getDatabaseProperties,
  updateDatabaseFieldPermissions,
  updateDatabasePermissions,
} from "@/api/databases";
import {
  clipperCapture,
  createComment,
  createSavedSearch,
  deleteSavedSearch,
  getCalendarFeed,
  getKnowledgeDiagnostics,
  importMarkdownItems,
  listActivity,
  listAttachmentCenter,
  listAudit,
  listComments,
  listImportJobs,
  listNotifications,
  listOfflineDrafts,
  listSavedSearches,
  markAllNotificationsRead,
  markNotificationRead,
  runAttachmentOcr,
  saveOfflineDraft,
  syncOfflineDraft,
} from "@/api/knowledge";
import { deleteNoteAttachment, updateNote, updateNoteTags } from "@/api/notes";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  displayText,
  type DuplicateTitleGroup,
  type FieldPermissionRow,
  type FeedLogWithKind,
  type KnowledgeTab,
  type PermissionEntry,
  tabs,
  type WorkspaceRole,
  workspaceRoles,
} from "@/components/knowledge/KnowledgeCenterShared";
import { AttachmentsOcrTab } from "@/components/knowledge/tabs/AttachmentsOcrTab";
import { CalendarAiTab } from "@/components/knowledge/tabs/CalendarAiTab";
import { CollaborationSecurityTab } from "@/components/knowledge/tabs/CollaborationSecurityTab";
import { ImportCaptureTab } from "@/components/knowledge/tabs/ImportCaptureTab";
import { OverviewTab } from "@/components/knowledge/tabs/OverviewTab";
import { SmartViewsTab } from "@/components/knowledge/tabs/SmartViewsTab";
import { cn } from "@/lib/utils";
import type { Database, DatabasePermissionRole } from "@/types/database";
import type { AttachmentCenterItem, CommentThreadItem, FeedLog, ImportJob, KnowledgeDiagnostic, NotificationItem, OfflineDraft, SavedSearch, SavedSearchFilters, SavedSearchSourceType } from "@/types/knowledge";
import type { Folder, NoteWithTags, Reminder, Tag } from "@/types/note";
import type { WorkspaceMember } from "@/types/workspace";

interface KnowledgeCenterPageProps {
  notes: NoteWithTags[];
  reminders: Reminder[];
  databases: Database[];
  selectedNoteId: string | null;
  workspaceMembers: WorkspaceMember[];
  readOnly: boolean;
  onOpenNote: (id: string) => void;
  onNoteCreated: (note: NoteWithTags) => void;
  onApplySavedSearch?: (query: string, filters?: SavedSearchFilters) => void;
}

function parseMarkdownImport(text: string) {
  return text
    .split(/\n---+\n/g)
    .map((block, index) => {
      const content = block.trim();
      const first = content.split(/\r?\n/)[0]?.replace(/^#\s*/, "").trim();
      return { title: first || `Imported ${index + 1}`, content };
    })
    .filter((item) => item.content);
}

const defaultSourceTypes: SavedSearchSourceType[] = ["notes", "attachments", "ocr"];
const ignoredOrphanStorageKey = "nexus-notes:ignored-orphan-notes";

function toggleString(current: string[], value: string) {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function uniqueById<T extends { id: string }>(items: T[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function textIncludesQuery(value: string | null | undefined, query: string) {
  return Boolean(value && value.toLowerCase().includes(query));
}

function createHitSource(label: string, value: string | null | undefined, query: string) {
  if (!textIncludesQuery(value, query)) return null;
  return { label, excerpt: value ?? "" };
}

export function KnowledgeCenterPage({
  notes,
  reminders,
  databases,
  selectedNoteId,
  workspaceMembers,
  readOnly,
  onOpenNote,
  onNoteCreated,
  onApplySavedSearch,
}: KnowledgeCenterPageProps) {
  const [tab, setTab] = useState<KnowledgeTab>("overview");
  const [activity, setActivity] = useState<FeedLog[]>([]);
  const [audit, setAudit] = useState<FeedLog[]>([]);
  const [comments, setComments] = useState<CommentThreadItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [diagnostics, setDiagnostics] = useState<KnowledgeDiagnostic | null>(null);
  const [attachments, setAttachments] = useState<AttachmentCenterItem[]>([]);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [offlineDrafts, setOfflineDrafts] = useState<OfflineDraft[]>([]);
  const [calendarFeed, setCalendarFeed] = useState<Awaited<ReturnType<typeof getCalendarFeed>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [classifyingUnorganized, setClassifyingUnorganized] = useState(false);
  const [taggingOrphans, setTaggingOrphans] = useState(false);
  const [ignoredOrphanIds, setIgnoredOrphanIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(ignoredOrphanStorageKey) ?? "[]") as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  });
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activityFilter, setActivityFilter] = useState("");
  const [savedSearchName, setSavedSearchName] = useState("");
  const [savedSearchQuery, setSavedSearchQuery] = useState("");
  const [activeSearchQuery, setActiveSearchQuery] = useState("");
  const [activeSearchFilters, setActiveSearchFilters] = useState<SavedSearchFilters>({});
  const [savedFilterSourceTypes, setSavedFilterSourceTypes] = useState<SavedSearchSourceType[]>(defaultSourceTypes);
  const [savedFilterTagIds, setSavedFilterTagIds] = useState<string[]>([]);
  const [savedFilterFolderIds, setSavedFilterFolderIds] = useState<string[]>([]);
  const [savedFilterDatabaseIds, setSavedFilterDatabaseIds] = useState<string[]>([]);
  const [savedFilterMemberIds, setSavedFilterMemberIds] = useState<string[]>([]);
  const [savedFilterAttachmentTypes, setSavedFilterAttachmentTypes] = useState<string[]>([]);
  const [savedFilterAttachmentStatus, setSavedFilterAttachmentStatus] = useState<string[]>([]);

  const [commentBody, setCommentBody] = useState("");
  const [mentionIds, setMentionIds] = useState<string[]>([]);

  const [attachmentQuery, setAttachmentQuery] = useState("");
  const [attachmentType, setAttachmentType] = useState("all");
  const [attachmentStatus, setAttachmentStatus] = useState("all");
  const [attachmentNoteId, setAttachmentNoteId] = useState("");
  const [attachmentFrom, setAttachmentFrom] = useState("");
  const [attachmentTo, setAttachmentTo] = useState("");
  const [ocrBusyId, setOcrBusyId] = useState<string | null>(null);
  const [ocrBatchBusy, setOcrBatchBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState("");
  const [deleteAttachmentTarget, setDeleteAttachmentTarget] = useState<AttachmentCenterItem | null>(null);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);

  const [clipTitle, setClipTitle] = useState("");
  const [clipUrl, setClipUrl] = useState("");
  const [clipContent, setClipContent] = useState("");
  const [clipTarget, setClipTarget] = useState<"inbox" | "daily" | "database">("inbox");
  const [clipDatabaseId, setClipDatabaseId] = useState("");
  const [importText, setImportText] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftNoteId, setDraftNoteId] = useState("");

  const [permissionDatabaseId, setPermissionDatabaseId] = useState("");
  const [databasePermissions, setDatabasePermissions] = useState<PermissionEntry[]>([]);
  const [fieldPermissionRows, setFieldPermissionRows] = useState<FieldPermissionRow[]>([]);

  const selectedNote = useMemo(() => notes.find((note) => note.id === selectedNoteId) ?? null, [notes, selectedNoteId]);
  const selectedDatabase = useMemo(() => databases.find((database) => database.id === permissionDatabaseId) ?? null, [databases, permissionDatabaseId]);
  const memberMap = useMemo(() => new Map(workspaceMembers.map((member) => [member.user_id, member])), [workspaceMembers]);
  const unreadCount = notifications.filter((item) => !item.read_at).length;
  const dueCount = reminders.filter((item) => !item.completed_at && new Date(item.due_at).getTime() <= Date.now()).length;
  const importPreview = useMemo(() => parseMarkdownImport(importText), [importText]);
  const noteTitleSet = useMemo(() => new Set(notes.map((note) => displayText(note.title).trim().toLowerCase()).filter(Boolean)), [notes]);
  const visibleDiagnostics = useMemo(() => {
    if (!diagnostics || ignoredOrphanIds.length === 0) return diagnostics;
    const ignored = new Set(ignoredOrphanIds);
    return { ...diagnostics, orphan_notes: diagnostics.orphan_notes.filter((note) => !ignored.has(note.id)) };
  }, [diagnostics, ignoredOrphanIds]);
  const duplicateTitleGroups = useMemo<DuplicateTitleGroup[]>(() => {
    const groups = new Map<string, NoteWithTags[]>();
    for (const note of notes) {
      if (note.deleted_at || note.archived_at) continue;
      const title = displayText(note.title, "无标题").trim();
      if (!title) continue;
      const key = title.toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), note]);
    }
    return Array.from(groups.values())
      .filter((items) => items.length > 1)
      .map((items) => ({
        title: displayText(items[0].title, "无标题"),
        notes: items.map((note) => ({ id: note.id, title: note.title, content: note.content, updated_at: note.updated_at, tags: note.tags.map((tag) => ({ id: tag.id })) })),
      }));
  }, [notes]);
  const filterOptions = useMemo(() => ({
    tags: uniqueById(notes.flatMap((note) => note.tags)) as Tag[],
    folders: uniqueById(notes.map((note) => note.folder).filter((folder): folder is Folder => Boolean(folder))),
    databases,
    members: workspaceMembers,
  }), [databases, notes, workspaceMembers]);

  const filteredFeed = useMemo(() => {
    const query = activityFilter.trim().toLowerCase();
    const rows: FeedLogWithKind[] = [...audit.map((item) => ({ ...item, feedKind: "审计" })), ...activity.map((item) => ({ ...item, feedKind: "活动" }))];
    if (!query) return rows.slice(0, 40);
    return rows.filter((item) => `${item.action} ${item.entity_type} ${item.entity_id}`.toLowerCase().includes(query)).slice(0, 40);
  }, [activity, activityFilter, audit]);

  const searchResults = useMemo(() => {
    const query = activeSearchQuery.trim().toLowerCase();
    if (!query) return [];
    const sourceTypes = stringArray(activeSearchFilters.sourceTypes);
    const allowedSources = new Set(sourceTypes.length > 0 ? sourceTypes : defaultSourceTypes);
    const tagIds = new Set(stringArray(activeSearchFilters.tagIds));
    const folderIds = new Set(stringArray(activeSearchFilters.folderIds));
    const databaseIds = new Set(stringArray(activeSearchFilters.databaseIds));
    const attachmentTypes = new Set(stringArray(activeSearchFilters.attachmentTypes));
    const attachmentStatus = new Set(stringArray(activeSearchFilters.attachmentStatus));
    const noteById = new Map(notes.map((note) => [note.id, note]));
    const noteMatches = notes
      .filter((note) => {
        if (!allowedSources.has("notes")) return false;
        if (tagIds.size > 0 && !note.tags.some((tag) => tagIds.has(tag.id))) return false;
        if (folderIds.size > 0 && (!note.folder_id || !folderIds.has(note.folder_id))) return false;
        if (databaseIds.size > 0 && (!note.database_id || !databaseIds.has(note.database_id))) return false;
        const tagText = note.tags.map((tag) => tag.name).join(" ");
        const databaseValueText = Object.values(note.database_values ?? {})
          .flatMap((value) => [value.value_text, value.value_number?.toString(), value.value_boolean?.toString(), value.value_date, ...(value.value_json ?? [])])
          .filter(Boolean)
          .join(" ");
        return `${displayText(note.title)} ${note.content} ${tagText} ${displayText(note.folder?.name, "")} ${databaseValueText}`.toLowerCase().includes(query);
      })
      .slice(0, 12)
      .map((note) => {
        const tagText = note.tags.map((tag) => tag.name).join(" ");
        const databaseValueText = Object.values(note.database_values ?? {})
          .flatMap((value) => [value.value_text, value.value_number?.toString(), value.value_boolean?.toString(), value.value_date, ...(value.value_json ?? [])])
          .filter(Boolean)
          .join(" ");
        const title = displayText(note.title, "无标题");
        const hitSources = [
          createHitSource("标题", title, query),
          createHitSource("正文", note.content, query),
          createHitSource("标签", tagText, query),
          createHitSource("数据库属性", databaseValueText, query),
        ].filter((item): item is { label: string; excerpt: string } => Boolean(item));
        return { kind: "note" as const, id: note.id, title, detail: note.content || "正文无命中片段", noteId: note.id, hitSources };
      });
    const attachmentMatches = attachments
      .filter((item) => {
        const includeAttachments = allowedSources.has("attachments");
        const includeOcr = allowedSources.has("ocr");
        if (!includeAttachments && !includeOcr) return false;
        if (includeOcr && !includeAttachments && !item.ocr_text) return false;
        if (attachmentStatus.size > 0 && !attachmentStatus.has(item.ocr_status ?? "pending")) return false;
        const attachmentType = item.mime_type.startsWith("image/") ? "image" : item.mime_type.includes("pdf") ? "pdf" : "other";
        if (attachmentTypes.size > 0 && !attachmentTypes.has(attachmentType)) return false;
        const note = noteById.get(item.note_id);
        if (tagIds.size > 0 && !note?.tags.some((tag) => tagIds.has(tag.id))) return false;
        if (folderIds.size > 0 && (!note?.folder_id || !folderIds.has(note.folder_id))) return false;
        if (databaseIds.size > 0 && (!note?.database_id || !databaseIds.has(note.database_id))) return false;
        return `${item.file_name} ${item.mime_type} ${item.ocr_text ?? ""} ${item.note_title ?? ""}`.toLowerCase().includes(query);
      })
      .slice(0, 8)
      .map((item) => ({
        kind: "attachment" as const,
        id: item.id,
        title: item.file_name,
        detail: item.ocr_text || item.note_title || item.mime_type,
        noteId: item.note_id,
        hitSources: [
          createHitSource("附件名", item.file_name, query),
          createHitSource("OCR 文本", item.ocr_text, query),
        ].filter((source): source is { label: string; excerpt: string } => Boolean(source)),
      }));
    return [...noteMatches, ...attachmentMatches];
  }, [activeSearchFilters, activeSearchQuery, attachments, notes]);

  async function load(options: { silent?: boolean } = {}) {
    if (options.silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setLoadError(null);
    try {
      const [activityResp, auditResp, notificationResp, savedResp, diagnosticsResp, attachmentResp, importResp, draftResp, calendarResp] = await Promise.all([
        listActivity().catch(() => []),
        listAudit().catch(() => []),
        listNotifications().catch(() => []),
        listSavedSearches().catch(() => []),
        getKnowledgeDiagnostics().catch(() => null),
        listAttachmentCenter({ query: attachmentQuery, type: attachmentType, status: attachmentStatus, noteId: attachmentNoteId, from: attachmentFrom, to: attachmentTo }).catch(() => []),
        listImportJobs().catch(() => []),
        listOfflineDrafts().catch(() => []),
        getCalendarFeed().catch(() => null),
      ]);
      setActivity(activityResp);
      setAudit(auditResp);
      setNotifications(notificationResp);
      setSavedSearches(savedResp);
      setDiagnostics(diagnosticsResp);
      setAttachments(attachmentResp);
      setImportJobs(importResp);
      setOfflineDrafts(draftResp);
      setCalendarFeed(calendarResp);
      if (selectedNoteId) {
        setComments(await listComments({ noteId: selectedNoteId }).catch(() => []));
      } else {
        setComments([]);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "知识中心加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNoteId]);

  async function refreshAttachments() {
    setAttachments(await listAttachmentCenter({ query: attachmentQuery, type: attachmentType, status: attachmentStatus, noteId: attachmentNoteId, from: attachmentFrom, to: attachmentTo }));
  }

  async function submitSavedSearch() {
    const name = savedSearchName.trim();
    if (!name) return;
    const query = savedSearchQuery.trim();
    const filters: SavedSearchFilters = {
      query,
      sourceTypes: savedFilterSourceTypes,
      tagIds: savedFilterTagIds,
      folderIds: savedFilterFolderIds,
      databaseIds: savedFilterDatabaseIds,
      memberIds: savedFilterMemberIds,
      attachmentTypes: savedFilterAttachmentTypes,
      attachmentStatus: savedFilterAttachmentStatus,
      attachment: {
        query: attachmentQuery,
        type: attachmentType,
        status: attachmentStatus,
        noteId: attachmentNoteId,
        from: attachmentFrom,
        to: attachmentTo,
      },
      tagId: savedFilterTagIds[0],
      folderId: savedFilterFolderIds[0],
      databaseId: savedFilterDatabaseIds[0],
    };
    setSavedSearches(await createSavedSearch({
      name,
      query,
      filters,
    }));
    setSavedSearchName("");
    setSavedSearchQuery("");
    toast.success("智能视图已保存");
  }

  function applySavedSearch(item: SavedSearch) {
    setActiveSearchQuery(item.query);
    setActiveSearchFilters(item.filters ?? {});
    onApplySavedSearch?.(item.query, item.filters);
    toast.success(item.query ? `已应用搜索：${item.query}` : "已打开智能视图");
  }

  function clearActiveSearch() {
    setActiveSearchQuery("");
    setActiveSearchFilters({});
  }

  async function removeSavedSearch(id: string) {
    setSavedSearches(await deleteSavedSearch(id));
  }

  async function markEveryNotificationRead() {
    setNotifications(await markAllNotificationsRead());
  }

  async function markSingleNotificationRead(id: string) {
    setNotifications(await markNotificationRead(id));
  }

  function toggleMention(userId: string) {
    setMentionIds((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]);
  }

  function toggleSavedSourceType(value: SavedSearchSourceType) {
    setSavedFilterSourceTypes((current) => {
      const next = toggleString(current, value) as SavedSearchSourceType[];
      return next.length > 0 ? next : current;
    });
  }

  async function classifyUnorganizedNotes(target: { type: "inbox" | "folder" | "database"; id?: string }) {
    const items = diagnostics?.unorganized_notes ?? [];
    if (items.length === 0 || readOnly || classifyingUnorganized) return;
    if ((target.type === "folder" || target.type === "database") && !target.id) return;
    setClassifyingUnorganized(true);
    try {
      const payload = target.type === "inbox"
        ? { folder_id: null, database_id: null }
        : target.type === "folder"
          ? { folder_id: target.id ?? null, database_id: null }
          : { folder_id: null, database_id: target.id ?? null };
      const updated = await Promise.all(items.map((note) => updateNote(note.id, payload)));
      updated.forEach(onNoteCreated);
      setDiagnostics(await getKnowledgeDiagnostics().catch(() => diagnostics));
      toast.success(`已归类 ${updated.length} 篇未整理笔记`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "未整理笔记归类失败");
    } finally {
      setClassifyingUnorganized(false);
    }
  }

  async function tagOrphanNotes(tagId: string) {
    const items = visibleDiagnostics?.orphan_notes ?? [];
    if (!tagId || items.length === 0 || readOnly || taggingOrphans) return;
    setTaggingOrphans(true);
    try {
      const noteMap = new Map(notes.map((note) => [note.id, note]));
      const updated = await Promise.all(items.map((item) => {
        const note = noteMap.get(item.id);
        const currentTagIds = note?.tags.map((tag) => tag.id) ?? [];
        const tagIds = currentTagIds.includes(tagId) ? currentTagIds : [...currentTagIds, tagId];
        return updateNoteTags(item.id, { tagIds });
      }));
      updated.forEach(onNoteCreated);
      setDiagnostics(await getKnowledgeDiagnostics().catch(() => diagnostics));
      toast.success(`已为 ${updated.length} 篇孤立笔记添加标签`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "孤立笔记加标签失败");
    } finally {
      setTaggingOrphans(false);
    }
  }

  function ignoreOrphanNotes() {
    const ids = (visibleDiagnostics?.orphan_notes ?? []).map((note) => note.id);
    if (ids.length === 0) return;
    setIgnoredOrphanIds((current) => {
      const next = Array.from(new Set([...current, ...ids]));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ignoredOrphanStorageKey, JSON.stringify(next));
      }
      return next;
    });
    toast.success(`已忽略 ${ids.length} 篇孤立笔记`);
  }

  async function renameDuplicateNote(noteId: string, currentTitle: string) {
    if (readOnly) return;
    const nextTitle = window.prompt("输入新的笔记标题", currentTitle)?.trim();
    if (!nextTitle || nextTitle === currentTitle) return;
    try {
      const updated = await updateNote(noteId, { title: nextTitle });
      onNoteCreated(updated);
      setDiagnostics(await getKnowledgeDiagnostics().catch(() => diagnostics));
      toast.success("重复标题已重命名");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重命名失败");
    }
  }

  async function mergeDuplicateTitleGroup(group: DuplicateTitleGroup) {
    if (readOnly || group.notes.length < 2) return;
    const [primary, ...rest] = group.notes;
    try {
      const mergedContent = [
        primary.content,
        ...rest.map((note) => `\n\n---\n\n# ${displayText(note.title, "无标题")}\n\n${note.content}`),
      ].join("").trim();
      const tagIds = Array.from(new Set(group.notes.flatMap((note) => note.tags.map((tag) => tag.id))));
      const updated = await updateNote(primary.id, { content: mergedContent });
      const updatedWithTags = tagIds.length > 0 ? await updateNoteTags(primary.id, { tagIds }) : updated;
      onNoteCreated(updatedWithTags);
      onOpenNote(primary.id);
      setDiagnostics(await getKnowledgeDiagnostics().catch(() => diagnostics));
      toast.success(`已合并 ${group.notes.length} 篇同名笔记到主笔记`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重复标题合并失败");
    }
  }

  async function submitComment() {
    if (!selectedNoteId || !commentBody.trim()) return;
    const body = commentBody.trim();
    const commentsResp = await createComment({ note_id: selectedNoteId, body, mentions: mentionIds });
    setComments(commentsResp);
    setCommentBody("");
    setMentionIds([]);
    toast.success(mentionIds.length ? "评论已发布，并已通知提及成员" : "评论已发布");
  }

  async function submitClip() {
    const note = await clipperCapture({
      title: clipTitle || clipUrl || "Web Clip",
      url: clipUrl || undefined,
      content: clipContent,
      target: clipTarget,
      database_id: clipTarget === "database" ? clipDatabaseId || databases[0]?.id || null : null,
    });
    onNoteCreated(note);
    onOpenNote(note.id);
    setClipTitle("");
    setClipUrl("");
    setClipContent("");
    toast.success("捕获内容已保存");
  }

  async function submitImport() {
    if (importPreview.length === 0) return;
    const result = await importMarkdownItems(importPreview);
    result.notes.forEach(onNoteCreated);
    setImportText("");
    setImportJobs((current) => result.job ? [result.job, ...current] : current);
    const warningCount = result.job?.warnings?.length ?? 0;
    toast.success(warningCount ? `已导入 ${result.notes.length} 篇，发现 ${warningCount} 条提示` : `已导入 ${result.notes.length} 篇笔记`);
  }

  async function submitDraft() {
    setOfflineDrafts(await saveOfflineDraft({ title: draftTitle, content: draftContent, note_id: draftNoteId || null }));
    setDraftTitle("");
    setDraftContent("");
    setDraftNoteId("");
    toast.success("离线草稿已保存");
  }

  async function syncDraft(draft: OfflineDraft) {
    try {
      const note = await syncOfflineDraft(draft.id);
      onNoteCreated(note);
      setOfflineDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, status: "synced", note_id: note.id, synced_at: new Date().toISOString() } : item));
      onOpenNote(note.id);
      toast.success("草稿已同步为笔记");
    } catch (error) {
      const message = error instanceof Error && error.message.includes("target note changed")
        ? "目标笔记在草稿保存后已更新，请先打开笔记确认后再同步。"
        : error instanceof Error ? error.message : "草稿同步失败";
      if (error instanceof Error && error.message.includes("target note changed")) {
        setOfflineDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, status: "conflict", conflict_note_id: item.note_id, conflict_reason: message } : item));
      }
      toast.error(message);
    }
  }

  async function recognizeAttachmentItem(item: AttachmentCenterItem) {
    setOcrBusyId(item.id);
    setOcrProgress("准备识别...");
    try {
      const processing = await runAttachmentOcr(item.id, { status: "processing" });
      setAttachments((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...processing } : entry));
      const { recognizeAttachment } = await import("@/lib/ocrEngine");
      const text = await recognizeAttachment({
        url: `/api/attachments/${item.id}/file`,
        mimeType: item.mime_type,
        fileName: item.file_name,
        onProgress: (message, progress) => setOcrProgress(`${message} ${Math.round(progress * 100)}%`),
      });
      const updated = await runAttachmentOcr(item.id, { status: "ready", text });
      setAttachments((current) => current.map((entry) => entry.id === updated.id ? { ...entry, ...updated } : entry));
      toast.success("OCR 识别完成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "OCR 识别失败";
      const failed = await runAttachmentOcr(item.id, { status: "failed", error: message }).catch(() => null);
      if (failed) setAttachments((current) => current.map((entry) => entry.id === failed.id ? { ...entry, ...failed } : entry));
      toast.error(message);
    } finally {
      setOcrBusyId(null);
      setOcrProgress("");
    }
  }

  async function retryFailedAttachments() {
    const failedItems = attachments.filter((item) => item.ocr_status === "failed");
    if (failedItems.length === 0 || readOnly || ocrBatchBusy) return;
    setOcrBatchBusy(true);
    try {
      for (const item of failedItems) {
        await recognizeAttachmentItem(item);
      }
      toast.success(`已重试 ${failedItems.length} 个失败附件`);
    } finally {
      setOcrBatchBusy(false);
    }
  }

  async function confirmDeleteAttachment() {
    if (!deleteAttachmentTarget || readOnly) return;
    const target = deleteAttachmentTarget;
    setDeletingAttachmentId(target.id);
    try {
      await deleteNoteAttachment(target.note_id, target.id);
      setAttachments((current) => current.filter((item) => item.id !== target.id));
      setDeleteAttachmentTarget(null);
      toast.success("附件已删除");
    } catch (error) {
      const message = error instanceof Error ? error.message : "附件删除失败";
      toast.error(message);
    } finally {
      setDeletingAttachmentId(null);
    }
  }

  async function loadPermissionDatabase(databaseId: string) {
    setPermissionDatabaseId(databaseId);
    if (!databaseId) {
      setDatabasePermissions([]);
      setFieldPermissionRows([]);
      return;
    }
    const [permissions, properties] = await Promise.all([
      getDatabasePermissions(databaseId).catch(() => []),
      getDatabaseProperties(databaseId).catch(() => []),
    ]);
    setDatabasePermissions(permissions.map((permission) => ({
      subject_type: permission.subject_type,
      subject_id: permission.subject_id,
      role: permission.role,
    })));
    const rows = await Promise.all(
      properties
        .filter((property) => property.type !== "title")
        .map(async (property) => {
          const permission = await getDatabaseFieldPermissions(databaseId, property.id).catch(() => null);
          return {
            id: property.id,
            name: property.name,
            viewer_roles: ((permission?.viewer_roles ?? ["owner", "editor", "viewer"]) as WorkspaceRole[]).filter((role) => workspaceRoles.includes(role)),
            editor_roles: ((permission?.editor_roles ?? ["owner", "editor"]) as WorkspaceRole[]).filter((role) => workspaceRoles.includes(role)),
          };
        }),
    );
    setFieldPermissionRows(rows);
  }

  function setDatabasePermission(subjectType: "workspace_role" | "member", subjectId: string, role: DatabasePermissionRole | "inherit") {
    setDatabasePermissions((current) => {
      const next = current.filter((item) => !(item.subject_type === subjectType && item.subject_id === subjectId));
      if (role === "inherit") return next;
      return [...next, { subject_type: subjectType, subject_id: subjectId, role }];
    });
  }

  function toggleFieldRole(propertyId: string, field: "viewer_roles" | "editor_roles", role: WorkspaceRole) {
    setFieldPermissionRows((current) => current.map((row) => {
      if (row.id !== propertyId) return row;
      const exists = row[field].includes(role);
      return { ...row, [field]: exists ? row[field].filter((item) => item !== role) : [...row[field], role] };
    }));
  }

  async function savePermissionDatabase() {
    if (!permissionDatabaseId) return;
    await updateDatabasePermissions(permissionDatabaseId, databasePermissions);
    for (const row of fieldPermissionRows) {
      await updateDatabaseFieldPermissions(permissionDatabaseId, row.id, {
        viewer_roles: row.viewer_roles,
        editor_roles: row.editor_roles,
      });
    }
    toast.success("权限设置已保存");
  }

  if (loading) {
    return (
      <div className="flex h-full min-w-0 items-center justify-center overflow-x-hidden bg-[var(--surface-editor)] text-sm text-muted-foreground">
        正在加载知识中心...
      </div>
    );
  }

  return (
    <div className="h-full min-w-0 overflow-y-auto bg-[var(--surface-editor)] md:flex md:flex-col md:overflow-hidden">
      <div className="min-w-0 border-b px-3 py-3 sm:px-5 sm:py-4" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">Knowledge OS</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">知识中心</h2>
            <p className="mt-1 text-sm text-muted-foreground">集中处理智能视图、协作通知、附件 OCR、捕获导入、离线草稿和统一日历。</p>
          </div>
          <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => void load({ silent: true })} disabled={refreshing}>
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            刷新
          </Button>
        </div>
        {loadError ? <div className="mt-3 rounded-[14px] border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{loadError}</div> : null}
        <div className="scrollbar-subtle mt-3 flex gap-1.5 overflow-x-auto pb-0.5 sm:mt-4 sm:gap-2 sm:pb-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-[12px] px-2.5 py-1.5 text-xs transition sm:gap-2 sm:px-3 sm:py-2 sm:text-sm",
                tab === item.id ? "bg-primary text-primary-foreground" : "bg-white/65 text-foreground/75 hover:bg-white dark:bg-white/[0.05]",
              )}
              onClick={() => setTab(item.id)}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {item.id === "collab" && unreadCount > 0 ? <span className="rounded-full bg-red-500 px-1.5 text-[10px] text-white">{unreadCount}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3 sm:p-5 md:min-h-0 md:flex-1 md:overflow-y-auto">
        {tab === "overview" ? (
          <OverviewTab
            unreadCount={unreadCount}
            dueCount={dueCount}
            diagnostics={visibleDiagnostics}
            attachments={attachments}
            offlineDrafts={offlineDrafts}
            activity={activity}
          />
        ) : null}

        {tab === "smart" ? (
          <SmartViewsTab
            savedSearchName={savedSearchName}
            savedSearchQuery={savedSearchQuery}
            savedSearches={savedSearches}
            activeSearchQuery={activeSearchQuery}
            searchResults={searchResults}
            diagnostics={visibleDiagnostics}
            duplicateTitleGroups={duplicateTitleGroups}
            readOnly={readOnly}
            selectedSourceTypes={savedFilterSourceTypes}
            selectedTagIds={savedFilterTagIds}
            selectedFolderIds={savedFilterFolderIds}
            selectedDatabaseIds={savedFilterDatabaseIds}
            selectedMemberIds={savedFilterMemberIds}
            selectedAttachmentTypes={savedFilterAttachmentTypes}
            selectedAttachmentStatus={savedFilterAttachmentStatus}
            filterOptions={filterOptions}
            classifyingUnorganized={classifyingUnorganized}
            taggingOrphans={taggingOrphans}
            onSavedSearchNameChange={setSavedSearchName}
            onSavedSearchQueryChange={setSavedSearchQuery}
            onToggleSourceType={toggleSavedSourceType}
            onToggleTag={(id) => setSavedFilterTagIds((current) => toggleString(current, id))}
            onToggleFolder={(id) => setSavedFilterFolderIds((current) => toggleString(current, id))}
            onToggleDatabase={(id) => setSavedFilterDatabaseIds((current) => toggleString(current, id))}
            onToggleMember={(id) => setSavedFilterMemberIds((current) => toggleString(current, id))}
            onToggleAttachmentType={(id) => setSavedFilterAttachmentTypes((current) => toggleString(current, id))}
            onToggleAttachmentStatus={(id) => setSavedFilterAttachmentStatus((current) => toggleString(current, id))}
            onSubmitSavedSearch={submitSavedSearch}
            onApplySavedSearch={applySavedSearch}
            onDeleteSavedSearch={removeSavedSearch}
            onClearActiveSearch={clearActiveSearch}
            onOpenNote={onOpenNote}
            onClassifyUnorganized={classifyUnorganizedNotes}
            onTagOrphanNotes={tagOrphanNotes}
            onIgnoreOrphanNotes={ignoreOrphanNotes}
            onRenameDuplicateNote={renameDuplicateNote}
            onMergeDuplicateTitleGroup={mergeDuplicateTitleGroup}
          />
        ) : null}

        {tab === "collab" ? (
          <CollaborationSecurityTab
            unreadCount={unreadCount}
            readOnly={readOnly}
            notifications={notifications}
            selectedNote={selectedNote}
            selectedNoteId={selectedNoteId}
            commentBody={commentBody}
            mentionIds={mentionIds}
            workspaceMembers={workspaceMembers}
            comments={comments}
            memberMap={memberMap}
            activityFilter={activityFilter}
            filteredFeed={filteredFeed}
            databases={databases}
            permissionDatabaseId={permissionDatabaseId}
            selectedDatabase={selectedDatabase}
            databasePermissions={databasePermissions}
            fieldPermissionRows={fieldPermissionRows}
            onMarkAllNotificationsRead={markEveryNotificationRead}
            onMarkNotificationRead={markSingleNotificationRead}
            onCommentBodyChange={setCommentBody}
            onToggleMention={toggleMention}
            onSubmitComment={submitComment}
            onActivityFilterChange={setActivityFilter}
            onLoadPermissionDatabase={loadPermissionDatabase}
            onSetDatabasePermission={setDatabasePermission}
            onToggleFieldRole={toggleFieldRole}
            onSavePermissionDatabase={savePermissionDatabase}
          />
        ) : null}

        {tab === "attachments" ? (
          <AttachmentsOcrTab
            attachments={attachments}
            notes={notes}
            readOnly={readOnly}
            attachmentQuery={attachmentQuery}
            attachmentType={attachmentType}
            attachmentStatus={attachmentStatus}
            attachmentNoteId={attachmentNoteId}
            attachmentFrom={attachmentFrom}
            attachmentTo={attachmentTo}
            ocrBusyId={ocrBusyId}
            ocrBatchBusy={ocrBatchBusy}
            ocrProgress={ocrProgress}
            deletingAttachmentId={deletingAttachmentId}
            onAttachmentQueryChange={setAttachmentQuery}
            onAttachmentTypeChange={setAttachmentType}
            onAttachmentStatusChange={setAttachmentStatus}
            onAttachmentNoteIdChange={setAttachmentNoteId}
            onAttachmentFromChange={setAttachmentFrom}
            onAttachmentToChange={setAttachmentTo}
            onRefreshAttachments={refreshAttachments}
            onOpenNote={onOpenNote}
            onRecognizeAttachment={recognizeAttachmentItem}
            onRetryFailedAttachments={retryFailedAttachments}
            onDeleteAttachment={setDeleteAttachmentTarget}
          />
        ) : null}

        {tab === "capture" ? (
          <ImportCaptureTab
            databases={databases}
            notes={notes}
            readOnly={readOnly}
            clipTitle={clipTitle}
            clipUrl={clipUrl}
            clipContent={clipContent}
            clipTarget={clipTarget}
            clipDatabaseId={clipDatabaseId}
            importText={importText}
            importPreview={importPreview}
            importJobs={importJobs}
            draftTitle={draftTitle}
            draftContent={draftContent}
            draftNoteId={draftNoteId}
            offlineDrafts={offlineDrafts}
            noteTitleSet={noteTitleSet}
            onClipTitleChange={setClipTitle}
            onClipUrlChange={setClipUrl}
            onClipContentChange={setClipContent}
            onClipTargetChange={setClipTarget}
            onClipDatabaseIdChange={setClipDatabaseId}
            onImportTextChange={setImportText}
            onDraftTitleChange={setDraftTitle}
            onDraftContentChange={setDraftContent}
            onDraftNoteIdChange={setDraftNoteId}
            onSubmitClip={submitClip}
            onSubmitImport={submitImport}
            onSubmitDraft={submitDraft}
            onSyncDraft={syncDraft}
            onOpenNote={onOpenNote}
          />
        ) : null}

        {tab === "calendar" || tab === "ai" ? (
          <CalendarAiTab mode={tab} calendarFeed={calendarFeed} onOpenNote={onOpenNote} />
        ) : null}
      </div>
      <ConfirmDialog
        open={Boolean(deleteAttachmentTarget)}
        title="删除附件"
        description={`确定删除「${displayText(deleteAttachmentTarget?.file_name, "附件")}」吗？这会移除原文件和 OCR 文本，但不会删除笔记正文中的链接。`}
        confirmLabel={deletingAttachmentId ? "删除中..." : "删除"}
        destructive
        onOpenChange={(open) => {
          if (!open && !deletingAttachmentId) setDeleteAttachmentTarget(null);
        }}
        onConfirm={() => void confirmDeleteAttachment()}
      />
    </div>
  );
}
