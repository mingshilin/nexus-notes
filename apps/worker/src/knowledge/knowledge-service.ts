import type {
  CreateFolderInput,
  CreateReminderInput,
  CreateTagInput,
  Folder,
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

export interface KnowledgeActorContext {
  workspaceId: string;
  userId: string;
}

export interface KnowledgeRepository {
  search(workspaceId: string, request: SearchRequest): Promise<{
    items: SearchHit[];
    nextCursor: string | null;
  }>;
  listSavedSearches(workspaceId: string, userId: string): Promise<SavedSearch[]>;
  createSavedSearch(input: {
    workspaceId: string;
    userId: string;
    input: SavedSearchInput;
    now: string;
  }): Promise<SavedSearch>;
  deleteSavedSearch(workspaceId: string, userId: string, savedSearchId: string): Promise<void>;
  listFolders(workspaceId: string): Promise<Folder[]>;
  createFolder(workspaceId: string, input: CreateFolderInput, now: string): Promise<Folder | null>;
  listTags(workspaceId: string): Promise<Tag[]>;
  createTag(workspaceId: string, input: CreateTagInput, now: string): Promise<Tag>;
  setNoteTags(workspaceId: string, noteId: string, tagIds: string[], now: string): Promise<void>;
  setNoteLinks(workspaceId: string, noteId: string, targetNoteIds: string[], now: string): Promise<void>;
  listNoteLinks(workspaceId: string, noteId: string): Promise<NoteLink[]>;
  listBacklinks(workspaceId: string, noteId: string): Promise<NoteLink[]>;
  getGraph(workspaceId: string, currentNoteId?: string): Promise<GraphResponse>;
  listReminders(workspaceId: string, userId: string, includeCompleted: boolean): Promise<Reminder[]>;
  createReminder(input: {
    workspaceId: string;
    userId: string;
    input: CreateReminderInput;
    now: string;
  }): Promise<Reminder | null>;
  updateReminder(input: {
    workspaceId: string;
    userId: string;
    reminderId: string;
    baseRevision: number;
    patch: Omit<UpdateReminderInput, "base_revision">;
    now: string;
  }): Promise<{ reminder: Reminder | null; current: Reminder | null }>;
}

export class KnowledgeServiceError extends Error {
  readonly retryable = false;

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "KnowledgeServiceError";
  }
}

export class KnowledgeService {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: KnowledgeRepository,
    options: { clock?: () => Date } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async search(context: KnowledgeActorContext, request: SearchRequest) {
    const result = await this.repository.search(context.workspaceId, request);
    return { items: result.items, next_cursor: result.nextCursor };
  }

  listSavedSearches(context: KnowledgeActorContext) {
    return this.repository.listSavedSearches(context.workspaceId, context.userId);
  }

  createSavedSearch(context: KnowledgeActorContext, input: SavedSearchInput) {
    return this.repository.createSavedSearch({
      workspaceId: context.workspaceId,
      userId: context.userId,
      input,
      now: this.clock().toISOString(),
    });
  }

  deleteSavedSearch(context: KnowledgeActorContext, savedSearchId: string) {
    return this.repository.deleteSavedSearch(context.workspaceId, context.userId, savedSearchId);
  }

  listFolders(context: KnowledgeActorContext) {
    return this.repository.listFolders(context.workspaceId);
  }

  async createFolder(context: KnowledgeActorContext, input: CreateFolderInput) {
    const folder = await this.repository.createFolder(context.workspaceId, input, this.clock().toISOString());
    if (!folder) {
      throw new KnowledgeServiceError("FOLDER_PARENT_NOT_FOUND", "Parent folder not found", 404);
    }
    return folder;
  }

  listTags(context: KnowledgeActorContext) {
    return this.repository.listTags(context.workspaceId);
  }

  createTag(context: KnowledgeActorContext, input: CreateTagInput) {
    return this.repository.createTag(context.workspaceId, input, this.clock().toISOString());
  }

  setNoteTags(context: KnowledgeActorContext, noteId: string, input: SetNoteTagsInput) {
    return this.repository.setNoteTags(context.workspaceId, noteId, input.tag_ids, this.clock().toISOString());
  }

  setNoteLinks(context: KnowledgeActorContext, noteId: string, input: SetNoteLinksInput) {
    return this.repository.setNoteLinks(
      context.workspaceId,
      noteId,
      input.target_note_ids,
      this.clock().toISOString(),
    );
  }

  listNoteLinks(context: KnowledgeActorContext, noteId: string) {
    return this.repository.listNoteLinks(context.workspaceId, noteId);
  }

  listBacklinks(context: KnowledgeActorContext, noteId: string) {
    return this.repository.listBacklinks(context.workspaceId, noteId);
  }

  getGraph(context: KnowledgeActorContext, currentNoteId?: string) {
    return this.repository.getGraph(context.workspaceId, currentNoteId);
  }

  listReminders(context: KnowledgeActorContext, includeCompleted: boolean) {
    return this.repository.listReminders(context.workspaceId, context.userId, includeCompleted);
  }

  async createReminder(context: KnowledgeActorContext, input: CreateReminderInput) {
    const reminder = await this.repository.createReminder({
      workspaceId: context.workspaceId,
      userId: context.userId,
      input,
      now: this.clock().toISOString(),
    });
    if (!reminder) {
      throw new KnowledgeServiceError("REMINDER_NOTE_NOT_FOUND", "Reminder note not found", 404);
    }
    return reminder;
  }

  async updateReminder(context: KnowledgeActorContext, reminderId: string, input: UpdateReminderInput) {
    const { base_revision: baseRevision, ...patch } = input;
    const result = await this.repository.updateReminder({
      workspaceId: context.workspaceId,
      userId: context.userId,
      reminderId,
      baseRevision,
      patch,
      now: this.clock().toISOString(),
    });
    if (!result.reminder) {
      if (!result.current) {
        throw new KnowledgeServiceError("REMINDER_NOT_FOUND", "Reminder not found", 404);
      }
      throw new KnowledgeServiceError(
        "REMINDER_CONFLICT",
        "The reminder changed before this update could be saved",
        409,
        { server_reminder: result.current, submitted: input },
      );
    }
    return result.reminder;
  }
}
