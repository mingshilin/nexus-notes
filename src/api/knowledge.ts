import { request } from "@/api/client";
import type {
  AttachmentCenterItem,
  CommentThreadItem,
  FeedLog,
  ImportJob,
  KnowledgeDiagnostic,
  NotificationItem,
  OfflineDraft,
  SavedSearch,
  SavedSearchFilters,
} from "@/types/knowledge";
import type { NoteWithTags } from "@/types/note";

export function listActivity() {
  return request<FeedLog[]>("/api/activity");
}

export function listAudit() {
  return request<FeedLog[]>("/api/audit");
}

export function listComments(target: { noteId?: string | null; databaseId?: string | null }) {
  const params = new URLSearchParams();
  if (target.noteId) params.set("noteId", target.noteId);
  if (target.databaseId) params.set("databaseId", target.databaseId);
  return request<CommentThreadItem[]>(`/api/comments?${params.toString()}`);
}

export function createComment(payload: { note_id?: string | null; database_id?: string | null; body: string; mentions?: string[] }) {
  return request<CommentThreadItem[]>("/api/comments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listNotifications() {
  return request<NotificationItem[]>("/api/notifications");
}

export function markNotificationRead(id: string) {
  return request<NotificationItem[]>(`/api/notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead() {
  return request<NotificationItem[]>("/api/notifications/read-all", { method: "POST" });
}

export function listSavedSearches() {
  return request<SavedSearch[]>("/api/search/saved");
}

export function createSavedSearch(payload: { name: string; query: string; filters?: SavedSearchFilters }) {
  return request<SavedSearch[]>("/api/search/saved", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteSavedSearch(id: string) {
  return request<SavedSearch[]>(`/api/search/saved/${id}`, { method: "DELETE" });
}

export function getKnowledgeDiagnostics() {
  return request<KnowledgeDiagnostic>("/api/search/diagnostics");
}

export function listAttachmentCenter(filters: { query?: string; type?: string; status?: string; noteId?: string; from?: string; to?: string } | string = "") {
  const params = new URLSearchParams();
  if (typeof filters === "string") {
    if (filters.trim()) params.set("q", filters.trim());
  } else {
    if (filters.query?.trim()) params.set("q", filters.query.trim());
    if (filters.type && filters.type !== "all") params.set("type", filters.type);
    if (filters.status && filters.status !== "all") params.set("status", filters.status);
    if (filters.noteId?.trim()) params.set("noteId", filters.noteId.trim());
    if (filters.from?.trim()) params.set("from", filters.from.trim());
    if (filters.to?.trim()) params.set("to", filters.to.trim());
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<AttachmentCenterItem[]>(`/api/attachments${suffix}`);
}

export function runAttachmentOcr(id: string, payload: string | { text?: string; status?: AttachmentCenterItem["ocr_status"]; error?: string } = {}) {
  const body = typeof payload === "string" ? { text: payload } : payload;
  return request<AttachmentCenterItem>(`/api/attachments/${id}/ocr`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function clipperCapture(payload: { title: string; url?: string; content?: string; target?: "inbox" | "daily" | "database"; database_id?: string | null }) {
  return request<NoteWithTags>("/api/clipper/capture", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function importMarkdownItems(items: Array<{ title: string; content: string }>) {
  return request<{ job: ImportJob; notes: NoteWithTags[] }>("/api/import/markdown", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export function listImportJobs() {
  return request<ImportJob[]>("/api/import/jobs");
}

export function listOfflineDrafts() {
  return request<OfflineDraft[]>("/api/offline/drafts");
}

export function saveOfflineDraft(payload: { id?: string; note_id?: string | null; title: string; content: string }) {
  return request<OfflineDraft[]>("/api/offline/drafts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function syncOfflineDraft(id: string) {
  return request<NoteWithTags>(`/api/offline/drafts/${id}/sync`, { method: "POST" });
}

export function getCalendarFeed() {
  return request<{
    reminders: Array<{ id: string; note_id: string | null; title: string; due_at: string }>;
    daily: Array<{ id: string; title: string; daily_date: string }>;
    database_dates: Array<{ id: string; title: string; date: string }>;
  }>("/api/calendar/feed");
}
