import {
  CreateNoteInputSchema,
  SyncChangeSchema,
  SyncOperationResultSchema,
  UpdateNoteInputSchema,
  type Note,
  type SyncChange,
  type SyncOperation,
  type SyncOperationResult,
  type SyncPullResponse,
  type WorkspaceContext,
} from "@nexus/contracts";

import { D1NoteRepository } from "../notes/d1-note-repository";
import type { SyncRepository } from "./sync-service";

interface ProcessedOperationRow {
  result_json: string;
}

interface SyncChangeRow {
  cursor: number;
  entity_type: "note";
  entity_id: string;
  revision: number;
  kind: SyncChange["kind"];
  payload_json: string;
  note_id: string | null;
  note_workspace_id: string | null;
  note_folder_id: string | null;
  note_database_id: string | null;
  note_created_by: string | null;
  note_updated_by: string | null;
  note_title: string | null;
  note_content: string | null;
  note_status: Note["status"] | null;
  note_is_favorite: number | null;
  note_is_pinned: number | null;
  note_daily_date: string | null;
  note_revision: number | null;
  note_created_at: string | null;
  note_updated_at: string | null;
}

function rejected(operation: SyncOperation, error: string): SyncOperationResult {
  return { operation_id: operation.operation_id, status: "rejected", error };
}

function errorCode(error: unknown) {
  if (error instanceof Error && /DAILY_NOTE_EXISTS/iu.test(error.message)) return "DAILY_NOTE_CONFLICT";
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return "SYNC_APPLY_FAILED";
}

function notePayload(row: SyncChangeRow): Record<string, unknown> | null {
  if (!row.note_id) return null;
  return {
    id: row.note_id,
    workspace_id: row.note_workspace_id,
    folder_id: row.note_folder_id,
    database_id: row.note_database_id,
    created_by: row.note_created_by,
    updated_by: row.note_updated_by,
    title: row.note_title,
    content: row.note_content,
    status: row.note_status,
    is_favorite: Boolean(row.note_is_favorite),
    is_pinned: Boolean(row.note_is_pinned),
    daily_date: row.note_daily_date,
    revision: row.note_revision,
    created_at: row.note_created_at,
    updated_at: row.note_updated_at,
  };
}

export class D1SyncRepository implements SyncRepository {
  private readonly notes: D1NoteRepository;

  constructor(
    private readonly db: D1Database,
    options: { createId?: () => string } = {},
  ) {
    this.notes = new D1NoteRepository(db, options.createId);
  }

