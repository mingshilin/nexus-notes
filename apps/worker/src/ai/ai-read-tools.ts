import {
  AiReadContextSchema,
  AiReadItemSchema,
  AiReadResultSchema,
  AiReadToolCallSchema,
  AiReadToolNameSchema,
  type AiReadContext,
  type AiReadItem,
  type AiReadResult,
  type AiReadToolName,
  type Database,
  type DatabaseRecord,
  type DatabaseProperty,
  type Note,
  type Reminder,
  type WorkspaceContext,
} from "@nexus/contracts";

import type { D1DatabaseRepository } from "../databases/d1-database-repository";
import { cursorFingerprint, decodeRecordCursor, encodeDatabasePageCursor } from "../databases/database-model";
import type { KnowledgeService } from "../knowledge/knowledge-service";
import type { NoteService } from "../notes/note-service";

const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS = 50;
const MAX_SELECTED_ENTITIES = 50;
const MAX_DATABASES_PER_READ = 50;
const MAX_DATABASE_PAGE_REQUESTS = 50;
const MAX_RECORD_PAGE_REQUESTS = 50;
const DEFAULT_DEADLINE_MS = 8_000;
const MAX_RESULT_BYTES = 64 * 1024;

export interface AiReadExecutionContext extends AiReadContext {
  /** These fields must be derived by the authenticated Worker request. */
  role: WorkspaceContext["role"];
  capabilities: ReadonlySet<string>;
}

export interface AiReadToolsDependencies {
  notes: Pick<NoteService, "get" | "list">;
  knowledge: Pick<KnowledgeService, "listReminderPage">;
  databases: Pick<D1DatabaseRepository, "listDatabasePage" | "getDatabase" | "searchRecords" | "getRecord">;
  deadlineMs?: number;
  maxResults?: number;
}

export class AiReadToolError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AiReadToolError";
    this.retryable = retryable;
  }
}

type ReadInput = Record<string, unknown>;
type ReadDatabaseBundle = Awaited<ReturnType<D1DatabaseRepository["getDatabase"]>>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeContext(context: AiReadExecutionContext): AiReadExecutionContext {
  const parsed = AiReadContextSchema.safeParse({
    workspaceId: context.workspaceId,
    userId: context.userId,
    selectedNoteIds: context.selectedNoteIds,
    selectedDatabaseIds: context.selectedDatabaseIds,
    allowWorkspaceSearch: context.allowWorkspaceSearch,
  });
  if (!parsed.success) {
    throw new AiReadToolError("AI_READ_CONTEXT_INVALID", "AI read context is invalid", 400);
  }
  if (!new Set(["owner", "editor", "viewer"]).has(context.role) || !context.capabilities || typeof context.capabilities.has !== "function") {
    throw new AiReadToolError("AI_READ_CONTEXT_INVALID", "AI read context is not server-derived", 400);
  }
  return {
    ...parsed.data,
    role: context.role,
    capabilities: context.capabilities,
  };
}

function workspaceActor(context: AiReadExecutionContext): WorkspaceContext {
  return {
    workspaceId: context.workspaceId,
    userId: context.userId,
    role: context.role,
    capabilities: context.capabilities,
  };
}

function limitValue(value: unknown, maximum: number) {
  const parsed = typeof value === "number" && Number.isInteger(value) ? value : Number(value ?? DEFAULT_MAX_RESULTS);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_RESULTS;
  return Math.max(1, Math.min(Math.floor(parsed), maximum));
}

function dependencyCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const candidate = error as { code?: unknown; status?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return error instanceof Error ? error.message : "";
}

function dependencyStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function isPermissionError(error: unknown) {
  const code = dependencyCode(error);
  const status = dependencyStatus(error);
  return status === 401 || status === 403 || /(?:DENIED|FORBIDDEN|PERMISSION)/iu.test(code);
}

function isNotFoundError(error: unknown) {
  const code = dependencyCode(error);
  const status = dependencyStatus(error);
  return status === 404 || /NOT_FOUND/iu.test(code);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError");
}

function safeError(error: unknown, fallbackCode: string, fallbackMessage: string): Error {
  if (error instanceof AiReadToolError) return error;
  if (isAbortError(error)) return error as Error;
  if (isPermissionError(error)) return new AiReadToolError(fallbackCode, fallbackMessage, 403);
  if (isNotFoundError(error)) return new AiReadToolError("AI_READ_TARGET_NOT_FOUND", "The requested AI read target was not found", 404);
  if (/CURSOR|INVALID_QUERY|INVALID_FILTER/iu.test(dependencyCode(error))) {
    return new AiReadToolError("AI_READ_CURSOR_INVALID", "The AI read cursor is invalid for this query", 400);
  }
  return new AiReadToolError("AI_READ_UNAVAILABLE", "The requested AI read is temporarily unavailable", 503, true);
}

function assertWorkspace(value: { workspace_id?: string }, context: AiReadExecutionContext) {
  if (value.workspace_id !== context.workspaceId) {
    throw new AiReadToolError("AI_READ_CROSS_WORKSPACE", "AI read result crossed workspace boundaries", 403);
  }
}

function noteHit(note: Note, fullContent: boolean, query = ""): AiReadItem {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const hitSources = normalizedQuery
    ? ([
        ["title", note.title],
        ["content", note.content],
      ] as const).filter(([, value]) => value.toLocaleLowerCase().includes(normalizedQuery)).map(([source]) => source)
    : undefined;
  return AiReadItemSchema.parse({
    source_type: "note",
    source_id: note.id,
    workspace_id: note.workspace_id,
    title: note.title.trim().slice(0, 160),
    excerpt: note.content.slice(0, 1_000),
    ...(fullContent ? { content: note.content.slice(0, 20_000) } : {}),
    ...(hitSources?.length ? { hit_sources: hitSources } : {}),
    status: note.status,
    revision: note.revision,
    updated_at: note.updated_at,
  });
}

function noteRepositoryCursor(note: Pick<Note, "updated_at" | "id">) {
  return encodeURIComponent(`${note.updated_at}\n${note.id}`);
}

