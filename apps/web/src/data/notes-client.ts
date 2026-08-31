import type {
  CreateNoteInput,
  ClipperInput,
  DailyNoteInput,
  DeleteNoteInput,
  Note,
  NoteRevision,
  QuickCaptureInput,
  RestoreNoteInput,
  UpdateNoteInput,
} from "@nexus/contracts";

import type { ApiClient } from "./api-client";
import type { WorkspaceQueryCache } from "./workspace-query-cache";

export interface NotesClientOptions {
  createId(): string;
  userId?: string;
  queryCache?: WorkspaceQueryCache;
}

export interface NoteCommandOptions {
  idempotencyKey?: string;
}

export interface NoteListOptions {
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
  query?: string;
  status?: Note["status"];
  folderId?: string | null;
  dailyDate?: string;
  favorite?: boolean;
  pinned?: boolean;
}

export class NotesClient {
  private readonly createId: () => string;
  private readonly userId?: string;
  private readonly queryCache?: WorkspaceQueryCache;

  constructor(
    private readonly client: Pick<ApiClient, "request">,
    private readonly workspaceId: string,
    options: Partial<NotesClientOptions> = {},
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.userId = options.userId;
    this.queryCache = options.queryCache;
  }

  list(options: NoteListOptions = {}) {
    const limit = options.limit ?? 50;
    const params = new URLSearchParams();
    const query = options.query?.trim();
    if (query) params.set("q", query);
    if (options.status) params.set("status", options.status);
    if (options.folderId !== undefined) params.set("folder_id", options.folderId ?? "none");
    if (options.dailyDate) params.set("daily_date", options.dailyDate);
    if (options.favorite !== undefined) params.set("favorite", String(options.favorite));
    if (options.pinned !== undefined) params.set("pinned", String(options.pinned));
    if (options.cursor) params.set("cursor", options.cursor);
    params.set("limit", String(limit));
    const cursorKey = options.cursor ?? "first";
    const filterParts = [
      options.status ?? "",
      options.folderId === undefined ? "" : options.folderId ?? "none",
      options.dailyDate ?? "",
    ];
    if (query) filterParts.push(query);
    if (options.favorite !== undefined) filterParts.push(String(options.favorite));
    if (options.pinned !== undefined) filterParts.push(String(options.pinned));
    const filterKey = filterParts.join(":");
    const path = `/api/v2/notes?${params.toString()}`;
    const load = (signal?: AbortSignal) => this.client.request<{ items: Note[]; next_cursor: string | null }>({
      path,
      headers: this.headers(),
      requestClass: "query",
      policy: {
        timeoutMs: 8_000,
        retry: 2,
        dedupeKey: `notes:${this.workspaceId}:${cursorKey}:${limit}${filterKey === "::" ? "" : `:${filterKey}`}`,
        signal,
      },
    });
    return this.shared(`list:${path}`, load, options.signal) ?? load(options.signal);
  }

  get(noteId: string, signal?: AbortSignal) {
    const path = `/api/v2/notes/${encodeURIComponent(noteId)}`;
    const load = (requestSignal?: AbortSignal) => this.client.request<{ note: Note }>({
      path,
      headers: this.headers(),
      requestClass: "query",
      policy: {
        timeoutMs: 8_000,
        retry: 2,
        dedupeKey: `note:${this.workspaceId}:${noteId}`,
        signal: requestSignal,
      },
    }).then(({ note }) => note);
    return this.shared(`note:${noteId}`, load, signal) ?? load(signal);
  }

  create(input: CreateNoteInput, options: NoteCommandOptions = {}) {
    return this.noteCommand<Note>("/api/v2/notes", "POST", input, options.idempotencyKey);
  }

  openOrCreateDaily(dailyDate: DailyNoteInput["daily_date"]) {
    return this.noteCommand<Note>("/api/v2/notes/daily", "POST", { daily_date: dailyDate });
  }

  update(noteId: string, input: UpdateNoteInput, options: NoteCommandOptions = {}) {
    return this.noteCommand<Note>(`/api/v2/notes/${encodeURIComponent(noteId)}`, "PATCH", input, options.idempotencyKey);
  }

  deletePermanently(noteId: string, input: DeleteNoteInput) {
    return this.noteCommand<{ deleted: true }>(`/api/v2/notes/${encodeURIComponent(noteId)}`, "DELETE", input);
  }

  quickCapture(input: QuickCaptureInput) {
    return this.noteCommand<Note>("/api/v2/capture", "POST", input);
  }

  clipperCapture(input: ClipperInput, options: NoteCommandOptions = {}) {
    return this.noteCommand<Note>("/api/v2/clipper/capture", "POST", input, options.idempotencyKey);
  }

  listRevisions(noteId: string, signal?: AbortSignal) {
    return this.client.request<{ items: NoteRevision[] }>({
      path: `/api/v2/notes/${encodeURIComponent(noteId)}/revisions`,
      headers: this.headers(),
      requestClass: "query",
      policy: {
        timeoutMs: 8_000,
        retry: 2,
        dedupeKey: `note-revisions:${this.workspaceId}:${noteId}`,
        signal,
      },
    }).then(({ items }) => items);
  }

  restore(noteId: string, revision: number, input: RestoreNoteInput, signal?: AbortSignal) {
    return this.noteCommand<Note>(
      `/api/v2/notes/${encodeURIComponent(noteId)}/revisions/${revision}/restore`,
      "POST",
      input,
      undefined,
      signal,
    );
  }

  private noteCommand<T extends object>(path: string, method: "POST" | "PATCH" | "DELETE", body: unknown, idempotencyKey?: string, signal?: AbortSignal) {
    return this.client.request<{ note: T } | T>({
      path,
      method,
      body,
      headers: this.headers(),
      requestClass: "command",
      policy: {
        timeoutMs: 10_000,
        retry: 0,
        idempotencyKey: idempotencyKey ?? this.createId(),
        signal,
      },
    }).then((result) => {
      this.queryCache?.invalidate({ userId: this.userId, workspaceId: this.workspaceId, domain: "notes" });
      return "note" in result ? result.note : result as T;
    });
  }

  private shared<T>(query: string, load: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) {
    if (!this.queryCache || !this.userId) return null;
    return this.queryCache.get(
      { userId: this.userId, workspaceId: this.workspaceId, domain: "notes", query },
      (requestSignal) => load(requestSignal),
      { ttlMs: 30_000, signal },
    );
  }

  private headers() {
    return { "x-workspace-id": this.workspaceId };
  }
}
