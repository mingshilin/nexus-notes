import type {
  CreateDatabaseCommentInput,
  DatabaseComment,
  UpdateDatabaseCommentInput,
  WorkspaceContext,
} from "@nexus/contracts";

import { assertRevision, DatabaseRepositoryBase } from "./database-repository-base";
import {
  COMMENT_COLUMNS,
  DatabaseRepositoryError,
  type CommentRow,
  toComment,
} from "./database-model";

export class D1DatabaseCommentRepository extends DatabaseRepositoryBase {
  async createComment(context: WorkspaceContext, databaseId: string, input: CreateDatabaseCommentInput) {
    await this.access.assert(context, databaseId, "write");
    await this.ensureRecord(context.workspaceId, databaseId, input.record_id);
    if (input.parent_id) {
      const parent = await this.db.prepare(
        `SELECT id FROM comments WHERE workspace_id = ? AND entity_type = 'database_record'
         AND entity_id = ? AND id = ? AND deleted_at IS NULL`,
      ).bind(context.workspaceId, input.record_id, input.parent_id).first();
      if (!parent) throw new DatabaseRepositoryError("COMMENT_PARENT_NOT_FOUND", "Parent comment not found", 404);
    }
    const now = this.now();
    const comment: DatabaseComment = {
      id: this.id(), workspace_id: context.workspaceId, database_id: databaseId, record_id: input.record_id,
      author_user_id: context.userId, parent_id: input.parent_id ?? null, body: input.body.trim(),
      revision: 1, created_at: now, updated_at: now,
    };
    await this.db.prepare(
      `INSERT INTO comments
       (id, workspace_id, entity_type, entity_id, author_user_id, parent_id, body, revision, created_at, updated_at)
       VALUES (?, ?, 'database_record', ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(comment.id, context.workspaceId, comment.record_id, comment.author_user_id, comment.parent_id, comment.body, now, now).run();
    return comment;
  }

  async listComments(context: WorkspaceContext, databaseId: string, recordId: string) {
    await this.access.assert(context, databaseId, "read");
    if ((await this.recordRows(context.workspaceId, databaseId, [recordId])).length === 0) return [];
    const result = await this.db.prepare(
      `SELECT ${COMMENT_COLUMNS} FROM comments
       WHERE workspace_id = ? AND entity_type = 'database_record' AND entity_id = ? AND deleted_at IS NULL
       ORDER BY created_at, id`,
    ).bind(context.workspaceId, recordId).all<CommentRow>();
    return (result.results ?? []).map((row) => toComment(row, databaseId));
  }

  async updateComment(context: WorkspaceContext, databaseId: string, commentId: string, input: UpdateDatabaseCommentInput) {
    const access = await this.access.assert(context, databaseId, "write");
    const comment = await this.comment(context.workspaceId, databaseId, commentId);
    if (access.role !== "owner" && comment.author_user_id !== context.userId) {
      throw new DatabaseRepositoryError("COMMENT_WRITE_DENIED", "Comment permission denied", 403);
    }
    assertRevision(comment.revision, input.base_revision);
    const now = this.now();
    const updated = { ...comment, body: input.body.trim(), revision: comment.revision + 1, updated_at: now };
    const result = await this.db.prepare(
      `UPDATE comments SET body = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND revision = ?`,
    ).bind(updated.body, now, context.workspaceId, commentId, input.base_revision).run();
    if (result.meta.changes === 0) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
    return updated;
  }

  async deleteComment(context: WorkspaceContext, databaseId: string, commentId: string, input: { base_revision: number }) {
    const access = await this.access.assert(context, databaseId, "write");
    const comment = await this.comment(context.workspaceId, databaseId, commentId);
    if (access.role !== "owner" && comment.author_user_id !== context.userId) {
      throw new DatabaseRepositoryError("COMMENT_WRITE_DENIED", "Comment permission denied", 403);
    }
    assertRevision(comment.revision, input.base_revision);
    const now = this.now();
    const result = await this.db.prepare(
      `UPDATE comments SET deleted_at = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND revision = ?`,
    ).bind(now, now, context.workspaceId, commentId, input.base_revision).run();
    if (result.meta.changes === 0) throw new DatabaseRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409);
    return { id: commentId };
  }

  private async comment(workspaceId: string, databaseId: string, commentId: string) {
    const row = await this.db.prepare(
      `SELECT c.${COMMENT_COLUMNS.split(", ").join(", c.")}
       FROM comments c
       JOIN database_records r ON r.workspace_id = c.workspace_id AND r.id = c.entity_id
       WHERE c.workspace_id = ? AND r.database_id = ? AND c.id = ?
         AND c.entity_type = 'database_record' AND c.deleted_at IS NULL`,
    ).bind(workspaceId, databaseId, commentId).first<CommentRow>();
    if (!row) throw new DatabaseRepositoryError("COMMENT_NOT_FOUND", "Database comment not found", 404);
    return toComment(row, databaseId);
  }
}
