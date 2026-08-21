import type { GraphResponse } from "@nexus/contracts";

interface GraphRow {
  source: string;
  target: string;
  source_title: string;
  target_title: string;
}

export class D1GraphRepository {
  constructor(private readonly db: D1Database) {}

  async getGraph(workspaceId: string, currentNoteId?: string): Promise<GraphResponse> {
    const localCondition = currentNoteId
      ? "AND (link.source_note_id = ? OR link.target_note_id = ?)"
      : "";
    const statement = this.db.prepare(
      `SELECT link.source_note_id AS source, link.target_note_id AS target,
              source.title AS source_title, target.title AS target_title
       FROM note_links link
       JOIN notes source ON source.workspace_id = link.workspace_id AND source.id = link.source_note_id
       JOIN notes target ON target.workspace_id = link.workspace_id AND target.id = link.target_note_id
       WHERE link.workspace_id = ? ${localCondition}
         AND source.deleted_at IS NULL AND target.deleted_at IS NULL
       ORDER BY link.source_note_id, link.target_note_id`,
    );
    const bound = currentNoteId
      ? statement.bind(workspaceId, currentNoteId, currentNoteId)
      : statement.bind(workspaceId);
    const result = await bound.all<GraphRow>();
    const nodes = new Map<string, GraphResponse["nodes"][number]>();
    const edges: GraphResponse["edges"] = [];
    for (const row of result.results ?? []) {
      if (!nodes.has(row.source)) {
        nodes.set(row.source, { id: row.source, title: row.source_title, is_current: row.source === currentNoteId });
      }
      if (!nodes.has(row.target)) {
        nodes.set(row.target, { id: row.target, title: row.target_title, is_current: row.target === currentNoteId });
      }
      edges.push({ source: row.source, target: row.target });
    }
    return { nodes: [...nodes.values()], edges };
  }
}
