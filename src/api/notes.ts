import { request, requestWithMeta } from "@/api/client";
import type {
  CreateNotePayload,
  GraphData,
  NoteAttachment,
  NoteLink,
  NoteVersion,
  NoteWithTags,
  NotesQuery,
  UpdateNotePayload,
  UpdateNoteTagsPayload,
} from "@/types/note";
import { ApiClientError } from "@/api/client";

function toQueryString(query?: NotesQuery) {
  if (!query) return "";
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.q) params.set("q", query.q);
  if (query.tag) params.set("tag", query.tag);
  if (query.folder !== undefined) params.set("folder", query.folder ?? "");
  if (query.favorite !== undefined) params.set("favorite", String(query.favorite));
  if (query.pinned !== undefined) params.set("pinned", String(query.pinned));
  if (query.archived !== undefined) params.set("archived", String(query.archived));
  if (query.recent !== undefined) params.set("recent", String(query.recent));
  if (query.daily !== undefined) params.set("daily", String(query.daily));
  if (query.dailyDate) params.set("dailyDate", query.dailyDate);
  if (query.deleted !== undefined) params.set("deleted", String(query.deleted));
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function getNotes(query?: NotesQuery) {
  return requestWithMeta<NoteWithTags[]>(`/api/notes${toQueryString(query)}`);
}

export function getTrashedNotes(query?: Omit<NotesQuery, "deleted">) {
  return requestWithMeta<NoteWithTags[]>(`/api/notes/trash${toQueryString(query)}`);
}

export function getRecentNotes() {
  return requestWithMeta<NoteWithTags[]>("/api/notes/recent?pageSize=20");
}

export function getInboxNotes(query?: Omit<NotesQuery, "folder" | "deleted">) {
  return requestWithMeta<NoteWithTags[]>(`/api/inbox${toQueryString(query)}`);
}

export function getTodayDailyNote() {
  return request<NoteWithTags>("/api/daily/today");
}

export function ensureTodayDailyNote() {
  return request<NoteWithTags>("/api/daily/today", { method: "POST" });
}

export function createNote(payload: CreateNotePayload) {
  return request<NoteWithTags>("/api/notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getNoteById(id: string) {
  return request<NoteWithTags>(`/api/notes/${id}`);
}

export function updateNote(id: string, payload: UpdateNotePayload) {
  return request<NoteWithTags>(`/api/notes/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteNote(id: string) {
  return request<{ id: string }>(`/api/notes/${id}`, {
    method: "DELETE",
  });
}

export function restoreNote(id: string) {
  return request<NoteWithTags>(`/api/notes/${id}/restore`, { method: "POST" });
}

export function deleteNotePermanent(id: string) {
  return request<{ id: string }>(`/api/notes/${id}/permanent`, { method: "DELETE" });
}

export function archiveNote(id: string) {
  return request<NoteWithTags>(`/api/notes/${id}/archive`, { method: "POST" });
}

export function unarchiveNote(id: string) {
  return request<NoteWithTags>(`/api/notes/${id}/unarchive`, { method: "POST" });
}

export function markNoteOpen(id: string) {
  return request<{ id: string }>(`/api/notes/${id}/open`, { method: "POST" });
}

export function openOrCreateWikiLink(title: string) {
  return request<NoteWithTags>("/api/notes/wiki-link", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function getNoteLinks(id: string) {
  return request<NoteLink[]>(`/api/links/${id}`);
}

export function getNoteBacklinks(id: string) {
  return request<NoteLink[]>(`/api/backlinks/${id}`);
}

export function getGraph() {
  return request<GraphData>("/api/graph");
}

export function getLocalGraph(id: string) {
  return request<GraphData>(`/api/graph/local/${id}`);
}

export function rebuildNoteLinks(id: string) {
  return request<NoteLink[]>(`/api/notes/${id}/links/rebuild`, { method: "POST" });
}

export function clearTrash() {
  return request<{ cleared: boolean }>("/api/notes/trash/empty", {
    method: "DELETE",
  });
}

export function updateNoteTags(id: string, payload: UpdateNoteTagsPayload) {
  return request<NoteWithTags>(`/api/notes/${id}/tags`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getNoteVersions(noteId: string) {
  return request<NoteVersion[]>(`/api/notes/${noteId}/versions`);
}

export function restoreNoteVersion(noteId: string, versionId: string) {
  return request<NoteWithTags>(`/api/notes/${noteId}/versions/${versionId}/restore`, {
    method: "POST",
  });
}

export function listNoteAttachments(noteId: string) {
  return request<NoteAttachment[]>(`/api/notes/${noteId}/attachments`);
}

export function uploadNoteAttachment(noteId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return fetch(`/api/notes/${noteId}/attachments`, {
    method: "POST",
    body: formData,
  }).then(async (response) => {
    const json = (await response.json().catch(() => null)) as
      | { success?: boolean; data?: unknown; error?: { code?: string; message?: string } }
      | null;
    if (!response.ok || !json?.success) {
      const code = json?.error?.code ?? "HTTP_ERROR";
      const message = json?.error?.message ?? "上传附件失败";
      throw new ApiClientError(code, message);
    }
    return json.data as { id: string; markdown_url: string; file_name: string; mime_type: string; size: number };
  });
}

export function deleteNoteAttachment(noteId: string, attachmentId: string) {
  return request<{ ok: boolean }>(`/api/notes/${noteId}/attachments/${attachmentId}`, {
    method: "DELETE",
  });
}
