import type { Note, NoteRevision, UpdateNoteInput } from "@nexus/contracts";

import type {
  CreateNoteRecordInput,
  NoteRepository,
} from "./note-service";
import { prepareActivityAndAuditStatements } from "../collaboration/d1-collaboration-repository";
import type { PresenceNotifier } from "../presence/presence-dispatcher";

interface NoteRow {
  id: string;
  workspace_id: string;
  folder_id: string | null;
  database_id: string | null;
  created_by: string;
  updated_by: string;
  title: string;
  content: string;
  status: Note["status"];
  is_favorite: number;
  is_pinned: number;
  daily_date: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

const NOTE_COLUMNS = `id, workspace_id, folder_id, database_id, created_by, updated_by,
  title, content, status, is_favorite, is_pinned, daily_date, revision, created_at, updated_at`;

function toNote(row: NoteRow): Note {
  return {
    ...row,
    is_favorite: Boolean(row.is_favorite),
    is_pinned: Boolean(row.is_pinned),
  };
}

function isSameCreate(input: CreateNoteRecordInput, existing: Note) {
  return existing.workspace_id === input.workspaceId
    && existing.created_by === input.userId
    && existing.title === input.title
    && existing.content === input.content
    && existing.folder_id === input.folderId
    && existing.database_id === input.databaseId
    && existing.daily_date === input.dailyDate
    && existing.is_favorite === input.isFavorite
    && existing.is_pinned === input.isPinned;
}

function firstResultRow(result: D1Result<NoteRow> | undefined) {
  return result?.results?.[0] ?? null;
}

function encodeCursor(note: Pick<Note, "updated_at" | "id">) {
  return encodeURIComponent(`${note.updated_at}\n${note.id}`);
}

function searchTokens(query: string) {
  return query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
}

function ftsToken(token: string) {
  return `"${token.replaceAll('"', '""')}"*`;
}

function decodeCursor(cursor: string) {
  const decoded = decodeURIComponent(cursor);
  const separator = decoded.indexOf("\n");
  if (separator <= 0 || separator === decoded.length - 1) {
    throw new Error("INVALID_NOTE_CURSOR");
  }
  return {
    updatedAt: decoded.slice(0, separator),
    id: decoded.slice(separator + 1),
  };
}

export class D1NoteRepository implements NoteRepository {
  constructor(
    private readonly db: D1Database,
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly options: { presence?: Pick<PresenceNotifier, "invalidate"> } = {},
  ) {}

