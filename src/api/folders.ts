import { request } from "@/api/client";
import type { CreateFolderPayload, Folder, UpdateFolderPayload } from "@/types/note";

export function getFolders() {
  return request<Folder[]>("/api/folders");
}

export function createFolder(payload: CreateFolderPayload) {
  return request<Folder>("/api/folders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateFolder(id: string, payload: UpdateFolderPayload) {
  return request<Folder>(`/api/folders/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteFolder(id: string) {
  return request<{ id: string }>(`/api/folders/${id}`, {
    method: "DELETE",
  });
}
