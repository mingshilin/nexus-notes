import type { CreateFolderInput, CreateTagInput, Folder, NoteLink, Tag } from "@nexus/contracts";

export class TaxonomyRepositoryError extends Error {
  readonly retryable = false;

  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "TaxonomyRepositoryError";
  }
}

function isOperationGuardError(error: unknown) {
  return error instanceof Error
    && /UNIQUE constraint failed: collaboration_operation_guard\.id/iu.test(error.message);
}

export class D1TaxonomyRepository {
  constructor(
    private readonly db: D1Database,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async listFolders(workspaceId: string) {
    const result = await this.db.prepare(
      `SELECT id, workspace_id, parent_id, name, position, revision, created_at, updated_at
       FROM folders WHERE workspace_id = ? ORDER BY position, name, id`,
    ).bind(workspaceId).all<Folder>();
    return result.results ?? [];
  }

  async createFolder(workspaceId: string, input: CreateFolderInput, now: string, targetId?: string) {
    const folder: Folder = {
      id: targetId ?? this.createId(),
      workspace_id: workspaceId,
      parent_id: input.parent_id ?? null,
      name: input.name,
      position: input.position ?? 0,
      revision: 1,
      created_at: now,
      updated_at: now,
    };
    const created = await this.db.prepare(
      `INSERT INTO folders (id, workspace_id, parent_id, name, position, revision, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 1, ?, ?
       WHERE ? IS NULL OR EXISTS (
         SELECT 1 FROM folders parent WHERE parent.workspace_id = ? AND parent.id = ?
       )
       ON CONFLICT(id) DO UPDATE SET id = excluded.id
       WHERE folders.workspace_id = excluded.workspace_id
         AND folders.parent_id IS excluded.parent_id
         AND folders.name = excluded.name
         AND folders.position = excluded.position
       RETURNING id, workspace_id, parent_id, name, position, revision, created_at, updated_at`,
    ).bind(
      folder.id,
      workspaceId,
      folder.parent_id,
      folder.name,
      folder.position,
      now,
      now,
      folder.parent_id,
      workspaceId,
      folder.parent_id,
    ).first<Folder>();
    return created ?? null;
  }

  async listTags(workspaceId: string) {
    const result = await this.db.prepare(
      `SELECT id, workspace_id, name, color, revision, created_at, updated_at
       FROM tags WHERE workspace_id = ? ORDER BY name, id`,
    ).bind(workspaceId).all<Tag>();
    return result.results ?? [];
  }

  async listNoteTags(workspaceId: string, noteId: string) {
    const result = await this.db.prepare(
      `SELECT tag.id, tag.workspace_id, tag.name, tag.color, tag.revision, tag.created_at, tag.updated_at
       FROM note_tags assigned
       JOIN tags tag ON tag.workspace_id = assigned.workspace_id AND tag.id = assigned.tag_id
       JOIN notes note ON note.workspace_id = assigned.workspace_id AND note.id = assigned.note_id
       WHERE assigned.workspace_id = ? AND assigned.note_id = ? AND note.deleted_at IS NULL
       ORDER BY tag.name, tag.id`,
    ).bind(workspaceId, noteId).all<Tag>();
    return result.results ?? [];
  }

  async createTag(workspaceId: string, input: CreateTagInput, now: string) {
    const tag: Tag = {
      id: this.createId(),
      workspace_id: workspaceId,
      name: input.name,
      color: input.color,
      revision: 1,
      created_at: now,
      updated_at: now,
    };
    await this.db.prepare(
      `INSERT INTO tags (id, workspace_id, name, color, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).bind(tag.id, workspaceId, tag.name, tag.color, now, now).run();
    return tag;
  }

  async setNoteTags(workspaceId: string, noteId: string, tagIds: string[], now: string) {
    const remove = this.db.prepare(
      `DELETE FROM note_tags
       WHERE workspace_id = ? AND note_id IN (
         SELECT id FROM notes WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL
       )`,
    ).bind(workspaceId, workspaceId, noteId);
    const statements: D1PreparedStatement[] = [remove];
    if (tagIds.length > 0) {
      statements.push(this.db.prepare(
        `INSERT INTO note_tags (workspace_id, note_id, tag_id, created_at)
         SELECT ?, ?, tag.id, ?
         FROM tags tag
         WHERE tag.workspace_id = ? AND tag.id IN (${tagIds.map(() => "?").join(", ")})
           AND EXISTS (
             SELECT 1 FROM notes WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL
           )`,
      ).bind(workspaceId, noteId, now, workspaceId, ...tagIds, workspaceId, noteId));
    }
    statements.push(this.db.prepare(
      `UPDATE search_documents
       SET tags = COALESCE((
         SELECT group_concat(tag.name, ' ')
         FROM note_tags nt JOIN tags tag ON tag.workspace_id = nt.workspace_id AND tag.id = nt.tag_id
         WHERE nt.workspace_id = ? AND nt.note_id = ?
       ), ''), updated_at = ?
       WHERE workspace_id = ? AND entity_type = 'note' AND entity_id = ?
         AND EXISTS (SELECT 1 FROM notes WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL)`,
    ).bind(workspaceId, noteId, now, workspaceId, noteId, workspaceId, noteId));
    await this.db.batch(statements);
  }

  async setNoteTagsBatch(workspaceId: string, noteIds: string[], tagIds: string[], now: string) {
    const uniqueNoteIds = [...new Set(noteIds)];
    const uniqueTagIds = [...new Set(tagIds)];
    if (uniqueNoteIds.length === 0 || uniqueNoteIds.length > 100 || uniqueTagIds.length > 100) {
      throw new TaxonomyRepositoryError("TAXONOMY_BATCH_INVALID", "Tag assignment batch is invalid", 400);
    }
    await this.assertTagTargets(workspaceId, uniqueNoteIds, uniqueTagIds);
    const notesJson = JSON.stringify(uniqueNoteIds);
    const tagsJson = JSON.stringify(uniqueTagIds);
    const statements: D1PreparedStatement[] = [
      this.db.prepare(
        `INSERT INTO collaboration_operation_guard (id)
         SELECT 1 WHERE (
           SELECT COUNT(*) FROM notes
           WHERE workspace_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))
         ) <> json_array_length(?)`,
      ).bind(workspaceId, notesJson, notesJson),
      this.db.prepare(
        `INSERT INTO collaboration_operation_guard (id)
         SELECT 1 WHERE (
           SELECT COUNT(*) FROM tags
           WHERE workspace_id = ? AND id IN (SELECT value FROM json_each(?))
         ) <> json_array_length(?)`,
      ).bind(workspaceId, tagsJson, tagsJson),
      this.db.prepare(
        `DELETE FROM note_tags
         WHERE workspace_id = ? AND note_id IN (SELECT value FROM json_each(?))`,
      ).bind(workspaceId, notesJson),
    ];
    if (uniqueTagIds.length > 0) {
      statements.push(this.db.prepare(
        `INSERT INTO note_tags (workspace_id, note_id, tag_id, created_at)
         SELECT ?, note.value, tag.value, ?
         FROM json_each(?) note CROSS JOIN json_each(?) tag`,
      ).bind(workspaceId, now, notesJson, tagsJson));
    }
    statements.push(this.db.prepare(
      `UPDATE search_documents
       SET tags = COALESCE((
         SELECT group_concat(tag.name, ' ')
         FROM note_tags nt JOIN tags tag ON tag.workspace_id = nt.workspace_id AND tag.id = nt.tag_id
         WHERE nt.workspace_id = search_documents.workspace_id AND nt.note_id = search_documents.entity_id
       ), ''), updated_at = ?
       WHERE workspace_id = ? AND entity_type = 'note' AND entity_id IN (SELECT value FROM json_each(?))`,
    ).bind(now, workspaceId, notesJson));
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (isOperationGuardError(error)) {
        await this.assertTagTargets(workspaceId, uniqueNoteIds, uniqueTagIds);
        throw new TaxonomyRepositoryError("TAXONOMY_TARGET_CONFLICT", "Tag assignment targets changed", 409);
      }
      throw error;
    }
    return { entity_ids: uniqueNoteIds };
  }

  private async assertTagTargets(workspaceId: string, noteIds: string[], tagIds: string[]) {
    const notesJson = JSON.stringify(noteIds);
    const noteCount = await this.db.prepare(
      `SELECT COUNT(*) AS count FROM notes
       WHERE workspace_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))`,
    ).bind(workspaceId, notesJson).first<{ count: number }>();
    if (noteCount?.count !== noteIds.length) {
      throw new TaxonomyRepositoryError("NOTE_NOT_FOUND", "One or more notes were not found", 404);
    }
    if (tagIds.length === 0) return;
    const tagsJson = JSON.stringify(tagIds);
    const tagCount = await this.db.prepare(
      "SELECT COUNT(*) AS count FROM tags WHERE workspace_id = ? AND id IN (SELECT value FROM json_each(?))",
    ).bind(workspaceId, tagsJson).first<{ count: number }>();
    if (tagCount?.count !== tagIds.length) {
      throw new TaxonomyRepositoryError("TAG_NOT_FOUND", "One or more tags were not found", 404);
    }
  }

  async setNoteLinks(workspaceId: string, noteId: string, targetNoteIds: string[], now: string) {
    const remove = this.db.prepare(
      `DELETE FROM note_links
       WHERE workspace_id = ? AND source_note_id IN (
         SELECT id FROM notes WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL
       )`,
    ).bind(workspaceId, workspaceId, noteId);
    const statements: D1PreparedStatement[] = [remove];
    if (targetNoteIds.length > 0) {
      statements.push(this.db.prepare(
        `INSERT INTO note_links (id, workspace_id, source_note_id, target_note_id, created_at)
         SELECT 'link:' || ? || ':' || target.id, ?, ?, target.id, ?
         FROM notes target
         WHERE target.workspace_id = ? AND target.id IN (${targetNoteIds.map(() => "?").join(", ")})
           AND target.id <> ? AND target.deleted_at IS NULL
           AND EXISTS (
             SELECT 1 FROM notes source
             WHERE source.workspace_id = ? AND source.id = ? AND source.deleted_at IS NULL
           )`,
      ).bind(
        noteId,
        workspaceId,
        noteId,
        now,
        workspaceId,
        ...targetNoteIds,
        noteId,
        workspaceId,
        noteId,
      ));
    }
    await this.db.batch(statements);
  }

  async listNoteLinks(workspaceId: string, noteId: string) {
    const result = await this.db.prepare(
      `SELECT id, workspace_id, source_note_id, target_note_id, created_at
       FROM note_links
       WHERE workspace_id = ? AND source_note_id = ?
       ORDER BY created_at, id`,
    ).bind(workspaceId, noteId).all<NoteLink>();
    return result.results ?? [];
  }

  async listBacklinks(workspaceId: string, noteId: string) {
    const result = await this.db.prepare(
      `SELECT id, workspace_id, source_note_id, target_note_id, created_at
       FROM note_links
       WHERE workspace_id = ? AND target_note_id = ?
       ORDER BY created_at, id`,
    ).bind(workspaceId, noteId).all<NoteLink>();
    return result.results ?? [];
  }
}
