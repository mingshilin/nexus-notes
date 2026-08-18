import type { DatabaseNoteValuesMap } from "@/types/database";

export interface Note {
  id: string;
  folder_id: string | null;
  database_id?: string | null;
  title: string;
  content: string;
  is_favorite: boolean;
  is_pinned: boolean;
  is_daily: boolean;
  daily_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  archived_at: string | null;
  last_opened_at: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface NoteWithTags extends Note {
  tags: Tag[];
  folder: Folder | null;
  database_values?: DatabaseNoteValuesMap;
}

export interface Folder {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  note_count?: number;
}

export interface NoteVersion {
  id: string;
  note_id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
}

export interface NoteLink {
  id: string;
  user_id: string;
  source_note_id: string;
  target_note_id: string | null;
  target_title: string;
  created_at: string;
  source_title?: string;
  target_note_title?: string | null;
}

export interface GraphNode {
  id: string;
  title: string;
  is_current?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  target_title: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Reminder {
  id: string;
  user_id: string;
  workspace_id: string;
  note_id: string | null;
  note_title?: string | null;
  title: string;
  description: string;
  due_at: string;
  completed_at: string | null;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NoteAttachment {
  id: string;
  note_id: string;
  workspace_id: string;
  uploader_id: string;
  storage_key: string;
  file_name: string;
  mime_type: string;
  size: number;
  ocr_text?: string | null;
  ocr_status?: "pending" | "processing" | "ready" | "failed" | "unsupported";
  ocr_updated_at?: string | null;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

export interface PublicNoteShare {
  note_id: string;
  access_mode: "read";
  share_url: string;
  created_at: string;
  expires_at?: string | null;
}

export interface PublicSharedNote {
  note: Pick<Note, "id" | "title" | "content" | "updated_at" | "created_at">;
  access_mode: "read";
  workspace_name: string;
  shared_by: string;
  created_at: string;
}

export interface CreateNotePayload {
  title?: string;
  content?: string;
  is_favorite?: boolean;
  folder_id?: string | null;
  database_id?: string | null;
  is_daily?: boolean;
  daily_date?: string | null;
}

export interface UpdateNotePayload {
  title?: string;
  content?: string;
  is_favorite?: boolean;
  is_pinned?: boolean;
  folder_id?: string | null;
  database_id?: string | null;
}

export interface CreateTagPayload {
  name: string;
  color?: string;
}

export interface UpdateNoteTagsPayload {
  tagIds: string[];
}

export interface NotesQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  tag?: string;
  folder?: string | null;
  favorite?: boolean;
  pinned?: boolean;
  archived?: boolean;
  recent?: boolean;
  daily?: boolean;
  dailyDate?: string;
  databaseId?: string;
  deleted?: boolean;
  deletedMode?: "exclude" | "only" | "include";
}

export interface CreateFolderPayload {
  name: string;
}

export interface UpdateFolderPayload {
  name: string;
}

export interface CreateReminderPayload {
  note_id?: string | null;
  title: string;
  description?: string;
  due_at: string;
}

export interface UpdateReminderPayload {
  note_id?: string | null;
  title?: string;
  description?: string;
  due_at?: string;
}
