import type {
  CreateNoteInput,
  Note,
  NoteRevision,
  QuickCaptureInput,
  RestoreNoteInput,
  UpdateNoteInput,
} from "@nexus/contracts";

import type { ApiClient } from "./api-client";

export interface NotesClientOptions {
  createId(): string;
}

export interface NoteCommandOptions {
  idempotencyKey?: string;
}

export interface NoteListOptions {
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
  status?: Note["status"];
  folderId?: string | null;
  dailyDate?: string;
}

export class NotesClient {
  private readonly createId: () => string;

  constructor(
    private readonly client: Pick<ApiClient, "request">,
    private readonly workspaceId: string,
    options: Partial<NotesClientOptions> = {},
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  list(options: NoteListOptions = {}) {
    const limit = options.limit ?? 50;
    const params = new URLSearchParams();
    if (options.status) params.set("status", options.status);
    if (options.folderId !== undefined) params.set("folder_id", options.folderId ?? "none");
    if (options.dailyDate) params.set("daily_date", options.dailyDate);
    if (options.cursor) params.set("cursor", options.cursor);
    params.set("limit", String(limit));
    const cursorKey = options.cursor ?? "first";
    const filterKey = [options.status ?? "", options.folderId === undefined ? "" : options.folderId ?? "none", options.dailyDate ?? ""].join(":");
    return this.client.request<{ items: Note[]; next_cursor: string | null }>({
      path: `/api/v2/notes?${params.toString()}`,
      headers: this.headers(),
      requestClass: "query",
      policy: {
        timeoutMs: 8_000,
        retry: 2,
        dedupeKey: `notes:${this.workspaceId}:${cursorKey}:${limit}${filterKey === "::" ? "" : `:${filterKey}`}`,
        signal: options.signal,
      },
    });
  }

  get(noteId: string, signal?: AbortSignal) {
    return this.client.request<{ note: Note }>({
      path: `/api/v2/notes/${encodeURIComponent(noteId)}`,
      headers: this.headers(),
      requestClass: "query",
      policy: {
        timeoutMs: 8_000,
        retry: 2,
        dedupeKey: `note:${this.workspaceId}:${noteId}`,
        signal,
      },
    }).then(({ note }) => note);
  }

  create(input: CreateNoteInput, options: NoteCommandOptions = {}) {
    return this.noteCommand("/api/v2/notes", "POST", input, options.idempotencyKey);
  }

  update(noteId: string, input: UpdateNoteInput, options: NoteCommandOptions = {}) {
    return this.noteCommand(`/api/v2/notes/${encodeURIComponent(noteId)}`, "PATCH", input, options.idempotencyKey);
  }

  quickCapture(input: QuickCaptureInput) {
    return this.noteCommand("/api/v2/capture", "POST", input);
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

  restore(noteId: string, revision: number, input: RestoreNoteInput) {
    return this.noteCommand(
      `/api/v2/notes/${encodeURIComponent(noteId)}/revisions/${revision}/restore`,
      "POST",
      input,
    );
  }

  private noteCommand(path: string, method: "POST" | "PATCH", body: unknown, idempotencyKey?: string) {
    return this.client.request<{ note: Note }>({
      path,
      method,
      body,
      headers: this.headers(),
      requestClass: "command",
      policy: {
        timeoutMs: 10_000,
        retry: 0,
        idempotencyKey: idempotencyKey ?? this.createId(),
      },
    }).then(({ note }) => note);
  }

  private headers() {
    return { "x-workspace-id": this.workspaceId };
  }
}
