import type { Note, NoteRevision, UpdateNoteInput } from "@nexus/contracts";

import type {
  CreateNoteRecordInput,
  NoteRepository,
} from "./note-service";

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

function firstResultRow(result: D1Result<NoteRow> | undefined) {
  return result?.results?.[0] ?? null;
}

function encodeCursor(note: Pick<Note, "updated_at" | "id">) {
  return encodeURIComponent(`${note.updated_at}\n${note.id}`);
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
  ) {}

  async createNote(input: CreateNoteRecordInput) {
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

    await this.db.batch([insertNote, insertRevision, insertSyncChange, insertSearchDocument]);
    return note;
  }

  getNote(workspaceId: string, noteId: string) {
    return this.db.prepare(
      `SELECT ${NOTE_COLUMNS}
       FROM notes
       WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL
       LIMIT 1`,
    ).bind(workspaceId, noteId).first<NoteRow>().then((row) => row ? toNote(row) : null);
  }

  async listNotes(input: { workspaceId: string; cursor?: string; limit: number }) {
    const limit = Math.max(1, Math.min(input.limit, 100));
    const conditions = ["workspace_id = ?", "deleted_at IS NULL"];
    const bindings: unknown[] = [input.workspaceId];
    if (input.cursor) {
      const cursor = decodeCursor(input.cursor);
      conditions.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
      bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    const result = await this.db.prepare(
      `SELECT ${NOTE_COLUMNS}
       FROM notes
       WHERE ${conditions.join(" AND ")}
       ORDER BY updated_at DESC, id DESC
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
    ]);
    const row = firstResultRow(results[0]);

    if (!row) {
      return { note: null, current: await this.getNote(input.workspaceId, input.noteId) };
    }
    return { note: toNote(row), current: null };
  }

  async restoreRevision(input: {
    workspaceId: string;
    userId: string;
    noteId: string;
    revision: number;
    baseRevision: number;
    now: string;
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
    ]);
    const row = firstResultRow(results[0]);

    if (row) return { note: toNote(row), current: null, revisionFound: true };

    const [current, revision] = await Promise.all([
      this.getNote(input.workspaceId, input.noteId),
      this.db.prepare(
        `SELECT 1 AS found FROM note_revisions
         WHERE workspace_id = ? AND note_id = ? AND revision = ? LIMIT 1`,
      ).bind(input.workspaceId, input.noteId, input.revision).first<{ found: number }>(),
    ]);
    return { note: null, current, revisionFound: Boolean(revision) };
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
}
