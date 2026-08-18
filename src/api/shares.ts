import { request } from "@/api/client";
import type { PublicNoteShare, PublicSharedNote } from "@/types/note";

export function createPublicNoteShare(noteId: string, expires_in?: number | null, password?: string | null) {
  return request<PublicNoteShare>(`/api/notes/${noteId}/public-share`, {
    method: "POST",
    body: JSON.stringify({ expires_in, password }),
  });
}

export function getPublicSharedNote(token: string, password?: string | null) {
  const query = password ? `?password=${encodeURIComponent(password)}` : "";
  return request<PublicSharedNote>(`/api/public/notes/${encodeURIComponent(token)}${query}`);
}

export function revokePublicNoteShare(noteId: string) {
  return request<{ revoked: true }>(`/api/notes/${noteId}/public-share/revoke`, {
    method: "POST",
  });
}

export function getPublicNoteShareSummary(noteId: string) {
  return request<{ active: boolean; expires_at: string | null }>(`/api/notes/${noteId}/public-share`);
}
