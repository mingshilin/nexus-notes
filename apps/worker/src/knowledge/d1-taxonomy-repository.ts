import type { CreateFolderInput, CreateTagInput, Folder, NoteLink, Tag } from "@nexus/contracts";

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

  async createFolder(workspaceId: string, input: CreateFolderInput, now: string) {
    const folder: Folder = {
      id: this.createId(),
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
