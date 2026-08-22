import type {
  CreateNoteInput,
  Note,
  NoteRevision,
  QuickCaptureInput,
  RestoreNoteInput,
  UpdateNoteInput,
} from "@nexus/contracts";

export interface NoteActorContext {
  workspaceId: string;
  userId: string;
  requestId?: string;
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
  source: "manual";
  now: string;
  requestId?: string;
}

export interface NoteRepository {
  createNote(input: CreateNoteRecordInput): Promise<Note>;
  getNote(workspaceId: string, noteId: string): Promise<Note | null>;
  listNotes(input: {
    workspaceId: string;
    cursor?: string;
    limit: number;
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

  create(context: NoteActorContext, input: CreateNoteInput) {
    return this.repository.createNote({
      id: this.options.createId(),
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

  async list(
    context: NoteActorContext,
    options: { cursor?: string; limit: number },
  ) {
    const page = await this.repository.listNotes({
      workspaceId: context.workspaceId,
      cursor: options.cursor,
      limit: options.limit,
    });
    return { items: page.items, next_cursor: page.nextCursor };
  }

  async get(context: NoteActorContext, noteId: string) {
    const note = await this.repository.getNote(context.workspaceId, noteId);
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
    const result = await this.repository.updateNote({
      workspaceId: context.workspaceId,
      userId: context.userId,
      noteId,
      baseRevision,
      patch,
      now: this.options.clock().toISOString(),
      requestId: context.requestId,
    });
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
}