function compactNoteHit(note: Note, query = ""): AiReadItem {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const hitSources = normalizedQuery
    ? ([
        ["title", note.title],
        ["content", note.content],
      ] as const).filter(([, value]) => value.toLocaleLowerCase().includes(normalizedQuery)).map(([source]) => source)
    : undefined;
  return AiReadItemSchema.parse({
    source_type: "note",
    source_id: note.id,
    workspace_id: note.workspace_id,
    title: note.title.trim().slice(0, 160),
    ...(hitSources?.length ? { hit_sources: hitSources } : {}),
    status: note.status,
    revision: note.revision,
    updated_at: note.updated_at,
  });
}

function reminderHit(reminder: Reminder): AiReadItem {
  return AiReadItemSchema.parse({
    source_type: "reminder",
    source_id: reminder.id,
    workspace_id: reminder.workspace_id,
    title: reminder.title.trim().slice(0, 160),
    remind_at: reminder.remind_at,
    status: reminder.status,
    revision: reminder.revision,
    updated_at: reminder.updated_at,
  });
}

function reminderRepositoryCursor(reminder: Pick<Reminder, "remind_at" | "id">) {
  return encodeURIComponent(`${reminder.remind_at}|${reminder.id}`);
}

function databaseHit(database: Database): AiReadItem {
  return AiReadItemSchema.parse({
    source_type: "database",
    source_id: database.id,
    workspace_id: database.workspace_id,
    title: database.name.trim().slice(0, 160),
    excerpt: database.description.slice(0, 1_000),
    revision: database.revision,
    updated_at: database.updated_at,
  });
}

function recordTitle(record: DatabaseRecord, properties: readonly DatabaseProperty[]) {
  const firstValue = properties
    .map((property) => record.values[property.id])
    .find((value) => typeof value === "string" && value.trim());
  return typeof firstValue === "string" ? firstValue.trim().slice(0, 160) : `Record ${record.id}`;
}

function recordHit(record: DatabaseRecord, properties: readonly DatabaseProperty[]): AiReadItem {
  const readablePropertyIds = new Set(properties.map((property) => property.id));
  let readableValues = Object.fromEntries(
    Object.entries(record.values).filter(([propertyId]) => readablePropertyIds.has(propertyId)),
  );
  if (new TextEncoder().encode(JSON.stringify(readableValues)).byteLength > 16_000) {
    readableValues = {};
  }
  return AiReadItemSchema.parse({
    source_type: "database_record",
    source_id: record.id,
    workspace_id: record.workspace_id,
    title: recordTitle(record, properties),
    values: readableValues,
    revision: record.revision,
    updated_at: record.updated_at,
  });
}

function result(
  tool: AiReadToolName,
  items: AiReadItem[],
  context: AiReadExecutionContext,
  nextCursor: string | null = null,
  selectedOnly = !context.allowWorkspaceSearch,
): AiReadResult {
  const scope = { workspace_id: context.workspaceId, selected_only: selectedOnly };
  const candidate = { tool, items, next_cursor: nextCursor, scope };
  if (items.length > MAX_RESULTS || new TextEncoder().encode(JSON.stringify(candidate)).byteLength > MAX_RESULT_BYTES) {
    throw new AiReadToolError("AI_READ_RESULT_TOO_LARGE", "AI read result exceeded the bounded size", 413);
  }
  return AiReadResultSchema.parse(candidate);
}

function canAppendResult(
  tool: AiReadToolName,
  items: readonly AiReadItem[],
  item: AiReadItem,
  context: AiReadExecutionContext,
  nextCursor: string | null,
  selectedOnly = !context.allowWorkspaceSearch,
) {
  if (items.length >= MAX_RESULTS) return false;
  const candidate = {
    tool,
    items: [...items, item],
    next_cursor: nextCursor,
    scope: { workspace_id: context.workspaceId, selected_only: selectedOnly },
  };
  return new TextEncoder().encode(JSON.stringify(candidate)).byteLength <= MAX_RESULT_BYTES;
}

function matchesNote(note: Note, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return !normalized || `${note.title}\n${note.content}`.toLocaleLowerCase().includes(normalized);
}

