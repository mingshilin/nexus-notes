import type { NoteAttachment, NoteWithTags, Reminder } from "@/types/note";

export interface FeedLog {
  id: string;
  workspace_id: string;
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface CommentThreadItem {
  id: string;
  workspace_id: string;
  note_id: string | null;
  database_id: string | null;
  body: string;
  mentions: string[];
  created_by_user_id: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationItem {
  id: string;
  workspace_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export type SavedSearchSourceType = "notes" | "attachments" | "ocr";

export interface SavedSearchFilters {
  query?: string;
  sourceTypes?: SavedSearchSourceType[];
  tagIds?: string[];
  folderIds?: string[];
  databaseIds?: string[];
  memberIds?: string[];
  attachmentTypes?: string[];
  attachmentStatus?: string[];
  attachment?: {
    query?: string;
    type?: string;
    status?: string;
    noteId?: string;
    from?: string;
    to?: string;
  };
  folderId?: string;
  databaseId?: string;
  tagId?: string;
  favoriteOnly?: boolean;
  [key: string]: unknown;
}

export interface SavedSearch {
  id: string;
  workspace_id: string;
  name: string;
  query: string;
  filters: SavedSearchFilters;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDiagnostic {
  orphan_notes: Array<Pick<NoteWithTags, "id" | "title" | "updated_at">>;
  duplicate_titles: Array<{ title: string; count: number }>;
  unorganized_notes: Array<Pick<NoteWithTags, "id" | "title" | "updated_at">>;
}

export interface AttachmentCenterItem extends NoteAttachment {
  note_title?: string | null;
  ocr_text?: string | null;
  ocr_status?: "pending" | "processing" | "ready" | "failed" | "unsupported";
  ocr_updated_at?: string | null;
}

export interface ImportJob {
  id: string;
  workspace_id: string;
  created_by_user_id: string;
  source_type: string;
  status: string;
  imported_count: number;
  warnings: string[];
  created_at: string;
  updated_at: string;
}

export interface OfflineDraft {
  id: string;
  workspace_id: string;
  user_id: string;
  note_id: string | null;
  title: string;
  content: string;
  status: "pending" | "synced" | "conflict";
  conflict_note_id?: string | null;
  conflict_reason?: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

export interface UnifiedCalendarItem {
  id: string;
  title: string;
  date: string;
  kind: "reminder" | "daily" | "database";
  note_id?: string | null;
  source?: Reminder | NoteWithTags;
}
