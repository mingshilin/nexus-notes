import type {
  CreateFolderInput,
  CreateAttachmentUploadInput,
  CreateReminderInput,
  CreateTagInput,
  Folder,
  Attachment,
  AttachmentListRequest,
  CalendarFeed,
  CalendarFeedQuery,
  KnowledgeDiagnostic,
  KnowledgeDiagnosticsRequest,
  DeleteReminderInput,
  GraphResponse,
  NoteLink,
  Reminder,
  ReminderDelivery,
  ReminderListQuery,
  SavedSearch,
  SavedSearchInput,
  SearchHit,
  SearchRequest,
  SetNoteLinksInput,
  SetNoteTagsInput,
  SnoozeReminderInput,
  Tag,
  UpdateReminderInput,
} from "@nexus/contracts";

import type { ApiClient } from "./api-client";
import type { WorkspaceQueryCache } from "./workspace-query-cache";

export class KnowledgeClient {
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly userId?: string;
  private readonly queryCache?: WorkspaceQueryCache;
  private readonly reminderCache = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly client: Pick<ApiClient, "request">,
    private readonly workspaceId: string,
    options: { createId?: () => string; now?: () => number; userId?: string; queryCache?: WorkspaceQueryCache } = {},
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => Date.now());
    this.userId = options.userId;
    this.queryCache = options.queryCache;
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
    const load = (requestSignal?: AbortSignal) => this.listQuery<Reminder>(path, `reminders:${includeCompleted}`, requestSignal);
    return this.sharedReminder(`legacy:${includeCompleted}`, load, signal)
      ?? this.cachedReminder(`legacy:${includeCompleted}`, () => load(signal));
  }

  listReminderPage(input: ReminderListQuery, signal?: AbortSignal) {
    const params = new URLSearchParams({ status: input.status });
    if (input.query) params.set("query", input.query);
    if (input.cursor) params.set("cursor", input.cursor);
    params.set("limit", String(input.limit));
    const key = params.toString();
    const load = (requestSignal?: AbortSignal) => this.query<{ items: Reminder[]; next_cursor: string | null }>(
        `/api/v2/reminders?${key}`,
        `reminder-page:${key}`,
        requestSignal,
      );
    return this.sharedReminder(`page:${key}`, load, signal)
      ?? this.cachedReminder(key, () => load(signal));
  }

  listReminderDeliveries(reminderId: string, signal?: AbortSignal) {
    return this.query<{ items: ReminderDelivery[] }>(
      `/api/v2/reminders/${encodeURIComponent(reminderId)}/deliveries`,
      `reminder-deliveries:${reminderId}`,
      signal,
    ).then(({ items }) => items);
  }

  retryReminderDelivery(reminderId: string, deliveryId: string) {
    return this.command<{ delivery: ReminderDelivery }>(
      `/api/v2/reminders/${encodeURIComponent(reminderId)}/deliveries/${encodeURIComponent(deliveryId)}/retry`,
      "POST",
      {},
    ).then(({ delivery }) => delivery);
  }

  getCalendarFeed(input: CalendarFeedQuery, signal?: AbortSignal) {
    const params = new URLSearchParams({ from: input.from, to: input.to });
    return this.query<CalendarFeed>(
      `/api/v2/calendar/feed?${params.toString()}`,
      `calendar-feed:${params.toString()}`,
      signal,
    );
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

  snoozeReminder(reminderId: string, input: SnoozeReminderInput) {
    return this.command<{ reminder: Reminder }>(
      `/api/v2/reminders/${encodeURIComponent(reminderId)}/snooze`,
      "POST",
      input,
    ).then(({ reminder }) => reminder);
  }

  deleteReminder(reminderId: string, input: DeleteReminderInput) {
    return this.command<{ deleted: true }>(
      `/api/v2/reminders/${encodeURIComponent(reminderId)}`,
      "DELETE",
      input,
    );
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

  uploadAttachmentContent(attachmentId: string, body: ArrayBuffer | ArrayBufferView, signal?: AbortSignal) {
    return this.client.request<{ attachment: Attachment }>({
      path: `/api/v2/attachments/${encodeURIComponent(attachmentId)}/content`,
      method: "PUT",
      headers: { ...this.headers(), "content-type": "application/octet-stream" },
      body,
      bodyMode: "raw",
      requestClass: "command",
      policy: { timeoutMs: 30_000, retry: 0, idempotencyKey: this.createId(), signal },
    }).then(({ attachment }) => attachment);
  }

  completeAttachmentUpload(attachmentId: string) {
    return this.command<{ attachment: Attachment }>(
      `/api/v2/attachments/${encodeURIComponent(attachmentId)}/complete`,
      "POST",
      { upload_id: attachmentId },
    ).then(({ attachment }) => attachment);
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

  private command<T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body: unknown, signal?: AbortSignal) {
    return this.client.request<T>({
      path,
      method,
      headers: this.headers(),
      body,
      requestClass: "command",
      policy: { timeoutMs: 8_000, retry: 0, idempotencyKey: this.createId(), signal },
    }).then((value) => {
      this.reminderCache.clear();
      this.queryCache?.invalidate({ userId: this.userId, workspaceId: this.workspaceId, domain: "reminders" });
      return value;
    });
  }

  private sharedReminder<T>(key: string, load: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) {
    if (!this.queryCache || !this.userId) return null;
    return this.queryCache.get(
      { userId: this.userId, workspaceId: this.workspaceId, domain: "reminders", query: key },
      (requestSignal) => load(requestSignal),
      { ttlMs: 60_000, signal },
    );
  }

  private cachedReminder<T>(key: string, load: () => Promise<T>): Promise<T> {
    const current = this.reminderCache.get(key) as { value: T; expiresAt: number } | undefined;
    if (current && current.expiresAt > this.now()) return Promise.resolve(current.value);
    return load().then((value) => {
      this.reminderCache.set(key, { value, expiresAt: this.now() + 60_000 });
      return value;
    });
  }

  private headers() {
    return { "x-workspace-id": this.workspaceId };
  }
}