function fingerprint(value: string) {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function selectedNoteScopeFingerprint(noteIds: readonly string[]) {
  return fingerprint(noteIds.join("\u001f"));
}

type SelectedNoteCursor = {
  scope: "selected_notes";
  workspace_id: string;
  user_id: string;
  offset: number;
  query_hash: string;
  selection_hash: string;
};

function encodeSelectedNoteCursor(context: AiReadExecutionContext, offset: number, query: string, noteIds: readonly string[]) {
  return encodeURIComponent(JSON.stringify({
    scope: "selected_notes",
    workspace_id: context.workspaceId,
    user_id: context.userId,
    offset,
    query_hash: fingerprint(query.trim().toLocaleLowerCase()),
    selection_hash: selectedNoteScopeFingerprint(noteIds),
  } satisfies SelectedNoteCursor));
}

function decodeSelectedNoteCursor(value: unknown, context: AiReadExecutionContext, query: string, noteIds: readonly string[]) {
  if (typeof value !== "string" || !value) {
    throw new AiReadToolError("AI_READ_CURSOR_INVALID", "The selected-note cursor is invalid", 400);
  }
  try {
    const decoded = JSON.parse(decodeURIComponent(value)) as {
      scope?: unknown;
      workspace_id?: unknown;
      user_id?: unknown;
      offset?: unknown;
      query_hash?: unknown;
      selection_hash?: unknown;
    };
    if (
      decoded.scope !== "selected_notes"
      || decoded.workspace_id !== context.workspaceId
      || decoded.user_id !== context.userId
      || typeof decoded.offset !== "number"
      || !Number.isInteger(decoded.offset)
      || decoded.offset < 0
      || decoded.offset > noteIds.length
      || decoded.query_hash !== fingerprint(query.trim().toLocaleLowerCase())
      || decoded.selection_hash !== selectedNoteScopeFingerprint(noteIds)
    ) {
      throw new Error("invalid selected-note cursor");
    }
    return decoded.offset;
  } catch {
    throw new AiReadToolError("AI_READ_CURSOR_INVALID", "The selected-note cursor is invalid for this scope", 400);
  }
}

type WorkspaceDatabaseCursor = {
  scope: "workspace_databases";
  workspace_id: string;
  user_id: string;
  query_hash: string;
  database_cursor: string | null;
  database_id: string | null;
  database_emitted: boolean;
  record_cursor: string | null;
  legacy_database_position?: boolean;
};

type WorkspaceNoteCursor = {
  scope: "workspace_notes";
  workspace_id: string;
  user_id: string;
  query_hash: string;
  note_cursor: string;
};

type WorkspaceReminderCursor = {
  scope: "workspace_reminders";
  workspace_id: string;
  user_id: string;
  status: "all" | "pending";
  query_hash: string;
  reminder_cursor: string;
};

type SelectedDatabaseCursor = {
  scope: "selected_databases";
  workspace_id: string;
  user_id: string;
  query_hash: string;
  selection_hash: string;
  database_index: number;
  database_emitted: boolean;
  record_cursor: string | null;
};

function encodeWorkspaceDatabaseCursor(cursor: WorkspaceDatabaseCursor) {
  return encodeURIComponent(JSON.stringify(cursor));
}

function encodeSelectedDatabaseCursor(cursor: SelectedDatabaseCursor) {
  return encodeURIComponent(JSON.stringify(cursor));
}

function encodeWorkspaceNoteCursor(context: AiReadExecutionContext, query: string, noteCursor: string) {
  return encodeURIComponent(JSON.stringify({
    scope: "workspace_notes",
    workspace_id: context.workspaceId,
    user_id: context.userId,
    query_hash: fingerprint(query.trim().toLocaleLowerCase()),
    note_cursor: noteCursor,
  } satisfies WorkspaceNoteCursor));
}

function decodeWorkspaceNoteCursor(value: unknown, context: AiReadExecutionContext, query: string) {
  if (value === undefined || value === null) return null;
  const queryHash = fingerprint(query.trim().toLocaleLowerCase());
  try {
    const decoded = JSON.parse(decodeURIComponent(String(value))) as Partial<WorkspaceNoteCursor>;
    if (
      decoded.scope === "workspace_notes"
      && decoded.workspace_id === context.workspaceId
      && decoded.user_id === context.userId
      && decoded.query_hash === queryHash
      && typeof decoded.note_cursor === "string"
      && decoded.note_cursor.length > 0
    ) {
      return { cursor: decoded.note_cursor, legacy: false };
    }
  } catch {
    // Fall through to the legacy cursor compatibility path below.
  }
  throw new AiReadToolError("AI_READ_CURSOR_INVALID", "The workspace note cursor is invalid for this query", 400);
}

function encodeWorkspaceReminderCursor(context: AiReadExecutionContext, status: "all" | "pending", query: string, reminderCursor: string) {
  return encodeURIComponent(JSON.stringify({
    scope: "workspace_reminders",
    workspace_id: context.workspaceId,
    user_id: context.userId,
    status,
    query_hash: fingerprint(query.trim().toLocaleLowerCase()),
    reminder_cursor: reminderCursor,
  } satisfies WorkspaceReminderCursor));
}

function decodeWorkspaceReminderCursor(
  value: unknown,
  context: AiReadExecutionContext,
  status: "all" | "pending",
  query: string,
) {
  if (value === undefined || value === null) return null;
  const queryHash = fingerprint(query.trim().toLocaleLowerCase());
  try {
    const decoded = JSON.parse(decodeURIComponent(String(value))) as Partial<WorkspaceReminderCursor>;
    if (
      decoded.scope === "workspace_reminders"
      && decoded.workspace_id === context.workspaceId
      && decoded.user_id === context.userId
      && decoded.status === status
      && decoded.query_hash === queryHash
      && typeof decoded.reminder_cursor === "string"
      && decoded.reminder_cursor.length > 0
    ) {
      return { cursor: decoded.reminder_cursor, legacy: false };
    }
  } catch {
    // Fall through to the legacy cursor compatibility path below.
  }
  throw new AiReadToolError("AI_READ_CURSOR_INVALID", "The reminder cursor is invalid for this query", 400);
}

function decodeDatabaseCursor(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    const decoded = JSON.parse(decodeURIComponent(value)) as { database_id?: unknown; cursor?: unknown };
    if (typeof decoded.database_id !== "string" || !decoded.database_id || typeof decoded.cursor !== "string" || !decoded.cursor) {
      throw new Error("invalid cursor");
    }
    return { databaseId: decoded.database_id, cursor: decoded.cursor };
  } catch {
    throw new AiReadToolError("AI_READ_CURSOR_INVALID", "The AI database cursor is invalid", 400);
  }
}

function validateLegacyRecordCursor(databaseId: string, recordCursor: string, query: string) {
  try {
    const decoded = decodeRecordCursor(recordCursor);
    const expected = cursorFingerprint({ kind: "search", database_id: databaseId, query });
    if (decoded.fingerprint !== expected) throw new Error("legacy cursor query mismatch");
  } catch {
    throw new AiReadToolError("AI_READ_CURSOR_INVALID", "The legacy AI database cursor is invalid for this query", 400);
  }
}

function selectedDatabaseScopeFingerprint(databaseIds: readonly string[]) {
  return fingerprint(databaseIds.join("\u001f"));
}

