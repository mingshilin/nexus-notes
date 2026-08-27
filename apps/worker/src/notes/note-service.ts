import type {
  CreateNoteInput,
  DailyNoteInput,
  DeleteNoteInput,
  Note,
  NoteRevision,
  ClipperInput,
  QuickCaptureInput,
  RestoreNoteInput,
  UpdateNoteInput,
} from "@nexus/contracts";

export interface NoteActorContext {
  workspaceId: string;
  userId: string;
  requestId?: string;
  /** Internal retry key used by trusted job handlers; ordinary API calls omit it. */
  targetId?: string;
}

export interface CreateNoteRecordInput {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  content: string;
  folderId: string | null;
  databaseId: string | null;
  dailyDate: string | null;
  isFavorite: boolean;
  isPinned: boolean;
  source: "manual" | "import";
  now: string;
  requestId?: string;
  idempotencyKey?: string;
}

export interface NoteRepository {
  createNote(input: CreateNoteRecordInput): Promise<Note>;
  openOrCreateDaily(input: CreateNoteRecordInput): Promise<Note>;
  hasDatabase(workspaceId: string, databaseId: string): Promise<boolean>;
  getNote(workspaceId: string, noteId: string): Promise<Note | null>;
  listNotes(input: {
    workspaceId: string;
    cursor?: string;
    limit: number;
    query?: string;
    status?: Note["status"];
    folderId?: string | null;
    dailyDate?: string;
    favorite?: boolean;
    pinned?: boolean;
  }): Promise<{ items: Note[]; nextCursor: string | null }>;
  listRevisions(workspaceId: string, noteId: string): Promise<NoteRevision[]>;
  updateNote(input: {
    workspaceId: string;
    userId: string;
    noteId: string;
    baseRevision: number;
    patch: Omit<UpdateNoteInput, "base_revision">;
    now: string;
    requestId?: string;
  }): Promise<{ note: Note | null; current: Note | null }>;
  restoreRevision(input: {
    workspaceId: string;
    userId: string;
    noteId: string;
    revision: number;
    baseRevision: number;
    now: string;
    requestId?: string;
  }): Promise<{ note: Note | null; current: Note | null; revisionFound: boolean }>;
  deletePermanently(input: {
    workspaceId: string;
    userId: string;
    noteId: string;
    baseRevision: number;
    now: string;
    requestId?: string;
  }): Promise<{ deleted: boolean; state: "deleted" | "not_found" | "not_trashed" | "conflict" }>;
}

export class NoteServiceError extends Error {
  readonly retryable = false;

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "NoteServiceError";
  }
}

export interface NoteServiceOptions {
  createId(): string;
  clock(): Date;
}

function defaultCreateId() {
  return crypto.randomUUID();
}

function defaultClock() {
  return new Date();
}

function quickCaptureTitle(input: QuickCaptureInput) {
  if (input.title !== undefined) return input.title.trim().slice(0, 160);
  const firstLine = input.content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine ?? "Untitled note").slice(0, 160);
}

function clipperTitle(input: ClipperInput, sourceUrl?: string) {
  if (input.title?.trim()) return input.title.trim().slice(0, 160);
  if (sourceUrl) return sourceUrl.slice(0, 160);
  return "Web Clip";
}

function clipperUrl(input: ClipperInput) {
  if (!input.url) return undefined;
  return new URL(input.url).toString();
}

function clipperContent(input: ClipperInput, sourceUrl?: string) {
  const content = sourceUrl ? `Source: ${sourceUrl}\n\n${input.content}` : input.content;
  if (content.length > 200_000) {
    throw new NoteServiceError("CLIPPER_CONTENT_TOO_LARGE", "Clipped content is too large", 400);
  }
  return content;
}