  async createNote(input: CreateNoteRecordInput) {
    if (input.idempotencyKey) {
      const existing = await this.getNote(input.workspaceId, input.id);
      if (existing) {
        if (isSameCreate(input, existing)) return existing;
        throw new Error("NOTE_IDEMPOTENCY_CONFLICT");
      }
    }
    const note: Note = {
      id: input.id,
      workspace_id: input.workspaceId,
      folder_id: input.folderId,
      database_id: input.databaseId,
      created_by: input.userId,
      updated_by: input.userId,
      title: input.title,
      content: input.content,
      status: "active",
      is_favorite: input.isFavorite,
      is_pinned: input.isPinned,
      daily_date: input.dailyDate,
      revision: 1,
      created_at: input.now,
      updated_at: input.now,
    };
    const insertNote = this.db.prepare(
      `INSERT INTO notes (
         id, workspace_id, folder_id, database_id, created_by, updated_by, title, content,
         status, is_favorite, is_pinned, daily_date, revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 1, ?, ?)`,
    ).bind(
      note.id,
      note.workspace_id,
      note.folder_id,
      note.database_id,
      note.created_by,
      note.updated_by,
      note.title,
      note.content,
      Number(note.is_favorite),
      Number(note.is_pinned),
      note.daily_date,
      note.created_at,
      note.updated_at,
    );
    const insertRevision = this.db.prepare(
      `INSERT INTO note_revisions (
         id, workspace_id, note_id, revision, title, content, source, created_by, created_at
       ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    ).bind(
      this.createId(),
      note.workspace_id,
      note.id,
      note.title,
      note.content,
      input.source,
      input.userId,
      input.now,
    );
    const insertSyncChange = this.db.prepare(
      `INSERT INTO sync_changes (
         workspace_id, entity_type, entity_id, revision, kind, payload_json, created_at
       ) VALUES (?, 'note', ?, 1, 'create', ?, ?)`,
    ).bind(note.workspace_id, note.id, JSON.stringify(note), input.now);
    const insertSearchDocument = this.db.prepare(
      `INSERT INTO search_documents (
         id, workspace_id, entity_type, entity_id, title, content, tags, properties,
         attachment_names, ocr_text, revision, updated_at
       ) VALUES (?, ?, 'note', ?, ?, ?, '', '', '', '', 1, ?)`,
    ).bind(`search:note:${note.id}`, note.workspace_id, note.id, note.title, note.content, note.updated_at);

    try {
      await this.db.batch([
        insertNote,
        insertRevision,
        insertSyncChange,
        insertSearchDocument,
        ...this.auditStatements(input, "note.created", note.id, 1, input.now),
      ]);
    } catch (error) {
      if (input.idempotencyKey) {
        const replay = await this.getNote(input.workspaceId, input.id);
        if (replay && isSameCreate(input, replay)) return replay;
      }
      throw error;
    }
    await this.notifyPresence(input.workspaceId, note.id, note.revision);
    return note;
  }

  async openOrCreateDaily(input: CreateNoteRecordInput) {
    const existing = await this.activeDailyNote(input.workspaceId, input.dailyDate);
    if (existing) return existing;

    try {
      return await this.createNote(input);
    } catch (error) {
      // The migration trigger serializes concurrent creators. Re-read its winner.
      const winner = await this.activeDailyNote(input.workspaceId, input.dailyDate);
      if (winner) return winner;
      throw error;
    }
  }

  async hasDatabase(workspaceId: string, databaseId: string) {
    const row = await this.db.prepare(
      "SELECT 1 AS present FROM databases WHERE workspace_id = ? AND id = ? LIMIT 1",
    ).bind(workspaceId, databaseId).first<{ present: number }>();
    return Boolean(row);
  }

  getNote(workspaceId: string, noteId: string) {
    return this.db.prepare(
      `SELECT ${NOTE_COLUMNS}
       FROM notes
       WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL
       LIMIT 1`,
    ).bind(workspaceId, noteId).first<NoteRow>().then((row) => row ? toNote(row) : null);
  }

  private activeDailyNote(workspaceId: string, dailyDate: string | null) {
    if (!dailyDate) return Promise.resolve(null);
    return this.db.prepare(
      `SELECT ${NOTE_COLUMNS}
       FROM notes
       WHERE workspace_id = ? AND daily_date = ? AND status = 'active' AND deleted_at IS NULL
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`,
    ).bind(workspaceId, dailyDate).first<NoteRow>().then((row) => row ? toNote(row) : null);
  }

  async listNotes(input: { workspaceId: string; cursor?: string; limit: number; query?: string; status?: Note["status"]; folderId?: string | null; dailyDate?: string; favorite?: boolean; pinned?: boolean }) {
    const limit = Math.max(1, Math.min(input.limit, 100));
    const queryTokens = searchTokens(input.query ?? "");
    const hasQuery = queryTokens.length > 0;
    const noteColumn = hasQuery ? "notes." : "";
    const conditions = [`${noteColumn}workspace_id = ?`, `${noteColumn}deleted_at IS NULL`];
    const bindings: unknown[] = [input.workspaceId];
    if (hasQuery) {
      const hasNonAsciiToken = queryTokens.some((token) => /[^\x00-\x7F]/u.test(token));
      if (hasNonAsciiToken) {
        conditions.push(queryTokens.map(() => `lower(
          COALESCE(sd.title, '') || ' ' || COALESCE(sd.content, '') || ' ' ||
          COALESCE(sd.tags, '') || ' ' || COALESCE(sd.properties, '') || ' ' ||
          COALESCE(sd.attachment_names, '') || ' ' || COALESCE(sd.ocr_text, '')
        ) LIKE ?`).join(" AND "));
        for (const token of queryTokens) bindings.push(`%${token}%`);
      } else {
        conditions.push("search_documents_fts MATCH ?");
        bindings.push(queryTokens.map(ftsToken).join(" AND "));
      }
    }
    if (input.status) {
      conditions.push(`${noteColumn}status = ?`);
      bindings.push(input.status);
    }
    if (input.folderId !== undefined) {
      if (input.folderId === null) conditions.push(`${noteColumn}folder_id IS NULL`);
      else {
        conditions.push(`${noteColumn}folder_id = ?`);
        bindings.push(input.folderId);
      }
    }
    if (input.dailyDate) {
      conditions.push(`${noteColumn}daily_date = ?`);
      bindings.push(input.dailyDate);
    }
    if (input.favorite !== undefined) {
      conditions.push(`${noteColumn}is_favorite = ?`);
      bindings.push(Number(input.favorite));
    }
    if (input.pinned !== undefined) {
      conditions.push(`${noteColumn}is_pinned = ?`);
      bindings.push(Number(input.pinned));
    }
    if (input.cursor) {
      const cursor = decodeCursor(input.cursor);
      conditions.push(`(${noteColumn}updated_at < ? OR (${noteColumn}updated_at = ? AND ${noteColumn}id < ?))`);
      bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    const selectedColumns = hasQuery ? "notes.*" : NOTE_COLUMNS;
    const fromClause = hasQuery
      ? `FROM notes
       JOIN search_documents sd
         ON sd.workspace_id = notes.workspace_id
        AND sd.entity_type = 'note'
        AND sd.entity_id = notes.id
       JOIN search_documents_fts ON search_documents_fts.rowid = sd.rowid`
      : "FROM notes";
    const result = await this.db.prepare(
      `SELECT ${selectedColumns}
       ${fromClause}
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${noteColumn}updated_at DESC, ${noteColumn}id DESC
       LIMIT ?`,
    ).bind(...bindings, limit + 1).all<NoteRow>();
    const rows = result.results ?? [];
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map(toNote);
    return {
      items,
      nextCursor: rows.length > limit && items.length > 0
        ? encodeCursor(items[items.length - 1]!)
        : null,
    };
  }

  async listRevisions(workspaceId: string, noteId: string) {
    const result = await this.db.prepare(
      `SELECT id, workspace_id, note_id, revision, title, content, source, created_by, created_at
       FROM note_revisions
       WHERE workspace_id = ? AND note_id = ?
       ORDER BY revision DESC`,
    ).bind(workspaceId, noteId).all<NoteRevision>();
    return result.results ?? [];
  }

  async updateNote(input: {
    workspaceId: string;
    userId: string;
    noteId: string;
    baseRevision: number;
    patch: Omit<UpdateNoteInput, "base_revision">;
    now: string;
    requestId?: string;
  }) {
    const { source = "autosave", ...changes } = input.patch;
    const assignments: string[] = [];
    const bindings: unknown[] = [];
    const add = (column: string, value: unknown) => {
      assignments.push(`${column} = ?`);
      bindings.push(value);
    };

    if (changes.title !== undefined) add("title", changes.title);
    if (changes.content !== undefined) add("content", changes.content);
    if (changes.folder_id !== undefined) add("folder_id", changes.folder_id);
    if (changes.database_id !== undefined) add("database_id", changes.database_id);
    if (changes.daily_date !== undefined) add("daily_date", changes.daily_date);
    if (changes.is_favorite !== undefined) add("is_favorite", Number(changes.is_favorite));
    if (changes.is_pinned !== undefined) add("is_pinned", Number(changes.is_pinned));
    if (changes.status !== undefined) add("status", changes.status);

    const nextRevision = input.baseRevision + 1;
    const update = this.db.prepare(
      `UPDATE notes
       SET ${assignments.join(", ")}, updated_by = ?, updated_at = ?, revision = revision + 1
       WHERE workspace_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL
       RETURNING ${NOTE_COLUMNS}`,
    ).bind(
      ...bindings,
      input.userId,
      input.now,
      input.workspaceId,
      input.noteId,
      input.baseRevision,
    );
    const insertRevision = this.revisionFromCurrentNote(input, source, nextRevision);
    const insertSyncChange = this.syncFromCurrentNote(
      input.workspaceId,
      input.noteId,
      nextRevision,
      input.userId,
      "update",
      JSON.stringify(changes),
      input.now,
    );
    const upsertSearchDocument = this.searchFromCurrentNote(input, nextRevision);
    const results = await this.db.batch<NoteRow>([
      update,
      insertRevision,
      insertSyncChange,
      upsertSearchDocument,
      ...this.auditStatements(
        input,
        "note.updated",
        input.noteId,
        nextRevision,
        input.now,
        `EXISTS (SELECT 1 FROM notes
          WHERE workspace_id = ? AND id = ? AND revision = ?
            AND updated_by = ? AND updated_at = ? AND deleted_at IS NULL)`,
        [input.workspaceId, input.noteId, nextRevision, input.userId, input.now],
      ),
    ]);
    const row = firstResultRow(results[0]);

    if (!row) {
      return { note: null, current: await this.getNote(input.workspaceId, input.noteId) };
    }
    const note = toNote(row);
    await this.notifyPresence(input.workspaceId, input.noteId, note.revision);
    return { note, current: null };
  }

  async restoreRevision(input: {
    workspaceId: string;
    userId: string;
    noteId: string;
    revision: number;
    baseRevision: number;
    now: string;
    requestId?: string;
  }) {
    const nextRevision = input.baseRevision + 1;
    const update = this.db.prepare(
      `UPDATE notes
       SET title = (
             SELECT title FROM note_revisions
             WHERE workspace_id = ? AND note_id = ? AND revision = ?
           ),
           content = (
             SELECT content FROM note_revisions
             WHERE workspace_id = ? AND note_id = ? AND revision = ?
           ),
           updated_by = ?, updated_at = ?, revision = revision + 1
       WHERE notes.workspace_id = ? AND notes.id = ? AND notes.revision = ? AND deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM note_revisions
           WHERE workspace_id = ? AND note_id = ? AND revision = ?
         )
       RETURNING ${NOTE_COLUMNS}`,
    ).bind(
      input.workspaceId,
      input.noteId,
      input.revision,
      input.workspaceId,
      input.noteId,
      input.revision,
      input.userId,
      input.now,
      input.workspaceId,
      input.noteId,
      input.baseRevision,
      input.workspaceId,
      input.noteId,
      input.revision,
    );
    const insertRevision = this.revisionFromCurrentNote(input, "restore", nextRevision);
    const insertSyncChange = this.syncFromCurrentNote(
      input.workspaceId,
      input.noteId,
      nextRevision,
      input.userId,
      "update",
      JSON.stringify({ restored_revision: input.revision }),
      input.now,
    );
    const upsertSearchDocument = this.searchFromCurrentNote(input, nextRevision);
    const results = await this.db.batch<NoteRow>([
      update,
      insertRevision,
      insertSyncChange,
      upsertSearchDocument,
      ...this.auditStatements(
        input,
        "note.restored",
        input.noteId,
        nextRevision,
        input.now,
        `EXISTS (SELECT 1 FROM notes
          WHERE workspace_id = ? AND id = ? AND revision = ?
            AND updated_by = ? AND updated_at = ? AND deleted_at IS NULL)`,
        [input.workspaceId, input.noteId, nextRevision, input.userId, input.now],
      ),
    ]);
    const row = firstResultRow(results[0]);

    if (row) {
      const note = toNote(row);
      await this.notifyPresence(input.workspaceId, input.noteId, note.revision);
      return { note, current: null, revisionFound: true };
    }

    const [current, revision] = await Promise.all([
      this.getNote(input.workspaceId, input.noteId),
      this.db.prepare(
        `SELECT 1 AS found FROM note_revisions
         WHERE workspace_id = ? AND note_id = ? AND revision = ? LIMIT 1`,
      ).bind(input.workspaceId, input.noteId, input.revision).first<{ found: number }>(),
    ]);
    return { note: null, current, revisionFound: Boolean(revision) };
  }

  async deletePermanently(input: {
    workspaceId: string;
    userId: string;
    noteId: string;
    baseRevision: number;
    now: string;
    requestId?: string;
  }) {
    const condition = `workspace_id = ? AND id = ? AND status = 'trashed' AND revision = ? AND deleted_at IS NULL`;
    const bindings = [input.workspaceId, input.noteId, input.baseRevision];
    const exists = `EXISTS (SELECT 1 FROM notes WHERE ${condition})`;
    const cleanup = (table: "comments" | "public_shares" | "search_documents") => this.db.prepare(
      `DELETE FROM ${table}
       WHERE workspace_id = ? AND entity_type = 'note' AND entity_id = ?
         AND ${exists}`,
    ).bind(input.workspaceId, input.noteId, ...bindings);
    const insertTombstone = this.db.prepare(
      `INSERT INTO sync_changes (
         workspace_id, entity_type, entity_id, revision, kind, payload_json, created_at
       )
       SELECT workspace_id, 'note', id, revision, 'delete', '{}', ?
       FROM notes WHERE ${condition}`,
    ).bind(input.now, ...bindings);
    const deleteNote = this.db.prepare(
      `DELETE FROM notes WHERE ${condition} RETURNING revision`,
    ).bind(...bindings);
    const results = await this.db.batch<{ revision: number }>([
      cleanup("comments"),
      cleanup("public_shares"),
      cleanup("search_documents"),
      insertTombstone,
      ...this.auditStatements(
        input,
        "note.permanently_deleted",
        input.noteId,
        input.baseRevision,
        input.now,
        exists,
        bindings,
      ),
      deleteNote,
    ]);
    const deleted = results.at(-1)?.results?.[0] ?? null;
    if (deleted) {
      await this.notifyPresence(input.workspaceId, input.noteId, deleted.revision);
      return { deleted: true as const, state: "deleted" as const };
    }

    const current = await this.db.prepare(
      "SELECT status, revision FROM notes WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1",
    ).bind(input.workspaceId, input.noteId).first<{ status: Note["status"]; revision: number }>();
    if (!current) return { deleted: false as const, state: "not_found" as const };
    if (current.status !== "trashed") return { deleted: false as const, state: "not_trashed" as const };
    return { deleted: false as const, state: "conflict" as const };
  }

  private revisionFromCurrentNote(
    input: { workspaceId: string; noteId: string; userId: string; now: string },
    source: NoteRevision["source"],
    revision: number,
  ) {
    return this.db.prepare(
      `INSERT INTO note_revisions (
         id, workspace_id, note_id, revision, title, content, source, created_by, created_at
       )
       SELECT ?, workspace_id, id, revision, title, content, ?, ?, ?
       FROM notes
       WHERE workspace_id = ? AND id = ? AND revision = ?
         AND updated_by = ? AND updated_at = ? AND deleted_at IS NULL`,
    ).bind(
      this.createId(),
      source,
      input.userId,
      input.now,
      input.workspaceId,
      input.noteId,
      revision,
      input.userId,
      input.now,
    );
  }

  private syncFromCurrentNote(
    workspaceId: string,
    noteId: string,
    revision: number,
    userId: string,
    kind: "update",
    payload: string,
    now: string,
  ) {
    return this.db.prepare(
      `INSERT INTO sync_changes (
         workspace_id, entity_type, entity_id, revision, kind, payload_json, created_at
       )
       SELECT workspace_id, 'note', id, revision, ?, ?, ?
       FROM notes
       WHERE workspace_id = ? AND id = ? AND revision = ?
         AND updated_by = ? AND updated_at = ? AND deleted_at IS NULL`,
    ).bind(kind, payload, now, workspaceId, noteId, revision, userId, now);
  }

  private searchFromCurrentNote(
    input: { workspaceId: string; noteId: string; userId: string; now: string },
    revision: number,
  ) {
    return this.db.prepare(
      `INSERT INTO search_documents (
         id, workspace_id, entity_type, entity_id, title, content, tags, properties,
         attachment_names, ocr_text, revision, updated_at
       )
       SELECT 'search:note:' || id, workspace_id, 'note', id, title, content, '', '', '', '', revision, updated_at
       FROM notes
       WHERE workspace_id = ? AND id = ? AND revision = ?
         AND updated_by = ? AND updated_at = ? AND deleted_at IS NULL
       ON CONFLICT(workspace_id, entity_type, entity_id) DO UPDATE SET
         title = excluded.title,
         content = excluded.content,
         revision = excluded.revision,
         updated_at = excluded.updated_at`,
    ).bind(input.workspaceId, input.noteId, revision, input.userId, input.now);
  }

  private auditStatements(
    input: { workspaceId: string; userId: string; requestId?: string },
    action: string,
    noteId: string,
    revision: number,
    createdAt: string,
    condition?: string,
    conditionBindings?: unknown[],
  ) {
    if (!input.requestId) return [];
    return prepareActivityAndAuditStatements(this.db, this.createId, {
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      requestId: input.requestId,
      action,
      targetType: "note",
      targetId: noteId,
      metadata: { revision },
      createdAt,
      condition,
      conditionBindings,
    });
  }

  private async notifyPresence(workspaceId: string, noteId: string, revision: number) {
    try {
      await this.options.presence?.invalidate({ workspaceId, entityType: "note", entityId: noteId, revision });
    } catch {
      // Presence is advisory after the D1 commit.
    }
  }
}