function decodeSelectedDatabaseCursor(
  value: unknown,
  context: AiReadExecutionContext,
  query: string,
  databaseIds: readonly string[],
): SelectedDatabaseCursor | null {
  if (value === undefined || value === null) return null;
  const expectedQueryHash = fingerprint(query.trim().toLocaleLowerCase());
  const expectedSelectionHash = selectedDatabaseScopeFingerprint(databaseIds);
  try {
    const decoded = JSON.parse(decodeURIComponent(String(value))) as Record<string, unknown>;
    if (decoded.scope === "selected_databases") {
      if (
        decoded.workspace_id !== context.workspaceId
        || decoded.user_id !== context.userId
        || decoded.query_hash !== expectedQueryHash
        || decoded.selection_hash !== expectedSelectionHash
        || typeof decoded.database_index !== "number"
        || !Number.isInteger(decoded.database_index)
        || decoded.database_index < 0
        || decoded.database_index >= databaseIds.length
        || typeof decoded.database_emitted !== "boolean"
        || (decoded.record_cursor !== null && typeof decoded.record_cursor !== "string")
        || (typeof decoded.record_cursor === "string" && !decoded.record_cursor)
      ) {
        throw new Error("invalid selected database cursor");
      }
      return decoded as SelectedDatabaseCursor;
    }

    // Accept the earlier Task 5 cursor shape without weakening selected scope checks.
    const legacy = decodeDatabaseCursor(value);
    if (!legacy) throw new Error("invalid selected database cursor");
    const databaseIndex = databaseIds.indexOf(legacy.databaseId);
    if (databaseIndex < 0) {
      throw new AiReadToolError("AI_READ_TARGET_NOT_SELECTED", "The cursor database must be explicitly selected", 403);
    }
    validateLegacyRecordCursor(legacy.databaseId, legacy.cursor, query.trim().toLocaleLowerCase());
    return {
      scope: "selected_databases",
      workspace_id: context.workspaceId,
      user_id: context.userId,
      query_hash: expectedQueryHash,
      selection_hash: expectedSelectionHash,
      database_index: databaseIndex,
      database_emitted: true,
      record_cursor: legacy.cursor,
    };
  } catch (error) {
    if (error instanceof AiReadToolError) throw error;
    throw new AiReadToolError("AI_READ_CURSOR_INVALID", "The AI database cursor is invalid for this selected scope", 400);
  }
}

function decodeWorkspaceDatabaseCursor(value: unknown, context: AiReadExecutionContext, query: string): WorkspaceDatabaseCursor | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value) {
    throw new AiReadToolError("AI_READ_CURSOR_INVALID", "The AI database cursor is invalid", 400);
  }
  try {
    const decoded = JSON.parse(decodeURIComponent(value)) as Partial<WorkspaceDatabaseCursor> & { database_id?: unknown; cursor?: unknown };
    if (decoded.scope === undefined) {
      const legacy = decodeDatabaseCursor(value);
      if (!legacy) throw new Error("invalid legacy workspace database cursor");
      validateLegacyRecordCursor(legacy.databaseId, legacy.cursor, query.trim().toLocaleLowerCase());
      return {
        scope: "workspace_databases",
        workspace_id: context.workspaceId,
        user_id: context.userId,
        query_hash: fingerprint(query.trim().toLocaleLowerCase()),
        database_cursor: null,
        database_id: legacy.databaseId,
        database_emitted: true,
        record_cursor: legacy.cursor,
        legacy_database_position: true,
      };
    }
    if (
      decoded.scope !== "workspace_databases"
      || decoded.workspace_id !== context.workspaceId
      || decoded.user_id !== context.userId
      || decoded.query_hash !== fingerprint(query.trim().toLocaleLowerCase())
      || (decoded.database_cursor !== null && typeof decoded.database_cursor !== "string")
      || (typeof decoded.database_cursor === "string" && !decoded.database_cursor)
      || (decoded.database_id !== null && typeof decoded.database_id !== "string")
      || (typeof decoded.database_id === "string" && !decoded.database_id)
      || typeof decoded.database_emitted !== "boolean"
      || (decoded.record_cursor !== null && typeof decoded.record_cursor !== "string")
      || (typeof decoded.record_cursor === "string" && !decoded.record_cursor)
      || (decoded.database_id === null && (decoded.database_emitted || decoded.record_cursor !== null))
      || (decoded.legacy_database_position !== undefined && typeof decoded.legacy_database_position !== "boolean")
    ) {
      throw new Error("invalid workspace database cursor");
    }
    return decoded as WorkspaceDatabaseCursor;
  } catch {
    throw new AiReadToolError("AI_READ_CURSOR_INVALID", "The AI database cursor is invalid for this query", 400);
  }
}

export class AiReadTools {
  private readonly deadlineMs: number;
  private readonly maxResults: number;

  constructor(private readonly dependencies: AiReadToolsDependencies) {
    const deadlineMs = Number.isFinite(dependencies.deadlineMs) ? dependencies.deadlineMs! : DEFAULT_DEADLINE_MS;
    const maxResults = Number.isFinite(dependencies.maxResults) ? dependencies.maxResults! : DEFAULT_MAX_RESULTS;
    this.deadlineMs = Math.max(1, Math.min(Math.floor(deadlineMs), 30_000));
    this.maxResults = Math.max(1, Math.min(Math.floor(maxResults), MAX_RESULTS));
  }

  execute(tool: AiReadToolName, input: unknown, context: AiReadExecutionContext, signal?: AbortSignal): Promise<AiReadResult>;
  execute(call: { tool: AiReadToolName; input: unknown }, context: AiReadExecutionContext, signal?: AbortSignal): Promise<AiReadResult>;
  execute(
    toolOrCall: AiReadToolName | { tool: AiReadToolName; input: unknown },
    inputOrContext: unknown,
    contextOrSignal?: AiReadExecutionContext | AbortSignal,
    maybeSignal?: AbortSignal,
  ): Promise<AiReadResult> {
    const isCall = typeof toolOrCall === "object";
    const tool = isCall ? toolOrCall.tool : toolOrCall;
    const rawInput = isCall ? toolOrCall.input : inputOrContext;
    const rawContext = isCall ? inputOrContext as AiReadExecutionContext : contextOrSignal as AiReadExecutionContext;
    const signal = isCall ? contextOrSignal as AbortSignal | undefined : maybeSignal;
    return this.withDeadline((activeSignal) => this.executeInner(tool, rawInput, rawContext, activeSignal), signal);
  }

