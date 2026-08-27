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
import type { KnowledgeService } from "../knowledge/knowledge-service";
import type { NoteService } from "../notes/note-service";

const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS = 50;
const MAX_SELECTED_ENTITIES = 50;
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
  databases: Pick<D1DatabaseRepository, "listDatabases" | "getDatabase" | "searchRecords" | "getRecord">;
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
  const readableValues = Object.fromEntries(
    Object.entries(record.values).filter(([propertyId]) => readablePropertyIds.has(propertyId)),
  );
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
  const bounded: AiReadItem[] = [];
  for (const item of items.slice(0, MAX_RESULTS)) {
    const candidate = { tool, items: [...bounded, item], next_cursor: nextCursor, scope };
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > MAX_RESULT_BYTES) break;
    bounded.push(item);
  }
  return AiReadResultSchema.parse({ tool, items: bounded, next_cursor: nextCursor, scope });
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

function encodeSelectedNoteCursor(offset: number, query: string, noteIds: readonly string[]) {
  return encodeURIComponent(JSON.stringify({
    scope: "selected_notes",
    offset,
    query_hash: fingerprint(query.trim().toLocaleLowerCase()),
    selection_hash: selectedNoteScopeFingerprint(noteIds),
  }));
}

function decodeSelectedNoteCursor(value: unknown, query: string, noteIds: readonly string[]) {
  if (typeof value !== "string" || !value) {
    throw new AiReadToolError("AI_READ_CURSOR_INVALID", "The selected-note cursor is invalid", 400);
  }
  try {
    const decoded = JSON.parse(decodeURIComponent(value)) as {
      scope?: unknown;
      offset?: unknown;
      query_hash?: unknown;
      selection_hash?: unknown;
    };
    if (
      decoded.scope !== "selected_notes"
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

function encodeDatabaseCursor(databaseId: string, cursor: string) {
  return encodeURIComponent(JSON.stringify({ database_id: databaseId, cursor }));
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
      try {
        const page = await this.dependencies.notes.list(
          { workspaceId: context.workspaceId, userId: context.userId },
          { query, status: "active", limit, ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {}) },
          signal,
        );
        const items = page.items.map((note) => {
          assertWorkspace(note, context);
          return noteHit(note, false, query);
        });
        return result("search_notes", items, context, page.next_cursor);
      } catch (error) {
        throw safeError(error, "AI_READ_NOTES_DENIED", "Workspace note search is unavailable");
      }
    }

    const items: AiReadItem[] = [];
    const selectedNoteIds = context.selectedNoteIds.slice(0, MAX_SELECTED_ENTITIES);
    const offset = input.cursor === undefined ? 0 : decodeSelectedNoteCursor(input.cursor, query, selectedNoteIds);
    for (let index = offset; index < selectedNoteIds.length; index += 1) {
      signal.throwIfAborted();
      const noteId = selectedNoteIds[index];
      try {
        const note = await this.dependencies.notes.get({ workspaceId: context.workspaceId, userId: context.userId }, noteId, signal);
        assertWorkspace(note, context);
        if (matchesNote(note, query)) items.push(noteHit(note, false, query));
      } catch (error) {
        if (isPermissionError(error)) throw safeError(error, "AI_READ_NOTES_DENIED", "Selected note cannot be read");
        if (!isNotFoundError(error)) throw safeError(error, "AI_READ_NOTES_UNAVAILABLE", "Selected note cannot be read");
      }
      if (items.length >= limit) {
        const nextOffset = index + 1;
        const nextCursor = nextOffset < selectedNoteIds.length
          ? encodeSelectedNoteCursor(nextOffset, query, selectedNoteIds)
          : null;
        return result("search_notes", items, context, nextCursor);
      }
    }
    return result("search_notes", items, context);
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
    try {
      const page = await this.dependencies.knowledge.listReminderPage(
        { workspaceId: context.workspaceId, userId: context.userId },
        {
          status: includeCompleted ? "all" : "pending",
          limit,
          ...(typeof input.query === "string" && input.query ? { query: input.query } : {}),
          ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {}),
        },
        signal,
      );
      const items = page.items.map((reminder) => {
        assertWorkspace(reminder, context);
        return reminderHit(reminder);
      });
      return result("list_reminders", items, context, page.next_cursor);
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
    const cursor = decodeDatabaseCursor(input.cursor);
    if (cursor && !context.allowWorkspaceSearch && !context.selectedDatabaseIds.includes(cursor.databaseId)) {
      throw new AiReadToolError("AI_READ_TARGET_NOT_SELECTED", "The cursor database must be explicitly selected", 403);
    }
    if (!context.allowWorkspaceSearch && context.selectedDatabaseIds.length === 0) {
      throw new AiReadToolError("AI_READ_SCOPE_REQUIRED", "Select databases or explicitly enable workspace search", 400);
    }
    let candidates: Database[];
    try {
      candidates = context.allowWorkspaceSearch
        ? await this.dependencies.databases.listDatabases(workspaceActor(context), signal)
        : context.selectedDatabaseIds.slice(0, MAX_SELECTED_ENTITIES).map((id) => ({ id } as Database));
    } catch (error) {
      throw safeError(error, "AI_READ_DATABASES_UNAVAILABLE", "Databases cannot be read right now");
    }

    const items: AiReadItem[] = [];
    let nextCursor: string | null = null;
    for (const candidate of candidates.slice(0, MAX_SELECTED_ENTITIES)) {
      signal.throwIfAborted();
      if (cursor && candidate.id !== cursor.databaseId) continue;
      let bundle: ReadDatabaseBundle;
      try {
        bundle = await this.accessibleDatabase(context, candidate.id, !context.allowWorkspaceSearch, signal);
      } catch (error) {
        if (context.allowWorkspaceSearch && isPermissionError(error)) continue;
        throw error;
      }
      const databaseText = `${bundle.database.name}\n${bundle.database.description}`.toLocaleLowerCase();
      if (!query || databaseText.includes(query)) items.push(databaseHit(bundle.database));
      if (query && items.length < limit) {
        try {
          const page = await this.dependencies.databases.searchRecords(workspaceActor(context), bundle.database.id, {
            query,
            limit: limit - items.length,
            ...(cursor ? { cursor: cursor.cursor } : {}),
            signal,
          });
          for (const record of page.items) {
            assertWorkspace(record, context);
            items.push(recordHit(record, bundle.properties));
            if (items.length >= limit) break;
          }
          if (page.next_cursor) nextCursor = encodeDatabaseCursor(bundle.database.id, page.next_cursor);
        } catch (error) {
          if (!isPermissionError(error) && !isNotFoundError(error)) throw safeError(error, "AI_READ_DATABASES_UNAVAILABLE", "Database records cannot be searched");
        }
      }
      if (items.length >= limit) break;
    }
    return result("search_databases", items, context, nextCursor);
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