function mapRepositoryError(error: unknown): never {
  if (error instanceof Error && /DAILY_NOTE_EXISTS/iu.test(error.message)) {
    throw new NoteServiceError("DAILY_NOTE_CONFLICT", "Daily note already exists", 409);
  }
  if (error instanceof Error && /NOTE_IDEMPOTENCY_CONFLICT/iu.test(error.message)) {
    throw new NoteServiceError("NOTE_IDEMPOTENCY_CONFLICT", "Note creation request conflicts with an existing request", 409);
  }
  throw error;
}

export class NoteService {
  private readonly options: NoteServiceOptions;

  constructor(
    private readonly repository: NoteRepository,
    options: Partial<NoteServiceOptions> = {},
  ) {
    this.options = {
      createId: options.createId ?? defaultCreateId,
      clock: options.clock ?? defaultClock,
    };
  }

  async create(context: NoteActorContext, input: CreateNoteInput) {
    try {
      return await this.repository.createNote({
        id: context.targetId ?? this.options.createId(),
        workspaceId: context.workspaceId,
        userId: context.userId,
        title: input.title,
        content: input.content,
        folderId: input.folder_id ?? null,
        databaseId: input.database_id ?? null,
        dailyDate: input.daily_date ?? null,
        isFavorite: input.is_favorite ?? false,
        isPinned: input.is_pinned ?? false,
        source: "manual",
        now: this.options.clock().toISOString(),
        requestId: context.requestId,
        ...(context.targetId ? { idempotencyKey: context.targetId } : {}),
      });
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  openOrCreateDaily(context: NoteActorContext, input: DailyNoteInput) {
    return this.repository.openOrCreateDaily({
      id: this.options.createId(),
      workspaceId: context.workspaceId,
      userId: context.userId,
      title: `Daily Note ${input.daily_date}`,
      content: "",
      folderId: null,
      databaseId: null,
      dailyDate: input.daily_date,
      isFavorite: false,
      isPinned: false,
      source: "manual",
      now: this.options.clock().toISOString(),
      requestId: context.requestId,
    });
  }

  quickCapture(context: NoteActorContext, input: QuickCaptureInput) {
    return this.create(context, {
      title: quickCaptureTitle(input),
      content: input.content,
      folder_id: input.folder_id,
      daily_date: input.daily_date,
    });
  }

  async clipperCapture(context: NoteActorContext, input: ClipperInput) {
    const sourceUrl = clipperUrl(input);
    const content = clipperContent(input, sourceUrl);
    const title = clipperTitle(input, sourceUrl);

    if (input.target === "daily") {
      const dailyDate = this.options.clock().toISOString().slice(0, 10);
      let daily: Note;
      try {
        daily = await this.repository.openOrCreateDaily({
          id: this.options.createId(),
          workspaceId: context.workspaceId,
          userId: context.userId,
          title: `Daily Note ${dailyDate}`,
          content,
          folderId: null,
          databaseId: null,
          dailyDate,
          isFavorite: false,
          isPinned: false,
          source: "import",
          now: this.options.clock().toISOString(),
          requestId: context.requestId,
        });
      } catch (error) {
        return mapRepositoryError(error);
      }
      if (daily.content === content) return daily;
      const nextContent = daily.content ? `${daily.content}\n\n${content}` : content;
      const result = await this.repository.updateNote({
        workspaceId: context.workspaceId,
        userId: context.userId,
        noteId: daily.id,
        baseRevision: daily.revision,
        patch: { content: nextContent, source: "import" },
        now: this.options.clock().toISOString(),
        requestId: context.requestId,
      });
      if (!result.note) {
        throw new NoteServiceError("NOTE_CONFLICT", "The daily note changed before the clip could be appended", 409, {
          server_note: result.current,
        });
      }
      return result.note;
    }

    if (input.target === "database" && input.database_id && !(await this.repository.hasDatabase(context.workspaceId, input.database_id))) {
      throw new NoteServiceError("DATABASE_NOT_FOUND", "Database not found", 404);
    }

    return this.create(context, {
      title,
      content,
      database_id: input.target === "database" ? input.database_id : null,
    });
  }

  async list(
    context: NoteActorContext,
    options: { cursor?: string; limit: number; query?: string; status?: Note["status"]; folderId?: string | null; dailyDate?: string; favorite?: boolean; pinned?: boolean },
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const page = await this.repository.listNotes({
      workspaceId: context.workspaceId,
      cursor: options.cursor,
      limit: options.limit,
      ...(options.query ? { query: options.query } : {}),
      status: options.status,
      folderId: options.folderId,
      dailyDate: options.dailyDate,
      ...(options.favorite !== undefined ? { favorite: options.favorite } : {}),
      ...(options.pinned !== undefined ? { pinned: options.pinned } : {}),
    });
    signal?.throwIfAborted();
    return { items: page.items, next_cursor: page.nextCursor };
  }

  async get(context: NoteActorContext, noteId: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const note = await this.repository.getNote(context.workspaceId, noteId);
    signal?.throwIfAborted();
    if (!note) {
      throw new NoteServiceError("NOTE_NOT_FOUND", "Note not found", 404);
    }
    return note;
  }

  listRevisions(context: NoteActorContext, noteId: string) {
    return this.repository.listRevisions(context.workspaceId, noteId);
  }

  async update(context: NoteActorContext, noteId: string, input: UpdateNoteInput) {
    const { base_revision: baseRevision, ...patch } = input;
    let result: Awaited<ReturnType<NoteRepository["updateNote"]>>;
    try {
      result = await this.repository.updateNote({
        workspaceId: context.workspaceId,
        userId: context.userId,
        noteId,
        baseRevision,
        patch,
        now: this.options.clock().toISOString(),
        requestId: context.requestId,
      });
    } catch (error) {
      return mapRepositoryError(error);
    }
    if (!result.note) {
      if (!result.current) {
        throw new NoteServiceError("NOTE_NOT_FOUND", "Note not found", 404);
      }
      throw new NoteServiceError(
        "NOTE_CONFLICT",
        "The note changed before this update could be saved",
        409,
        { server_note: result.current, submitted: input },
      );
    }
    return result.note;
  }

  async restore(
    context: NoteActorContext,
    noteId: string,
    revision: number,
    input: RestoreNoteInput,
  ) {
    const result = await this.repository.restoreRevision({
      workspaceId: context.workspaceId,
      userId: context.userId,
      noteId,
      revision,
      baseRevision: input.base_revision,
      now: this.options.clock().toISOString(),
      requestId: context.requestId,
    });
    if (!result.note) {
      if (!result.current) {
        throw new NoteServiceError("NOTE_NOT_FOUND", "Note not found", 404);
      }
      if (!result.revisionFound) {
        throw new NoteServiceError("NOTE_REVISION_NOT_FOUND", "Note revision not found", 404);
      }
      throw new NoteServiceError(
        "NOTE_CONFLICT",
        "The note changed before this revision could be restored",
        409,
        {
          server_note: result.current,
          submitted_revision: input.base_revision,
          restore_revision: revision,
        },
      );
    }
    return result.note;
  }

  async deletePermanently(context: NoteActorContext, noteId: string, input: DeleteNoteInput) {
    const result = await this.repository.deletePermanently({
      workspaceId: context.workspaceId,
      userId: context.userId,
      noteId,
      baseRevision: input.base_revision,
      now: this.options.clock().toISOString(),
      requestId: context.requestId,
    });
    if (result.deleted) return { deleted: true };
    if (result.state === "not_found") {
      throw new NoteServiceError("NOTE_NOT_FOUND", "Note not found", 404);
    }
    if (result.state === "not_trashed") {
      throw new NoteServiceError("NOTE_NOT_TRASHED", "Only trashed notes can be permanently deleted", 409);
    }
    throw new NoteServiceError("NOTE_CONFLICT", "The note changed before it could be permanently deleted", 409);
  }
}