  private async executeInner(tool: AiReadToolName, rawInput: unknown, rawContext: AiReadExecutionContext, signal: AbortSignal): Promise<AiReadResult> {
    const context = normalizeContext(rawContext);
    const parsedTool = AiReadToolNameSchema.safeParse(tool);
    if (!parsedTool.success) throw new AiReadToolError("AI_READ_TOOL_INVALID", "AI read tool is not allowlisted", 400);
    if (!isObject(rawInput)) throw new AiReadToolError("AI_READ_INPUT_INVALID", "AI read tool input must be an object", 400);
    const parsedCall = AiReadToolCallSchema.safeParse({ tool: parsedTool.data, input: rawInput });
    if (!parsedCall.success) throw new AiReadToolError("AI_READ_INPUT_INVALID", "AI read tool input is invalid", 400);

    switch (parsedCall.data.tool) {
      case "search_notes": return this.searchNotes(parsedCall.data.input, context, signal);
      case "get_note": return this.getNote(parsedCall.data.input, context, signal);
      case "list_reminders": return this.listReminders(parsedCall.data.input, context, signal);
      case "search_databases": return this.searchDatabases(parsedCall.data.input, context, signal);
      case "get_database_record": return this.getDatabaseRecord(parsedCall.data.input, context, signal);
    }
  }

  private async searchNotes(input: ReadInput, context: AiReadExecutionContext, signal: AbortSignal) {
    const limit = Math.min(limitValue(input.limit, this.maxResults), this.maxResults);
    const query = typeof input.query === "string" ? input.query : "";
    if (!context.allowWorkspaceSearch && context.selectedNoteIds.length === 0) {
      throw new AiReadToolError("AI_READ_SCOPE_REQUIRED", "Select notes or explicitly enable workspace search", 400);
    }
    if (context.allowWorkspaceSearch) {
      return this.searchWorkspaceNotes(query, limit, input.cursor, context, signal);
    }

    const items: AiReadItem[] = [];
    const selectedNoteIds = context.selectedNoteIds.slice(0, MAX_SELECTED_ENTITIES);
    const offset = input.cursor === undefined ? 0 : decodeSelectedNoteCursor(input.cursor, context, query, selectedNoteIds);
    for (let index = offset; index < selectedNoteIds.length; index += 1) {
      signal.throwIfAborted();
      const noteId = selectedNoteIds[index];
      try {
        const note = await this.dependencies.notes.get({ workspaceId: context.workspaceId, userId: context.userId }, noteId, signal);
        assertWorkspace(note, context);
        if (matchesNote(note, query)) {
          const item = noteHit(note, false, query);
          const nextOffset = index + 1;
          const nextCursor = nextOffset < selectedNoteIds.length
            ? encodeSelectedNoteCursor(context, nextOffset, query, selectedNoteIds)
            : null;
          if (!canAppendResult("search_notes", items, item, context, nextCursor)) {
            const retryCursor = encodeSelectedNoteCursor(context, index, query, selectedNoteIds);
            if (items.length === 0) return result("search_notes", [item], context, nextCursor);
            return result("search_notes", items, context, retryCursor);
          }
          items.push(item);
          if (items.length >= limit) return result("search_notes", items, context, nextCursor);
        }
      } catch (error) {
        if (isPermissionError(error)) throw safeError(error, "AI_READ_NOTES_DENIED", "Selected note cannot be read");
        if (!isNotFoundError(error)) throw safeError(error, "AI_READ_NOTES_UNAVAILABLE", "Selected note cannot be read");
      }
    }
    return result("search_notes", items, context);
  }

  private async searchWorkspaceNotes(
    query: string,
    limit: number,
    rawCursor: unknown,
    context: AiReadExecutionContext,
    signal: AbortSignal,
  ) {
    const scopedCursor = decodeWorkspaceNoteCursor(rawCursor, context, query);
    try {
      const page = await this.dependencies.notes.list(
        { workspaceId: context.workspaceId, userId: context.userId },
        { query, status: "active", limit, ...(scopedCursor ? { cursor: scopedCursor.cursor } : {}) },
        signal,
      );
      if (scopedCursor && page.next_cursor === scopedCursor.cursor) {
        throw new AiReadToolError("AI_READ_PAGING_STALLED", "Workspace note pagination did not advance", 503, true);
      }
      const items: AiReadItem[] = [];
      for (let index = 0; index < page.items.length && items.length < limit; index += 1) {
        signal.throwIfAborted();
        const note = page.items[index]!;
        assertWorkspace(note, context);
        const rawNextCursor = index + 1 < page.items.length
          ? noteRepositoryCursor(note)
          : page.next_cursor;
        const nextCursor = rawNextCursor ? encodeWorkspaceNoteCursor(context, query, rawNextCursor) : null;
        const item = noteHit(note, false, query);
        if (!canAppendResult("search_notes", items, item, context, nextCursor)) {
          if (items.length === 0) {
            const compact = compactNoteHit(note, query);
            if (!canAppendResult("search_notes", [], compact, context, nextCursor)) {
              throw new AiReadToolError("AI_READ_RESULT_TOO_LARGE", "AI note result exceeded the bounded size", 413);
            }
            return result("search_notes", [compact], context, nextCursor);
          }
          const lastNote = page.items[index - 1]!;
          return result("search_notes", items, context, encodeWorkspaceNoteCursor(context, query, noteRepositoryCursor(lastNote)));
        }
        items.push(item);
        if (items.length >= limit) return result("search_notes", items, context, nextCursor);
      }
      const nextCursor = page.next_cursor ? encodeWorkspaceNoteCursor(context, query, page.next_cursor) : null;
      return result("search_notes", items, context, nextCursor);
    } catch (error) {
      throw safeError(error, "AI_READ_NOTES_DENIED", "Workspace note search is unavailable");
    }
  }

  private async getNote(input: ReadInput, context: AiReadExecutionContext, signal: AbortSignal) {
    const noteId = String(input.note_id ?? "");
    if (!context.selectedNoteIds.includes(noteId)) {
      throw new AiReadToolError("AI_READ_TARGET_NOT_SELECTED", "The note must be explicitly selected", 403);
    }
    try {
      const note = await this.dependencies.notes.get({ workspaceId: context.workspaceId, userId: context.userId }, noteId, signal);
      assertWorkspace(note, context);
      return result("get_note", [noteHit(note, true)], context, null, true);
    } catch (error) {
      throw safeError(error, "AI_READ_NOTE_DENIED", "The selected note cannot be read");
    }
  }