  async getProcessed(workspaceId: string, operationId: string) {
    const row = await this.db.prepare(
      `SELECT result_json FROM processed_operations
       WHERE workspace_id = ? AND operation_id = ? LIMIT 1`,
    ).bind(workspaceId, operationId).first<ProcessedOperationRow>();
    if (!row) return null;
    try {
      const parsed = SyncOperationResultSchema.safeParse(JSON.parse(row.result_json));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async apply(context: WorkspaceContext, operation: SyncOperation): Promise<SyncOperationResult> {
    if (operation.entity_type !== "note") return rejected(operation, "UNSUPPORTED_ENTITY");
    try {
      if (operation.kind === "create") return await this.create(context, operation);
      if (operation.kind === "update") return await this.update(context, operation);
      return await this.delete(context, operation);
    } catch (error) {
      return rejected(operation, errorCode(error));
    }
  }

  async recordProcessed(workspaceId: string, operation: SyncOperation, result: SyncOperationResult) {
    await this.db.prepare(
      `INSERT OR IGNORE INTO processed_operations (
         workspace_id, operation_id, entity_type, entity_id, result_json, processed_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      workspaceId,
      operation.operation_id,
      operation.entity_type,
      operation.entity_id,
      JSON.stringify(result),
      new Date().toISOString(),
    ).run();
  }

  async latestCursor(workspaceId: string) {
    const row = await this.db.prepare(
      "SELECT MAX(cursor) AS cursor FROM sync_changes WHERE workspace_id = ?",
    ).bind(workspaceId).first<{ cursor: number | null }>();
    return row?.cursor == null ? null : String(row.cursor);
  }

  async pull(context: WorkspaceContext, cursor: string | null): Promise<SyncPullResponse> {
    const after = cursor ? Number(cursor) : 0;
    const result = await this.db.prepare(
      `SELECT sc.cursor, sc.entity_type, sc.entity_id, sc.revision, sc.kind, sc.payload_json,
              n.id AS note_id, n.workspace_id AS note_workspace_id, n.folder_id AS note_folder_id,
              n.database_id AS note_database_id, n.created_by AS note_created_by,
              n.updated_by AS note_updated_by, n.title AS note_title, n.content AS note_content,
              n.status AS note_status, n.is_favorite AS note_is_favorite, n.is_pinned AS note_is_pinned,
              n.daily_date AS note_daily_date, n.revision AS note_revision,
              n.created_at AS note_created_at, n.updated_at AS note_updated_at
       FROM sync_changes sc
       LEFT JOIN notes n ON n.workspace_id = sc.workspace_id AND n.id = sc.entity_id
       WHERE sc.workspace_id = ? AND sc.entity_type = 'note' AND sc.cursor > ?
       ORDER BY sc.cursor ASC
       LIMIT 100`,
    ).bind(context.workspaceId, Number.isFinite(after) ? after : 0).all<SyncChangeRow>();
    const changes = (result.results ?? []).map((row): SyncChange => {
      let fallback: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(row.payload_json) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fallback = parsed as Record<string, unknown>;
      } catch {
        fallback = {};
      }
      const payload = row.kind === "create" ? fallback : notePayload(row) ?? fallback;
      return SyncChangeSchema.parse({
        cursor: String(row.cursor),
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        revision: row.revision,
        kind: row.kind,
        payload,
      });
    });
    return {
      changes,
      next_cursor: changes.at(-1)?.cursor ?? cursor,
    };
  }

  private async create(context: WorkspaceContext, operation: SyncOperation): Promise<SyncOperationResult> {
    const parsed = CreateNoteInputSchema.safeParse(operation.patch);
    if (!parsed.success) return rejected(operation, "VALIDATION_ERROR");
    const existing = await this.notes.getNote(context.workspaceId, operation.entity_id);
    if (existing) return rejected(operation, "ENTITY_EXISTS");
    if (parsed.data.database_id && !await this.notes.hasDatabase(context.workspaceId, parsed.data.database_id)) {
      return rejected(operation, "DATABASE_NOT_FOUND");
    }
    const note = await this.notes.createNote({
      id: operation.entity_id,
      workspaceId: context.workspaceId,
      userId: context.userId,
      title: parsed.data.title,
      content: parsed.data.content,
      folderId: parsed.data.folder_id ?? null,
      databaseId: parsed.data.database_id ?? null,
      dailyDate: parsed.data.daily_date ?? null,
      isFavorite: parsed.data.is_favorite ?? false,
      isPinned: parsed.data.is_pinned ?? false,
      source: "manual",
      now: operation.created_at,
    });
    return { operation_id: operation.operation_id, status: "applied", revision: note.revision };
  }

  private async update(context: WorkspaceContext, operation: SyncOperation): Promise<SyncOperationResult> {
    const parsed = UpdateNoteInputSchema.safeParse({ ...operation.patch, base_revision: operation.base_revision });
    if (!parsed.success) return rejected(operation, "VALIDATION_ERROR");
    if (parsed.data.database_id && !await this.notes.hasDatabase(context.workspaceId, parsed.data.database_id)) {
      return rejected(operation, "DATABASE_NOT_FOUND");
    }
    const result = await this.notes.updateNote({
      workspaceId: context.workspaceId,
      userId: context.userId,
      noteId: operation.entity_id,
      baseRevision: operation.base_revision,
      patch: parsed.data,
      now: operation.created_at,
    });
    if (result.note) return { operation_id: operation.operation_id, status: "applied", revision: result.note.revision };
    if (result.current) return { operation_id: operation.operation_id, status: "conflict", error: "NOTE_CONFLICT" };
    return rejected(operation, "NOTE_NOT_FOUND");
  }

  private async delete(context: WorkspaceContext, operation: SyncOperation): Promise<SyncOperationResult> {
    const result = await this.notes.deletePermanently({
      workspaceId: context.workspaceId,
      userId: context.userId,
      noteId: operation.entity_id,
      baseRevision: operation.base_revision,
      now: operation.created_at,
    });
    if (result.deleted) return { operation_id: operation.operation_id, status: "applied", revision: operation.base_revision };
    if (result.state === "conflict") return { operation_id: operation.operation_id, status: "conflict", error: "NOTE_CONFLICT" };
    return rejected(operation, result.state === "not_found" ? "NOTE_NOT_FOUND" : "NOTE_NOT_TRASHED");
  }
}
