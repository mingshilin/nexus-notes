import { request } from "@/api/client";
import type {
  BatchDatabaseNotesPayload,
  CreateDatabaseViewPayload,
  CreateDatabasePayload,
  CreateDatabasePropertyPayload,
  CreateDatabaseTemplatePayload,
  Database,
  DatabaseDuplicateGroup,
  DatabaseFieldPermission,
  DatabasePermission,
  DatabaseProperty,
  DatabaseRecordTemplate,
  DatabaseView,
  UpdateDatabaseNoteValuesPayload,
  UpdateDatabasePayload,
  UpdateDatabasePropertyPayload,
  UpdateDatabaseTemplatePayload,
  UpdateDatabaseViewPayload,
} from "@/types/database";
import type { NoteWithTags } from "@/types/note";

export function getDatabases() {
  return request<Database[]>("/api/databases");
}

export function createDatabase(payload: CreateDatabasePayload) {
  return request<Database>("/api/databases", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getDatabaseById(id: string) {
  return request<Database>(`/api/databases/${id}`);
}

export function updateDatabase(id: string, payload: UpdateDatabasePayload) {
  return request<Database>(`/api/databases/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteDatabase(id: string) {
  return request<{ id: string }>(`/api/databases/${id}`, {
    method: "DELETE",
  });
}

export function getDatabaseNotes(id: string) {
  return request<NoteWithTags[]>(`/api/databases/${id}/notes`);
}

export function createDatabaseNote(id: string, templateId?: string | null) {
  const query = templateId ? `?templateId=${encodeURIComponent(templateId)}` : "";
  return request<NoteWithTags>(`/api/databases/${id}/notes${query}`, {
    method: "POST",
  });
}

export function getDatabaseProperties(id: string) {
  return request<DatabaseProperty[]>(`/api/databases/${id}/properties`);
}

export function getDatabaseViews(id: string) {
  return request<DatabaseView[]>(`/api/databases/${id}/views`);
}

export function createDatabaseView(id: string, payload: CreateDatabaseViewPayload) {
  return request<DatabaseView[]>(`/api/databases/${id}/views`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateDatabaseView(databaseId: string, viewId: string, payload: UpdateDatabaseViewPayload) {
  return request<DatabaseView[]>(`/api/databases/${databaseId}/views/${viewId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteDatabaseView(databaseId: string, viewId: string) {
  return request<DatabaseView[]>(`/api/databases/${databaseId}/views/${viewId}`, {
    method: "DELETE",
  });
}

export function getDatabaseTemplates(id: string) {
  return request<DatabaseRecordTemplate[]>(`/api/databases/${id}/templates`);
}

export function createDatabaseTemplate(id: string, payload: CreateDatabaseTemplatePayload) {
  return request<DatabaseRecordTemplate[]>(`/api/databases/${id}/templates`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateDatabaseTemplate(databaseId: string, templateId: string, payload: UpdateDatabaseTemplatePayload) {
  return request<DatabaseRecordTemplate[]>(`/api/databases/${databaseId}/templates/${templateId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteDatabaseTemplate(databaseId: string, templateId: string) {
  return request<DatabaseRecordTemplate[]>(`/api/databases/${databaseId}/templates/${templateId}`, {
    method: "DELETE",
  });
}

export function batchDatabaseNotes(databaseId: string, payload: BatchDatabaseNotesPayload) {
  return request<NoteWithTags[]>(`/api/databases/${databaseId}/notes/batch`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getDatabaseDuplicateGroups(databaseId: string) {
  return request<DatabaseDuplicateGroup[]>(`/api/databases/${databaseId}/duplicates`);
}

export function getDatabasePermissions(databaseId: string) {
  return request<DatabasePermission[]>(`/api/databases/${databaseId}/permissions`);
}

export function updateDatabasePermissions(databaseId: string, permissions: Array<Pick<DatabasePermission, "subject_type" | "subject_id" | "role">>) {
  return request<DatabasePermission[]>(`/api/databases/${databaseId}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ permissions }),
  });
}

export function getDatabaseFieldPermissions(databaseId: string, propertyId: string) {
  return request<DatabaseFieldPermission>(`/api/databases/${databaseId}/properties/${propertyId}/permissions`);
}

export function updateDatabaseFieldPermissions(databaseId: string, propertyId: string, payload: Pick<DatabaseFieldPermission, "viewer_roles" | "editor_roles">) {
  return request<DatabaseFieldPermission>(`/api/databases/${databaseId}/properties/${propertyId}/permissions`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function createDatabaseProperty(id: string, payload: CreateDatabasePropertyPayload) {
  return request<DatabaseProperty[]>(`/api/databases/${id}/properties`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateDatabaseProperty(databaseId: string, propertyId: string, payload: UpdateDatabasePropertyPayload) {
  return request<DatabaseProperty[]>(`/api/databases/${databaseId}/properties/${propertyId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteDatabaseProperty(databaseId: string, propertyId: string) {
  return request<DatabaseProperty[]>(`/api/databases/${databaseId}/properties/${propertyId}`, {
    method: "DELETE",
  });
}

export function updateNoteDatabaseValues(noteId: string, payload: UpdateDatabaseNoteValuesPayload) {
  return request<NoteWithTags>(`/api/notes/${noteId}/database-values`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function updateNoteDatabaseMembership(noteId: string, databaseId: string | null) {
  return request<NoteWithTags>(`/api/notes/${noteId}/database-membership`, {
    method: "PUT",
    body: JSON.stringify({ database_id: databaseId }),
  });
}

export async function exportDatabaseCsv(databaseId: string) {
  const response = await fetch(`/api/databases/${databaseId}/export-csv`);
  if (!response.ok) {
    throw new Error("database csv export failed");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${databaseId}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function importDatabaseCsv(databaseId: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return fetch(`/api/databases/${databaseId}/import-csv`, {
    method: "POST",
    body: formData,
  }).then(async (response) => {
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.success) {
      throw new Error(json?.error?.message || "database csv import failed");
    }
    return json.data as { imported: number; warnings: string[]; properties: DatabaseProperty[]; notes: NoteWithTags[] };
  });
}
