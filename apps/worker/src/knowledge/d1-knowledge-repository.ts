import type {
  CalendarFeed,
  CalendarFeedItem,
  CalendarFeedQuery,
  SavedSearch,
  SavedSearchFilters,
  SavedSearchInput,
  SearchHit,
  SearchRequest,
  WorkspaceContext,
} from "@nexus/contracts";
import { SavedSearchFiltersSchema } from "@nexus/contracts";

interface SearchDocumentRow {
  entity_type: SearchHit["entity_type"];
  entity_id: string;
  title: string;
  content: string;
  tags: string;
  properties: string;
  attachment_names: string;
  ocr_text: string;
  revision: number;
  updated_at: string;
}

interface SavedSearchRow {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  query: string;
  filters_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

function placeholders(values: readonly unknown[]) {
  return values.map(() => "?").join(", ");
}

function encodeCursor(row: Pick<SearchDocumentRow, "updated_at" | "entity_id">) {
  return encodeURIComponent(`${row.updated_at}\n${row.entity_id}`);
}

function decodeCursor(cursor: string) {
  const decoded = decodeURIComponent(cursor);
  const separator = decoded.indexOf("\n");
  if (separator <= 0 || separator === decoded.length - 1) throw new Error("INVALID_SEARCH_CURSOR");
  return { updatedAt: decoded.slice(0, separator), entityId: decoded.slice(separator + 1) };
}

function searchTokens(query: string) {
  return query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
}

function ftsQuery(query: string) {
  return searchTokens(query)
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(" AND ");
}

function includesToken(value: string, tokens: string[]) {
  const normalized = value.toLocaleLowerCase();
  return tokens.some((token) => normalized.includes(token));
}

function toSearchHit(row: SearchDocumentRow, query: string): SearchHit {
  const tokens = searchTokens(query);
  const fields: Array<[SearchHit["hit_sources"][number], string]> = [
    ["title", row.title],
    ["content", row.content],
    ["tags", row.tags],
    ["properties", row.properties],
    ["attachment_name", row.attachment_names],
    ["ocr", row.ocr_text],
  ];
  const hitSources = fields
    .filter(([, value]) => includesToken(value, tokens))
    .map(([source]) => source);
  const excerptSource = fields.find(([, value]) => includesToken(value, tokens))?.[1]
    ?? row.content
    ?? row.title;
  return {
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    title: row.title,
    excerpt: excerptSource.slice(0, 500),
    hit_sources: hitSources,
    revision: row.revision,
    updated_at: row.updated_at,
  };
}

export class D1KnowledgeRepository {
  constructor(
    private readonly db: D1Database,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async search(workspaceId: string, request: SearchRequest) {
    const conditions = ["sd.workspace_id = ?"];
    const bindings: unknown[] = [workspaceId];
    const query = request.query.trim();
    const joins = [
      query ? "JOIN search_documents_fts ON search_documents_fts.rowid = sd.rowid" : "",
      "LEFT JOIN attachments a ON a.workspace_id = sd.workspace_id AND a.id = sd.entity_id AND sd.entity_type = 'attachment'",
      `LEFT JOIN notes n ON n.workspace_id = sd.workspace_id
         AND n.id = CASE WHEN sd.entity_type = 'note' THEN sd.entity_id ELSE a.note_id END`,
    ].filter(Boolean);

    if (query) {
      conditions.push("search_documents_fts MATCH ?");
      bindings.push(ftsQuery(query));
    }
    this.applyFilters(conditions, bindings, request.filters);
    if (request.cursor) {
      const cursor = decodeCursor(request.cursor);
      conditions.push("(sd.updated_at < ? OR (sd.updated_at = ? AND sd.entity_id < ?))");
      bindings.push(cursor.updatedAt, cursor.updatedAt, cursor.entityId);
    }

    const limit = Math.max(1, Math.min(request.limit, 100));
    const result = await this.db.prepare(
      `SELECT sd.entity_type, sd.entity_id, sd.title, sd.content, sd.tags, sd.properties,
              sd.attachment_names, sd.ocr_text, sd.revision, sd.updated_at
       FROM search_documents sd
       ${joins.join("\n")}
       WHERE ${conditions.join(" AND ")}
       ORDER BY sd.updated_at DESC, sd.entity_id DESC
       LIMIT ?`,
    ).bind(...bindings, limit + 1).all<SearchDocumentRow>();
    const rows = result.results ?? [];
    const pageRows = rows.slice(0, limit);
    return {
      items: pageRows.map((row) => toSearchHit(row, query)),
      nextCursor: rows.length > limit && pageRows.length > 0
        ? encodeCursor(pageRows[pageRows.length - 1]!)
        : null,
    };
  }

  async getCalendarFeed(context: WorkspaceContext, query: CalendarFeedQuery): Promise<CalendarFeed> {
    const result = await this.db.prepare(
      `SELECT id, kind, date, title, entity_id, note_id, database_id, status
       FROM (
         SELECT n.id, 'daily_note' AS kind, n.daily_date AS date, n.title,
                n.id AS entity_id, n.id AS note_id, NULL AS database_id, n.status
         FROM notes n
         WHERE n.workspace_id = ? AND n.daily_date BETWEEN ? AND ?
           AND n.status = 'active' AND n.deleted_at IS NULL
         UNION ALL
         SELECT r.id, 'reminder' AS kind, substr(r.remind_at, 1, 10) AS date,
                COALESCE(n.title, 'Reminder') AS title, r.id AS entity_id,
                r.note_id, NULL AS database_id, r.status
         FROM reminders r
         LEFT JOIN notes n ON n.workspace_id = r.workspace_id AND n.id = r.note_id
         WHERE r.workspace_id = ? AND r.user_id = ?
           AND substr(r.remind_at, 1, 10) BETWEEN ? AND ?
           AND r.status != 'dismissed'
         UNION ALL
         SELECT dr.id, 'database_record' AS kind,
                json_extract(rv.value_json, '$') AS date,
                COALESCE(n.title, d.name) AS title, dr.id AS entity_id,
                dr.note_id, dr.database_id, NULL AS status
         FROM database_records dr
         JOIN databases d ON d.workspace_id = dr.workspace_id AND d.id = dr.database_id
         JOIN database_properties dp ON dp.workspace_id = dr.workspace_id
           AND dp.database_id = dr.database_id AND dp.type = 'date' AND dp.is_hidden = 0
         JOIN record_values rv ON rv.workspace_id = dr.workspace_id
           AND rv.database_id = dr.database_id AND rv.record_id = dr.id AND rv.property_id = dp.id
         LEFT JOIN notes n ON n.workspace_id = dr.workspace_id AND n.id = dr.note_id
         WHERE dr.workspace_id = ?
           AND (
             ? = 'owner'
             OR (
               NOT EXISTS (
                 SELECT 1 FROM field_permissions denied_direct
                 WHERE denied_direct.workspace_id = dr.workspace_id
                   AND denied_direct.database_id = dr.database_id
                   AND denied_direct.property_id = dp.id
                   AND denied_direct.subject_type = 'user'
                   AND denied_direct.subject_id = ?
                   AND denied_direct.can_read = 0
               )
               AND NOT EXISTS (
                 SELECT 1 FROM field_permissions denied_role
                 WHERE denied_role.workspace_id = dr.workspace_id
                   AND denied_role.database_id = dr.database_id
                   AND denied_role.property_id = dp.id
                   AND denied_role.subject_type = 'role'
                   AND denied_role.subject_id = ?
                   AND denied_role.can_read = 0
                   AND NOT EXISTS (
                     SELECT 1 FROM field_permissions allowed_direct
                     WHERE allowed_direct.workspace_id = dr.workspace_id
                       AND allowed_direct.database_id = dr.database_id
                       AND allowed_direct.property_id = dp.id
                       AND allowed_direct.subject_type = 'user'
                       AND allowed_direct.subject_id = ?
                   )
               )
             )
           )
           AND json_extract(rv.value_json, '$') BETWEEN ? AND ?
           AND dr.deleted_at IS NULL
       )
       WHERE date IS NOT NULL
       ORDER BY date ASC, kind ASC, id ASC
       LIMIT 500`,
    ).bind(
      context.workspaceId, query.from, query.to,
      context.workspaceId, context.userId, query.from, query.to,
      context.workspaceId, context.role, context.userId, context.role, context.userId, query.from, query.to,
    ).all<CalendarFeedItem>();
    return { items: result.results ?? [] };
  }

  async createSavedSearch(input: {
    workspaceId: string;
    userId: string;
    input: SavedSearchInput;
    now: string;
  }) {
    const saved: SavedSearch = {
      id: this.createId(),
      workspace_id: input.workspaceId,
      user_id: input.userId,
      name: input.input.name,
      query: input.input.query,
      filters: input.input.filters,
      revision: 1,
      created_at: input.now,
      updated_at: input.now,
    };
    await this.db.prepare(
      `INSERT INTO saved_searches (
         id, workspace_id, user_id, name, query, filters_json, revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      saved.id,
      saved.workspace_id,
      saved.user_id,
      saved.name,
      saved.query,
      JSON.stringify(saved.filters),
      saved.created_at,
      saved.updated_at,
    ).run();
    return saved;
  }

  async listSavedSearches(workspaceId: string, userId: string) {
    const result = await this.db.prepare(
      `SELECT id, workspace_id, user_id, name, query, filters_json, revision, created_at, updated_at
       FROM saved_searches
       WHERE workspace_id = ? AND user_id = ?
       ORDER BY updated_at DESC, id DESC`,
    ).bind(workspaceId, userId).all<SavedSearchRow>();
    return (result.results ?? []).map((row): SavedSearch => ({
      id: row.id,
      workspace_id: row.workspace_id,
      user_id: row.user_id,
      name: row.name,
      query: row.query,
      filters: SavedSearchFiltersSchema.parse(JSON.parse(row.filters_json)),
      revision: row.revision,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  async deleteSavedSearch(workspaceId: string, userId: string, savedSearchId: string) {
    await this.db.prepare(
      `DELETE FROM saved_searches
       WHERE workspace_id = ? AND user_id = ? AND id = ?`,
    ).bind(workspaceId, userId, savedSearchId).run();
  }

  private applyFilters(
    conditions: string[],
    bindings: unknown[],
    filters: SavedSearchFilters,
  ) {
    const addIn = (expression: string, values: readonly unknown[]) => {
      if (values.length === 0) return;
      conditions.push(`${expression} IN (${placeholders(values)})`);
      bindings.push(...values);
    };

    addIn("sd.entity_type", filters.source_types);
    addIn("n.folder_id", filters.folder_ids);
    addIn("n.database_id", filters.database_ids);
    addIn("COALESCE(n.updated_by, a.created_by)", filters.member_ids);
    if (filters.tag_ids.length > 0) {
      conditions.push(
        `EXISTS (
           SELECT 1 FROM note_tags nt
           WHERE nt.workspace_id = sd.workspace_id AND nt.note_id = n.id
             AND nt.tag_id IN (${placeholders(filters.tag_ids)})
         )`,
      );
      bindings.push(...filters.tag_ids);
    }
    if (filters.attachment_types.length > 0) {
      conditions.push(
        `EXISTS (
           SELECT 1 FROM attachments af
           WHERE af.workspace_id = sd.workspace_id
             AND (af.id = sd.entity_id OR af.note_id = sd.entity_id)
             AND af.mime_type IN (${placeholders(filters.attachment_types)})
         )`,
      );
      bindings.push(...filters.attachment_types);
    }
    if (filters.ocr_statuses.length > 0) {
      conditions.push(
        `EXISTS (
           SELECT 1 FROM attachments af
           JOIN ocr_jobs oj ON oj.workspace_id = af.workspace_id AND oj.attachment_id = af.id
           WHERE af.workspace_id = sd.workspace_id
             AND (af.id = sd.entity_id OR af.note_id = sd.entity_id)
             AND oj.status IN (${placeholders(filters.ocr_statuses)})
         )`,
      );
      bindings.push(...filters.ocr_statuses);
    }
    if (filters.favorite !== undefined) {
      conditions.push("n.is_favorite = ?");
      bindings.push(Number(filters.favorite));
    }
    if (filters.pinned !== undefined) {
      conditions.push("n.is_pinned = ?");
      bindings.push(Number(filters.pinned));
    }
    if (filters.date_from) {
      conditions.push("substr(sd.updated_at, 1, 10) >= ?");
      bindings.push(filters.date_from);
    }
    if (filters.date_to) {
      conditions.push("substr(sd.updated_at, 1, 10) <= ?");
      bindings.push(filters.date_to);
    }
  }
}