  private async listReminders(input: ReadInput, context: AiReadExecutionContext, signal: AbortSignal) {
    const includeCompleted = input.include_completed === true;
    const limit = Math.min(limitValue(input.limit, this.maxResults), this.maxResults);
    const status = includeCompleted ? "all" as const : "pending" as const;
    const query = typeof input.query === "string" ? input.query : "";
    return this.listReminderPage(status, query, limit, input.cursor, context, signal);
  }

  private async listReminderPage(
    status: "all" | "pending",
    query: string,
    limit: number,
    rawCursor: unknown,
    context: AiReadExecutionContext,
    signal: AbortSignal,
  ) {
    const scopedCursor = decodeWorkspaceReminderCursor(rawCursor, context, status, query);
    try {
      const page = await this.dependencies.knowledge.listReminderPage(
        { workspaceId: context.workspaceId, userId: context.userId },
        {
          status,
          limit,
          ...(query ? { query } : {}),
          ...(scopedCursor ? { cursor: scopedCursor.cursor } : {}),
        },
        signal,
      );
      if (scopedCursor && page.next_cursor === scopedCursor.cursor) {
        throw new AiReadToolError("AI_READ_PAGING_STALLED", "Reminder pagination did not advance", 503, true);
      }
      const items: AiReadItem[] = [];
      for (let index = 0; index < page.items.length && items.length < limit; index += 1) {
        signal.throwIfAborted();
        const reminder = page.items[index]!;
        assertWorkspace(reminder, context);
        const rawNextCursor = index + 1 < page.items.length
          ? reminderRepositoryCursor(reminder)
          : page.next_cursor;
        const nextCursor = rawNextCursor ? encodeWorkspaceReminderCursor(context, status, query, rawNextCursor) : null;
        const item = reminderHit(reminder);
        if (!canAppendResult("list_reminders", items, item, context, nextCursor)) {
          if (items.length === 0) {
            const compact = AiReadItemSchema.parse({
              source_type: "reminder",
              source_id: reminder.id,
              workspace_id: reminder.workspace_id,
              title: reminder.title.trim().slice(0, 160),
              status: reminder.status,
              revision: reminder.revision,
              updated_at: reminder.updated_at,
            });
            if (!canAppendResult("list_reminders", [], compact, context, nextCursor)) {
              throw new AiReadToolError("AI_READ_RESULT_TOO_LARGE", "AI reminder result exceeded the bounded size", 413);
            }
            return result("list_reminders", [compact], context, nextCursor, false);
          }
          const lastReminder = page.items[index - 1]!;
          return result("list_reminders", items, context, encodeWorkspaceReminderCursor(context, status, query, reminderRepositoryCursor(lastReminder)), false);
        }
        items.push(item);
        if (items.length >= limit) return result("list_reminders", items, context, nextCursor, false);
      }
      const nextCursor = page.next_cursor ? encodeWorkspaceReminderCursor(context, status, query, page.next_cursor) : null;
      return result("list_reminders", items, context, nextCursor, false);
    } catch (error) {
      throw safeError(error, "AI_READ_REMINDERS_UNAVAILABLE", "Reminders cannot be read right now");
    }
  }

  private async accessibleDatabase(context: AiReadExecutionContext, databaseId: string, selectedOnly: boolean, signal: AbortSignal): Promise<ReadDatabaseBundle> {
    if (selectedOnly && !context.selectedDatabaseIds.includes(databaseId)) {
      throw new AiReadToolError("AI_READ_TARGET_NOT_SELECTED", "The database must be explicitly selected", 403);
    }
    try {
      const bundle = await this.dependencies.databases.getDatabase(workspaceActor(context), databaseId, signal);
      assertWorkspace(bundle.database, context);
      return bundle;
    } catch (error) {
      throw safeError(error, "AI_READ_DATABASE_DENIED", "The database cannot be read");
    }
  }

  private async searchDatabases(input: ReadInput, context: AiReadExecutionContext, signal: AbortSignal) {
    const query = typeof input.query === "string" ? input.query.trim().toLocaleLowerCase() : "";
    const limit = Math.min(limitValue(input.limit, this.maxResults), this.maxResults);
    if (context.allowWorkspaceSearch) {
      return this.searchWorkspaceDatabases(query, limit, input.cursor, context, signal);
    }
    if (context.selectedDatabaseIds.length === 0) {
      throw new AiReadToolError("AI_READ_SCOPE_REQUIRED", "Select databases or explicitly enable workspace search", 400);
    }
    return this.searchSelectedDatabases(query, limit, input.cursor, context, signal);
  }

