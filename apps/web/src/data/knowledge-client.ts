import type {
  CreateFolderInput,
  CreateAttachmentUploadInput,
  CreateReminderInput,
  CreateTagInput,
  Folder,
  Attachment,
  AttachmentListRequest,
  KnowledgeDiagnostic,
  KnowledgeDiagnosticsRequest,
  GraphResponse,
  NoteLink,
  Reminder,
  SavedSearch,
  SavedSearchInput,
  SearchHit,
  SearchRequest,
  SetNoteLinksInput,
  SetNoteTagsInput,
  Tag,
  UpdateReminderInput,
} from "@nexus/contracts";

import type { ApiClient } from "./api-client";

export class KnowledgeClient {
  private readonly createId: () => string;

  constructor(
    private readonly client: Pick<ApiClient, "request">,
    private readonly workspaceId: string,
    options: { createId?: () => string } = {},
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  search(input: SearchRequest & { signal?: AbortSignal }) {
    const { signal, ...body } = input;
    return this.client.request<{ items: SearchHit[]; next_cursor: string | null }>({
      path: "/api/v2/search",
      method: "POST",
      headers: this.headers(),
      body,
      requestClass: "query",
      policy: {
        timeoutMs: 10_000,
        retry: 2,
        dedupeKey: `search:${this.workspaceId}:${JSON.stringify(body)}`,
        signal,
      },
    });
  }

  listSavedSearches(signal?: AbortSignal) {
    return this.client.request<{ items: SavedSearch[] }>({
      path: "/api/v2/search/saved",
      headers: this.headers(),
      requestClass: "query",
      policy: {
        timeoutMs: 8_000,
        retry: 2,
        dedupeKey: `saved-searches:${this.workspaceId}`,
        signal,
      },
    }).then(({ items }) => items);
  }

  createSavedSearch(input: SavedSearchInput) {
    return this.client.request<{ saved_search: SavedSearch }>({
      path: "/api/v2/search/saved",
      method: "POST",
      headers: this.headers(),
      body: input,
      requestClass: "command",
      policy: { timeoutMs: 8_000, retry: 0, idempotencyKey: this.createId() },
    }).then(({ saved_search: savedSearch }) => savedSearch);
  }

  deleteSavedSearch(savedSearchId: string) {
    return this.client.request<{ deleted: true }>({
      path: `/api/v2/search/saved/${encodeURIComponent(savedSearchId)}`,
      method: "DELETE",
      headers: this.headers(),
      requestClass: "command",
      policy: { timeoutMs: 8_000, retry: 0, idempotencyKey: this.createId() },
    });
  }

  listFolders(signal?: AbortSignal) {
    return this.listQuery<Folder>("/api/v2/folders", "folders", signal);
  }

  createFolder(input: CreateFolderInput) {
    return this.command<{ folder: Folder }>("/api/v2/folders", "POST", input).then(({ folder }) => folder);
  }

  listTags(signal?: AbortSignal) {
    return this.listQuery<Tag>("/api/v2/tags", "tags", signal);
  }

  createTag(input: CreateTagInput) {
    return this.command<{ tag: Tag }>("/api/v2/tags", "POST", input).then(({ tag }) => tag);
  }

  setNoteTags(noteId: string, input: SetNoteTagsInput) {
    return this.command<{ updated: true }>(
      `/api/v2/notes/${encodeURIComponent(noteId)}/tags`,
      "PUT",
      input,
    );
  }

  listNoteTags(noteId: string, signal?: AbortSignal) {
    return this.listQuery<Tag>(
      `/api/v2/notes/${encodeURIComponent(noteId)}/tags`,
      `note-tags:${noteId}`,
      signal,
    );
  }

  setNoteLinks(noteId: string, input: SetNoteLinksInput) {
    return this.command<{ updated: true }>(
      `/api/v2/notes/${encodeURIComponent(noteId)}/links`,
      "PUT",
      input,
    );
  }

  listNoteLinks(noteId: string, signal?: AbortSignal) {
    return this.listQuery<NoteLink>(
      `/api/v2/notes/${encodeURIComponent(noteId)}/links`,
      `note-links:${noteId}`,
      signal,
    );
  }

  listBacklinks(noteId: string, signal?: AbortSignal) {
    return this.listQuery<NoteLink>(
      `/api/v2/notes/${encodeURIComponent(noteId)}/backlinks`,
      `note-backlinks:${noteId}`,
      signal,
    );
  }

  getGraph(noteId?: string, signal?: AbortSignal) {
    const path = noteId
      ? `/api/v2/graph/local/${encodeURIComponent(noteId)}`
      : "/api/v2/graph";
    return this.query<GraphResponse>(path, `graph:${noteId ?? "global"}`, signal);
  }

  listReminders(includeCompleted = false, signal?: AbortSignal) {
    const path = `/api/v2/reminders?include_completed=${includeCompleted}`;
    return this.listQuery<Reminder>(path, `reminders:${includeCompleted}`, signal);
  }

  createReminder(input: CreateReminderInput) {
    return this.command<{ reminder: Reminder }>("/api/v2/reminders", "POST", input)
      .then(({ reminder }) => reminder);
  }

  updateReminder(reminderId: string, input: UpdateReminderInput) {
    return this.command<{ reminder: Reminder }>(
      `/api/v2/reminders/${encodeURIComponent(reminderId)}`,
      "PATCH",
      input,
    ).then(({ reminder }) => reminder);
  }

  listAttachments(input: AttachmentListRequest, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (input.mime_type) params.set("mime_type", input.mime_type);
    if (input.note_id) params.set("note_id", input.note_id);
    if (input.status) params.set("status", input.status);
    if (input.ocr_status) params.set("ocr_status", input.ocr_status);
    if (input.cursor) params.set("cursor", input.cursor);
    params.set("limit", String(input.limit));
    return this.query<{ items: Attachment[]; next_cursor: string | null }>(
      `/api/v2/attachments?${params.toString()}`,
      `attachments:${params.toString()}`,
      signal,
    );
  }

  createAttachmentUpload(input: Omit<CreateAttachmentUploadInput, "idempotency_key">) {
    return this.command<{ attachment: Attachment }>("/api/v2/attachments/uploads", "POST", {
      ...input,
      idempotency_key: this.createId(),
    }).then(({ attachment }) => attachment);
  }

  retryAttachmentOcr(attachmentId: string, signal?: AbortSignal) {
    return this.command<{ queued: string[]; ineligible: string[]; duplicate: string[] }>(
      `/api/v2/attachments/${encodeURIComponent(attachmentId)}/ocr/retry`,
      "POST",
      { attachment_ids: [attachmentId] },
      signal,
    );
  }

  retryAttachmentOcrBatch(attachmentIds: string[], signal?: AbortSignal) {
    return this.command<{ queued: string[]; ineligible: string[]; duplicate: string[] }>(
      "/api/v2/attachments/ocr/retry",
      "POST",
      { attachment_ids: attachmentIds },
      signal,
    );
  }

  getKnowledgeDiagnostics(input: KnowledgeDiagnosticsRequest, signal?: AbortSignal) {
    const params = new URLSearchParams({ limit: String(input.limit) });
    if (input.cursor) params.set("cursor", input.cursor);
    return this.query<{ items: KnowledgeDiagnostic[]; next_cursor: string | null }>(
      `/api/v2/knowledge/diagnostics?${params.toString()}`,
      `diagnostics:${params.toString()}`,
      signal,
    );
  }

  deleteAttachment(attachmentId: string) {
    return this.client.request<{ deleted: true }>({
      path: `/api/v2/attachments/${encodeURIComponent(attachmentId)}`,
      method: "DELETE",
      headers: this.headers(),
      requestClass: "command",
      policy: { timeoutMs: 8_000, retry: 0, idempotencyKey: this.createId() },
    });
  }

  private listQuery<T>(path: string, key: string, signal?: AbortSignal) {
    return this.query<{ items: T[] }>(path, key, signal).then(({ items }) => items);
  }

  private query<T>(path: string, key: string, signal?: AbortSignal) {
    return this.client.request<T>({
      path,
      headers: this.headers(),
      requestClass: "query",
      policy: {
        timeoutMs: 8_000,
        retry: 2,
        dedupeKey: `knowledge:${this.workspaceId}:${key}`,
        signal,
      },
    });
  }

  private command<T>(path: string, method: "POST" | "PUT" | "PATCH", body: unknown, signal?: AbortSignal) {
    return this.client.request<T>({
      path,
      method,
      headers: this.headers(),
      body,
      requestClass: "command",
      policy: { timeoutMs: 8_000, retry: 0, idempotencyKey: this.createId(), signal },
    });
  }

  private headers() {
    return { "x-workspace-id": this.workspaceId };
  }
}