  private async searchSelectedDatabases(
    query: string,
    limit: number,
    rawCursor: unknown,
    context: AiReadExecutionContext,
    signal: AbortSignal,
  ) {
    const databaseIds = context.selectedDatabaseIds.slice(0, MAX_SELECTED_ENTITIES);
    let state = decodeSelectedDatabaseCursor(rawCursor, context, query, databaseIds) ?? {
      scope: "selected_databases" as const,
      workspace_id: context.workspaceId,
      user_id: context.userId,
      query_hash: fingerprint(query.trim().toLocaleLowerCase()),
      selection_hash: selectedDatabaseScopeFingerprint(databaseIds),
      database_index: 0,
      database_emitted: false,
      record_cursor: null,
    };
    const items: AiReadItem[] = [];
    let recordPageRequests = 0;
    const seenRecordCursors = new Set<string>();

    while (state.database_index < databaseIds.length) {
      signal.throwIfAborted();
      const databaseId = databaseIds[state.database_index]!;
      const checkpoint = state;
      const bundle = await this.accessibleDatabase(context, databaseId, true, signal);

      if (!state.database_emitted) {
        const databaseText = `${bundle.database.name}\n${bundle.database.description}`.toLocaleLowerCase();
        const emittedState = { ...state, database_emitted: true } satisfies SelectedDatabaseCursor;
        if (!query || databaseText.includes(query)) {
          const item = databaseHit(bundle.database);
          const continuation = query || state.database_index + 1 < databaseIds.length
            ? encodeSelectedDatabaseCursor(emittedState)
            : null;
          if (!canAppendResult("search_databases", items, item, context, continuation, true)) {
            if (items.length === 0) throw new AiReadToolError("AI_READ_RESULT_TOO_LARGE", "AI database result exceeded the bounded size", 413);
            return result("search_databases", items, context, encodeSelectedDatabaseCursor(checkpoint), true);
          }
          items.push(item);
          state = emittedState;
          if (items.length >= limit) return result("search_databases", items, context, continuation, true);
        } else {
          state = emittedState;
        }
      }

      if (query && items.length < limit) {
        try {
          const currentRecordCursor = state.record_cursor;
          const recordCursorKey = `${databaseId}\u001f${currentRecordCursor ?? "<initial>"}`;
          if (recordPageRequests >= MAX_RECORD_PAGE_REQUESTS || seenRecordCursors.has(recordCursorKey)) {
            throw new AiReadToolError("AI_READ_PAGING_STALLED", "Database record pagination did not advance", 503, true);
          }
          recordPageRequests += 1;
          seenRecordCursors.add(recordCursorKey);
          const page = await this.dependencies.databases.searchRecords(workspaceActor(context), databaseId, {
            query,
            limit: 1,
            ...(currentRecordCursor ? { cursor: currentRecordCursor } : {}),
            signal,
          });
          if (page.next_cursor !== null && (!page.next_cursor || page.next_cursor === currentRecordCursor)) {
            throw new AiReadToolError("AI_READ_PAGING_STALLED", "Database record pagination did not advance", 503, true);
          }
          const record = page.items[0];
          if (record) {
            assertWorkspace(record, context);
            const nextState: SelectedDatabaseCursor = page.next_cursor
              ? { ...state, database_emitted: true, record_cursor: page.next_cursor }
              : { ...state, database_index: state.database_index + 1, database_emitted: false, record_cursor: null };
            const continuation = nextState.database_index < databaseIds.length
              ? encodeSelectedDatabaseCursor(nextState)
              : null;
            let item = recordHit(record, bundle.properties);
            if (!canAppendResult("search_databases", items, item, context, continuation, true) && items.length === 0) {
              item = AiReadItemSchema.parse({ ...item, values: {} });
            }
            if (!canAppendResult("search_databases", items, item, context, continuation, true)) {
              return result("search_databases", items, context, encodeSelectedDatabaseCursor(state), true);
            }
            items.push(item);
            state = nextState;
            if (items.length >= limit) return result("search_databases", items, context, continuation, true);
            continue;
          }
          if (page.next_cursor) {
            state = { ...state, database_emitted: true, record_cursor: page.next_cursor };
            continue;
          }
        } catch (error) {
          if (!isPermissionError(error) && !isNotFoundError(error)) {
            throw safeError(error, "AI_READ_DATABASES_UNAVAILABLE", "Database records cannot be searched");
          }
        }
      }
      state = { ...state, database_index: state.database_index + 1, database_emitted: false, record_cursor: null };
    }
    return result("search_databases", items, context, null, true);
  }

  private async searchWorkspaceDatabases(
    query: string,
    limit: number,
    rawCursor: unknown,
    context: AiReadExecutionContext,
    signal: AbortSignal,
  ) {
    const cursor = decodeWorkspaceDatabaseCursor(rawCursor, context, query);
    let state: WorkspaceDatabaseCursor = cursor ?? {
      scope: "workspace_databases",
      workspace_id: context.workspaceId,
      user_id: context.userId,
      query_hash: fingerprint(query.trim().toLocaleLowerCase()),
      database_cursor: null,
      database_id: null,
      database_emitted: false,
      record_cursor: null,
    };
    const items: AiReadItem[] = [];
    let databasesVisited = 0;
    let activeDatabaseId: string | null = null;
    let databasePageRequests = 0;
    const seenDatabaseCursors = new Set<string>();
    let recordPageRequests = 0;
    const seenRecordCursors = new Set<string>();

    while (true) {
      signal.throwIfAborted();
      if (state.database_id === null && databasesVisited >= MAX_DATABASES_PER_READ) {
        return result("search_databases", items, context, encodeWorkspaceDatabaseCursor(state));
      }
      let database: Database | undefined;
      let databaseCursor: string | null = state.database_cursor;
      let recordCursor: string | null = state.record_cursor;
      let databaseEmitted = state.database_emitted;
      if (state.database_id) {
        database = { id: state.database_id } as Database;
      } else {
        const cursorKey = state.database_cursor ?? "<initial>";
        if (databasePageRequests >= MAX_DATABASE_PAGE_REQUESTS || seenDatabaseCursors.has(cursorKey)) {
          throw new AiReadToolError("AI_READ_PAGING_STALLED", "Database pagination did not advance", 503, true);
        }
        seenDatabaseCursors.add(cursorKey);
        databasePageRequests += 1;
        let page: { items: Database[]; next_cursor: string | null };
        try {
          page = await this.dependencies.databases.listDatabasePage(
            workspaceActor(context),
            { cursor: state.database_cursor, limit: 1 },
            signal,
          );
        } catch (error) {
          throw safeError(error, "AI_READ_DATABASES_UNAVAILABLE", "Databases cannot be read right now");
        }
        if (page.next_cursor !== null && page.next_cursor === state.database_cursor) {
          throw new AiReadToolError("AI_READ_PAGING_STALLED", "Database pagination did not advance", 503, true);
        }
        database = page.items[0];
        if (!database) {
          if (!page.next_cursor) break;
          state = { ...state, database_cursor: page.next_cursor };
          continue;
        }
        databaseCursor = page.next_cursor;
        recordCursor = null;
        databaseEmitted = false;
      }

      if (database.id !== activeDatabaseId) {
        databasesVisited += 1;
        activeDatabaseId = database.id;
      }

      const provisionalDatabase = {
        ...state,
        database_id: database.id,
        database_cursor: databaseCursor,
        database_emitted: databaseEmitted,
        record_cursor: recordCursor,
      } satisfies WorkspaceDatabaseCursor;
      let bundle: ReadDatabaseBundle;
      try {
        bundle = await this.accessibleDatabase(context, database.id, false, signal);
      } catch (error) {
        if (isPermissionError(error) || isNotFoundError(error)) {
          if (state.legacy_database_position) {
            throw new AiReadToolError("AI_READ_CURSOR_INVALID", "The legacy database cursor target is no longer readable", 400);
          }
          if (databaseCursor === null) break;
          state = { ...provisionalDatabase, database_id: null, database_emitted: false, record_cursor: null };
          continue;
        }
        throw error;
      }

      if (state.legacy_database_position) {
        databaseCursor = encodeDatabasePageCursor(bundle.database);
      }
      const beforeDatabase = {
        ...provisionalDatabase,
        database_cursor: databaseCursor,
        legacy_database_position: undefined,
      } satisfies WorkspaceDatabaseCursor;
      let checkpoint = beforeDatabase;

      if (!databaseEmitted) {
        const databaseText = `${bundle.database.name}\n${bundle.database.description}`.toLocaleLowerCase();
        if (!query || databaseText.includes(query)) {
          const item = databaseHit(bundle.database);
          const emittedState = { ...beforeDatabase, database_emitted: true } satisfies WorkspaceDatabaseCursor;
          const continuation = encodeWorkspaceDatabaseCursor(emittedState);
          if (!canAppendResult("search_databases", items, item, context, continuation)) {
            if (items.length === 0) throw new AiReadToolError("AI_READ_RESULT_TOO_LARGE", "AI database result exceeded the bounded size", 413);
            return result("search_databases", items, context, encodeWorkspaceDatabaseCursor(beforeDatabase));
          }
          items.push(item);
          checkpoint = emittedState;
          databaseEmitted = true;
          if (items.length >= limit) {
            const nextCursor = query || databaseCursor !== null ? encodeWorkspaceDatabaseCursor(emittedState) : null;
            return result("search_databases", items, context, nextCursor);
          }
        } else {
          databaseEmitted = true;
          checkpoint = { ...beforeDatabase, database_emitted: true };
        }
      }

      if (query && items.length < limit) {
        try {
          const currentRecordCursor = recordCursor;
          const recordCursorKey = `${database.id}\u001f${currentRecordCursor ?? "<initial>"}`;
          if (recordPageRequests >= MAX_RECORD_PAGE_REQUESTS || seenRecordCursors.has(recordCursorKey)) {
            throw new AiReadToolError("AI_READ_PAGING_STALLED", "Database record pagination did not advance", 503, true);
          }
          recordPageRequests += 1;
          seenRecordCursors.add(recordCursorKey);
          const page = await this.dependencies.databases.searchRecords(workspaceActor(context), database.id, {
            query,
            limit: 1,
            ...(currentRecordCursor ? { cursor: currentRecordCursor } : {}),
            signal,
          });
          if (page.next_cursor !== null && (!page.next_cursor || page.next_cursor === currentRecordCursor)) {
            throw new AiReadToolError("AI_READ_PAGING_STALLED", "Database record pagination did not advance", 503, true);
          }
          const record = page.items[0];
          if (record) {
            assertWorkspace(record, context);
            const item = recordHit(record, bundle.properties);
            const afterRecord = page.next_cursor
              ? { ...beforeDatabase, database_emitted: true, record_cursor: page.next_cursor }
              : { ...beforeDatabase, database_id: null, database_emitted: false, record_cursor: null };
            const nextCursor = page.next_cursor || databaseCursor !== null
              ? encodeWorkspaceDatabaseCursor(afterRecord)
              : null;
            let boundedItem = item;
            if (!canAppendResult("search_databases", items, boundedItem, context, nextCursor) && items.length === 0) {
              boundedItem = AiReadItemSchema.parse({ ...item, values: {} });
            }
            if (!canAppendResult("search_databases", items, boundedItem, context, nextCursor)) {
              return result("search_databases", items, context, encodeWorkspaceDatabaseCursor(checkpoint));
            }
            items.push(boundedItem);
            if (items.length >= limit) return result("search_databases", items, context, nextCursor);
            if (!page.next_cursor) {
              if (databaseCursor === null) break;
              state = afterRecord;
              continue;
            }
            state = afterRecord;
            continue;
          }
          if (page.next_cursor) {
            state = { ...beforeDatabase, database_emitted: true, record_cursor: page.next_cursor };
            continue;
          }
        } catch (error) {
          if (!isPermissionError(error) && !isNotFoundError(error)) throw safeError(error, "AI_READ_DATABASES_UNAVAILABLE", "Database records cannot be searched");
        }
      }
      if (databaseCursor === null) break;
      state = { ...beforeDatabase, database_id: null, database_emitted: false, record_cursor: null };
    }
    return result("search_databases", items, context);
  }

  private async getDatabaseRecord(input: ReadInput, context: AiReadExecutionContext, signal: AbortSignal) {
    const databaseId = String(input.database_id ?? "");
    const recordId = String(input.record_id ?? "");
    const bundle = await this.accessibleDatabase(context, databaseId, true, signal);
    try {
      const record = await this.dependencies.databases.getRecord(workspaceActor(context), databaseId, recordId, signal);
      assertWorkspace(record, context);
      if (record.database_id !== databaseId) throw new AiReadToolError("AI_READ_CROSS_WORKSPACE", "Record does not belong to the selected database", 403);
      return result("get_database_record", [recordHit(record, bundle.properties)], context, null, true);
    } catch (error) {
      throw safeError(error, "AI_READ_RECORD_DENIED", "The selected database record cannot be read");
    }
  }

  private withDeadline<T>(task: (signal: AbortSignal) => Promise<T>, externalSignal?: AbortSignal): Promise<T> {
    if (externalSignal?.aborted) return Promise.reject(externalSignal.reason ?? new DOMException("The operation was aborted", "AbortError"));
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        externalSignal?.removeEventListener("abort", onAbort);
        controller.abort(new DOMException("AI read timed out", "TimeoutError"));
        reject(new AiReadToolError("AI_READ_TIMEOUT", "AI read timed out", 504, true));
      }, this.deadlineMs);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onAbort);
        controller.abort(externalSignal?.reason);
        reject(externalSignal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
      };
      externalSignal?.addEventListener("abort", onAbort, { once: true });
      void task(controller.signal).then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onAbort);
        resolve(value);
      }).catch((error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", onAbort);
        reject(error);
      });
    });
  }
}
