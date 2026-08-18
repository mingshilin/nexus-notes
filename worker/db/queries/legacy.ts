export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMemberRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: "owner" | "editor" | "viewer";
  created_at: string;
  updated_at: string;
}

export interface WorkspaceInviteRow {
  id: string;
  workspace_id: string;
  email: string;
  role: "editor" | "viewer";
  note_id: string | null;
  invite_token_hash: string;
  invited_by_user_id: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailVerificationCodeRow {
  id: string;
  user_id: string;
  email: string;
  code_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface NoteRow {
  id: string;
  user_id: string | null;
  workspace_id: string;
  folder_id: string | null;
  folder_name: string | null;
  database_id?: string | null;
  title: string;
  content: string;
  is_favorite: number;
  is_pinned: number;
  is_daily: number;
  daily_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  archived_at: string | null;
  last_opened_at: string | null;
}

export interface DatabaseRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  created_by_user_id: string;
  board_property_id: string | null;
  calendar_property_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DatabasePropertyRow {
  id: string;
  database_id: string;
  name: string;
  type: "title" | "text" | "number" | "checkbox" | "date" | "url" | "email" | "phone" | "rating" | "progress" | "single_select" | "multi_select" | "member";
  config_json: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DatabaseViewRow {
  id: string;
  database_id: string;
  name: string;
  view_kind: "table" | "board" | "calendar";
  config_json: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface DatabaseTemplateRow {
  id: string;
  database_id: string;
  name: string;
  title: string;
  content: string;
  default_values_json: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface DatabasePermissionRow {
  id: string;
  database_id: string;
  subject_type: "workspace_role" | "member";
  subject_id: string;
  role: "viewer" | "editor" | "admin";
  created_at: string;
  updated_at: string;
}

export interface DatabaseFieldPermissionRow {
  id: string;
  property_id: string;
  viewer_roles_json: string;
  editor_roles_json: string;
  created_at: string;
  updated_at: string;
}

export interface CommentRow {
  id: string;
  workspace_id: string;
  note_id: string | null;
  database_id: string | null;
  body: string;
  mentions_json: string;
  created_by_user_id: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedLogRow {
  id: string;
  workspace_id: string;
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata_json: string;
  created_at: string;
}

export interface SavedSearchRow {
  id: string;
  workspace_id: string;
  name: string;
  query: string;
  filters_json: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface NotePropertyValueRow {
  note_id: string;
  property_id: string;
  value_text: string | null;
  value_number: number | null;
  value_boolean: number | null;
  value_date: string | null;
  value_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface TagRow {
  id: string;
  user_id: string | null;
  workspace_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface FolderRow {
  id: string;
  user_id: string;
  workspace_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  note_count?: number;
}

export interface NoteVersionRow {
  id: string;
  note_id: string;
  user_id: string;
  workspace_id: string;
  title: string;
  content: string;
  created_at: string;
}

export interface NoteLinkRow {
  id: string;
  user_id: string;
  workspace_id: string;
  source_note_id: string;
  target_note_id: string | null;
  target_title: string;
  created_at: string;
  source_title?: string;
  target_note_title?: string | null;
}

export interface GraphNodeRow {
  id: string;
  title: string;
  is_current?: boolean;
}

export interface GraphEdgeRow {
  source: string;
  target: string;
  target_title: string;
}

export interface ReminderRow {
  id: string;
  user_id: string;
  workspace_id: string;
  note_id: string | null;
  title: string;
  description: string;
  due_at: string;
  completed_at: string | null;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
  note_title?: string | null;
}

export interface NoteAttachmentRow {
  id: string;
  note_id: string;
  workspace_id: string;
  uploader_id: string;
  storage_key: string;
  file_name: string;
  mime_type: string;
  size: number;
  ocr_text?: string | null;
  ocr_status?: string | null;
  ocr_updated_at?: string | null;
  created_at: string;
}

export interface NotePublicShareRow {
  id: string;
  note_id: string;
  workspace_id: string;
  creator_user_id: string;
  access_mode: "read";
  access_token_hash: string;
  password_hash?: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NoteWithTagsRow
  extends Omit<NoteRow, "is_favorite" | "is_pinned" | "is_daily" | "user_id" | "workspace_id" | "folder_name"> {
  is_favorite: boolean;
  is_pinned: boolean;
  is_daily: boolean;
  tags: Array<Omit<TagRow, "user_id" | "workspace_id">>;
  folder: Omit<FolderRow, "user_id" | "workspace_id" | "note_count"> | null;
  database_values?: Record<string, {
    property_id: string;
    type: DatabasePropertyRow["type"];
    value_text?: string | null;
    value_number?: number | null;
    value_boolean?: boolean | null;
    value_date?: string | null;
    value_json?: string[] | null;
  }>;
}

function normalizeNote(
  row: NoteRow,
  tags: Array<Omit<TagRow, "user_id" | "workspace_id">>,
): NoteWithTagsRow {
  return {
    id: row.id,
    folder_id: row.folder_id,
    database_id: row.database_id ?? null,
    title: row.title,
    content: row.content,
    is_favorite: row.is_favorite === 1,
    is_pinned: row.is_pinned === 1,
    is_daily: row.is_daily === 1,
    daily_date: row.daily_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    archived_at: row.archived_at,
    last_opened_at: row.last_opened_at,
    tags,
    folder: row.folder_id
      ? {
          id: row.folder_id,
          name: row.folder_name ?? "",
          created_at: "",
          updated_at: "",
        }
      : null,
  };
}

export async function getUserByEmail(db: D1Database, email: string) {
  return db
    .prepare(
      `SELECT id, email, password_hash, display_name, bio, avatar_url, email_verified_at, created_at, updated_at
       FROM users
       WHERE email = ?`,
    )
    .bind(email.toLowerCase())
    .first<UserRow>();
}

export async function getUserById(db: D1Database, userId: string) {
  return db
    .prepare(
      `SELECT id, email, password_hash, display_name, bio, avatar_url, email_verified_at, created_at, updated_at
       FROM users
       WHERE id = ?`,
    )
    .bind(userId)
    .first<UserRow>();
}

export async function getWorkspaceById(db: D1Database, workspaceId: string) {
  return db
    .prepare(
      `SELECT id, name, owner_user_id, created_at, updated_at
       FROM workspaces
       WHERE id = ?`,
    )
    .bind(workspaceId)
    .first<WorkspaceRow>();
}

export async function listUserWorkspaces(db: D1Database, userId: string) {
  const result = await db
    .prepare(
      `SELECT w.id, w.name, w.owner_user_id, w.created_at, w.updated_at, wm.role
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.user_id = ?
       ORDER BY w.created_at ASC`,
    )
    .bind(userId)
    .all<WorkspaceRow & { role: "owner" | "editor" | "viewer" }>();
  return result.results;
}

export async function ensurePersonalWorkspaceForUser(
  db: D1Database,
  userId: string,
  fallbackName = "Personal",
) {
  const existing = await db
    .prepare(
      `SELECT w.id, w.name, w.owner_user_id, w.created_at, w.updated_at
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE wm.user_id = ?
       ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, w.created_at ASC
       LIMIT 1`,
    )
    .bind(userId)
    .first<WorkspaceRow>();
  if (existing) return existing;

  const workspaceId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO workspaces (id, name, owner_user_id)
         VALUES (?, ?, ?)`,
      )
      .bind(workspaceId, fallbackName, userId),
    db
      .prepare(
        `INSERT INTO workspace_members (id, workspace_id, user_id, role)
         VALUES (?, ?, ?, 'owner')`,
      )
      .bind(memberId, workspaceId, userId),
  ]);
  const created = await getWorkspaceById(db, workspaceId);
  if (!created) {
    throw new Error("failed to create personal workspace");
  }
  return created;
}

export async function insertUser(
  db: D1Database,
  user: { id: string; email: string; passwordHash: string; displayName?: string | null },
) {
  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, display_name)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(user.id, user.email.toLowerCase(), user.passwordHash, user.displayName ?? null)
    .run();
}

export async function markUserEmailVerified(db: D1Database, userId: string) {
  await db
    .prepare(
      `UPDATE users
       SET email_verified_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(userId)
    .run();
}

export async function updateUserProfile(
  db: D1Database,
  userId: string,
  payload: { displayName?: string | null; bio?: string; avatarUrl?: string | null },
) {
  const fields: string[] = [];
  const bindings: unknown[] = [];
  if (payload.displayName !== undefined) {
    fields.push("display_name = ?");
    bindings.push(payload.displayName);
  }
  if (payload.bio !== undefined) {
    fields.push("bio = ?");
    bindings.push(payload.bio);
  }
  if (payload.avatarUrl !== undefined) {
    fields.push("avatar_url = ?");
    bindings.push(payload.avatarUrl);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  await db
    .prepare(
      `UPDATE users
       SET ${fields.join(", ")}
       WHERE id = ?`,
    )
    .bind(...bindings, userId)
    .run();
}

export async function insertSession(
  db: D1Database,
  session: {
    id: string;
    userId: string;
    tokenHash: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: string;
  },
) {
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_address, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      session.id,
      session.userId,
      session.tokenHash,
      session.userAgent,
      session.ipAddress,
      session.expiresAt,
    )
    .run();
}

export async function getSessionByTokenHash(db: D1Database, tokenHash: string) {
  return db
    .prepare(
      `SELECT id, user_id, token_hash, user_agent, ip_address, expires_at, created_at, revoked_at
       FROM sessions
       WHERE token_hash = ?`,
    )
    .bind(tokenHash)
    .first<SessionRow>();
}

export async function revokeSessionByTokenHash(db: D1Database, tokenHash: string) {
  await db
    .prepare(
      `UPDATE sessions
       SET revoked_at = datetime('now')
       WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .bind(tokenHash)
    .run();
}

export async function insertEmailVerificationToken(
  db: D1Database,
  token: { id: string; userId: string; tokenHash: string; expiresAt: string },
) {
  await db
    .prepare(
      `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(token.id, token.userId, token.tokenHash, token.expiresAt)
    .run();
}

export async function consumeEmailVerificationToken(
  db: D1Database,
  tokenHash: string,
) {
  const token = await db
    .prepare(
      `SELECT id, user_id, token_hash, expires_at, used_at, created_at
       FROM email_verification_tokens
       WHERE token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{
      id: string;
      user_id: string;
      token_hash: string;
      expires_at: string;
      used_at: string | null;
      created_at: string;
    }>();

  if (!token) return null;
  if (token.used_at) return token;
  if (new Date(token.expires_at).getTime() <= Date.now()) return token;

  await db
    .prepare(
      `UPDATE email_verification_tokens
       SET used_at = datetime('now')
       WHERE id = ? AND used_at IS NULL`,
    )
    .bind(token.id)
    .run();

  return token;
}

export async function createEmailVerificationCode(
  db: D1Database,
  payload: { id: string; userId: string; email: string; codeHash: string; expiresAt: string },
) {
  await db.batch([
    db
      .prepare(
        `UPDATE email_verification_codes
         SET used_at = COALESCE(used_at, datetime('now'))
         WHERE user_id = ? AND used_at IS NULL`,
      )
      .bind(payload.userId),
    db
      .prepare(
        `INSERT INTO email_verification_codes (id, user_id, email, code_hash, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(payload.id, payload.userId, payload.email.toLowerCase(), payload.codeHash, payload.expiresAt),
  ]);
}

export async function getEmailVerificationCodeByEmailAndHash(
  db: D1Database,
  email: string,
  codeHash: string,
) {
  return db
    .prepare(
      `SELECT id, user_id, email, code_hash, expires_at, used_at, created_at
       FROM email_verification_codes
       WHERE email = ? AND code_hash = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(email.toLowerCase(), codeHash)
    .first<EmailVerificationCodeRow>();
}

export async function markEmailVerificationCodeUsed(db: D1Database, codeId: string) {
  await db
    .prepare(
      `UPDATE email_verification_codes
       SET used_at = datetime('now')
       WHERE id = ? AND used_at IS NULL`,
    )
    .bind(codeId)
    .run();
}

export async function insertPasswordResetToken(
  db: D1Database,
  token: { id: string; userId: string; tokenHash: string; expiresAt: string },
) {
  await db
    .prepare(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(token.id, token.userId, token.tokenHash, token.expiresAt)
    .run();
}

export async function getPasswordResetTokenByHash(db: D1Database, tokenHash: string) {
  return db
    .prepare(
      `SELECT id, user_id, token_hash, expires_at, used_at, created_at
       FROM password_reset_tokens
       WHERE token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{
      id: string;
      user_id: string;
      token_hash: string;
      expires_at: string;
      used_at: string | null;
      created_at: string;
    }>();
}

export async function markPasswordResetTokenUsed(db: D1Database, tokenId: string) {
  return db
    .prepare(
      `UPDATE password_reset_tokens
       SET used_at = datetime('now')
       WHERE id = ? AND used_at IS NULL`,
    )
    .bind(tokenId)
    .run();
}

export async function consumePasswordResetToken(db: D1Database, tokenHash: string) {
  const token = await getPasswordResetTokenByHash(db, tokenHash);
  if (!token) return null;
  if (token.used_at) return token;
  if (new Date(token.expires_at).getTime() <= Date.now()) return token;
  await markPasswordResetTokenUsed(db, token.id);
  return token;
}

export async function updateUserPassword(
  db: D1Database,
  userId: string,
  passwordHash: string,
) {
  await db
    .prepare(
      `UPDATE users
       SET password_hash = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(passwordHash, userId)
    .run();
}

async function getTagsByNoteIds(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteIds: string[],
) {
  if (noteIds.length === 0) return new Map<string, Array<Omit<TagRow, "user_id" | "workspace_id">>>();
  const placeholders = noteIds.map(() => "?").join(",");
  const result = await db
    .prepare(
      `SELECT nt.note_id, t.id, t.name, t.color, t.created_at, t.updated_at
       FROM note_tags nt
       JOIN tags t ON t.id = nt.tag_id
       JOIN notes n ON n.id = nt.note_id
       WHERE nt.note_id IN (${placeholders})
         AND n.workspace_id = ?
       ORDER BY t.name COLLATE NOCASE ASC`,
    )
    .bind(...noteIds, workspaceId)
    .all<{
      note_id: string;
      id: string;
      name: string;
      color: string;
      created_at: string;
      updated_at: string;
    }>();

  const map = new Map<string, Array<Omit<TagRow, "user_id" | "workspace_id">>>();
  for (const row of result.results) {
    const item = map.get(row.note_id) ?? [];
    item.push({
      id: row.id,
      name: row.name,
      color: row.color,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    map.set(row.note_id, item);
  }
  return map;
}

export async function listNotes(
  db: D1Database,
  userId: string,
  workspaceId: string,
  options: {
    page: number;
    pageSize: number;
    q?: string;
    tag?: string;
    favorite?: boolean;
    pinned?: boolean;
    folderId?: string | null;
    archived?: boolean;
    recent?: boolean;
    daily?: boolean;
    dailyDate?: string;
    databaseId?: string | null;
    deletedMode?: "exclude" | "only" | "include";
  },
) {
  const where: string[] = ["n.workspace_id = ?"];
  const bindings: unknown[] = [workspaceId];

  const deletedMode = options.deletedMode ?? "exclude";
  if (deletedMode === "only") {
    where.push("n.deleted_at IS NOT NULL");
  } else if (deletedMode === "exclude") {
    where.push("n.deleted_at IS NULL");
  }

  if (options.archived === true) {
    where.push("n.archived_at IS NOT NULL");
  } else if (deletedMode !== "only") {
    where.push("n.archived_at IS NULL");
  }

  const q = options.q?.trim();
  if (q) {
    const like = `%${q}%`;
    where.push(`(
      n.title LIKE ?
      OR n.content LIKE ?
      OR EXISTS (
        SELECT 1
        FROM note_tags nt_search
        JOIN tags t_search ON t_search.id = nt_search.tag_id
        WHERE nt_search.note_id = n.id
          AND t_search.workspace_id = ?
          AND t_search.name LIKE ?
      )
      OR EXISTS (
        SELECT 1
        FROM note_property_values npv_search
        JOIN database_properties dp_search ON dp_search.id = npv_search.property_id
        WHERE npv_search.note_id = n.id
          AND (
            npv_search.value_text LIKE ?
            OR CAST(npv_search.value_number AS TEXT) LIKE ?
            OR npv_search.value_date LIKE ?
            OR npv_search.value_json LIKE ?
            OR dp_search.name LIKE ?
          )
      )
      OR EXISTS (
        SELECT 1
        FROM note_attachments na_search
        WHERE na_search.note_id = n.id
          AND na_search.workspace_id = ?
          AND (na_search.file_name LIKE ? OR na_search.ocr_text LIKE ?)
      )
      OR f.name LIKE ?
    )`);
    bindings.push(like, like, workspaceId, like, like, like, like, like, like, workspaceId, like, like, like);
  }

  if (options.favorite !== undefined) {
    where.push("n.is_favorite = ?");
    bindings.push(options.favorite ? 1 : 0);
  }

  if (options.pinned !== undefined) {
    where.push("n.is_pinned = ?");
    bindings.push(options.pinned ? 1 : 0);
  }

  if (options.folderId !== undefined) {
    if (options.folderId === null || options.folderId === "") {
      where.push("n.folder_id IS NULL");
    } else {
      where.push("n.folder_id = ?");
      bindings.push(options.folderId);
    }
  }

  if (options.databaseId !== undefined) {
    if (options.databaseId === null || options.databaseId === "") {
      where.push("n.database_id IS NULL");
    } else {
      where.push("n.database_id = ?");
      bindings.push(options.databaseId);
    }
  }

  if (options.recent) {
    where.push("n.last_opened_at IS NOT NULL");
  }

  if (options.daily !== undefined) {
    where.push("n.is_daily = ?");
    bindings.push(options.daily ? 1 : 0);
  }

  if (options.dailyDate) {
    where.push("n.daily_date = ?");
    bindings.push(options.dailyDate);
  }

  if (options.tag) {
    where.push(
      `EXISTS (
         SELECT 1
         FROM note_tags nt
         JOIN tags t ON t.id = nt.tag_id
         WHERE nt.note_id = n.id
           AND t.workspace_id = ?
           AND (t.id = ? OR t.name = ?)
       )`,
    );
    bindings.push(workspaceId, options.tag, options.tag);
  }

  const page = Math.max(1, options.page);
  const pageSize = Math.max(1, Math.min(100, options.pageSize));
  const offset = (page - 1) * pageSize;

  const scoreSql = q
    ? `CASE
         WHEN lower(n.title) = lower(?) THEN 0
         WHEN n.title LIKE ? THEN 1
         WHEN EXISTS (
           SELECT 1
           FROM note_tags nt_score
           JOIN tags t_score ON t_score.id = nt_score.tag_id
           WHERE nt_score.note_id = n.id
             AND t_score.workspace_id = ?
             AND t_score.name LIKE ?
         ) THEN 2
         WHEN f.name LIKE ? THEN 3
         WHEN n.content LIKE ? THEN 4
         ELSE 5
       END,`
    : "";

  const scoreBindings: unknown[] = [];
  if (q) {
    const like = `%${q}%`;
    scoreBindings.push(q, like, workspaceId, like, like, like);
  }

  const countSql = `
    SELECT COUNT(*) AS count
    FROM notes n
    LEFT JOIN folders f ON f.id = n.folder_id AND f.workspace_id = n.workspace_id
    WHERE ${where.join(" AND ")}
  `;
  const countResult = await db
    .prepare(countSql)
    .bind(...bindings)
    .first<{ count: number }>();
  const total = Number(countResult?.count ?? 0);

  const rowsSql = `
    SELECT
      n.id, n.user_id, n.folder_id, f.name AS folder_name, n.database_id,
      n.title, n.content, n.is_favorite, n.is_pinned, n.is_daily, n.daily_date,
      n.created_at, n.updated_at, n.deleted_at, n.archived_at, n.last_opened_at
    FROM notes n
    LEFT JOIN folders f ON f.id = n.folder_id AND f.workspace_id = n.workspace_id
    WHERE ${where.join(" AND ")}
    ORDER BY ${scoreSql} n.is_pinned DESC, ${options.recent ? "n.last_opened_at DESC," : ""} n.updated_at DESC
    LIMIT ? OFFSET ?
  `;
  const rowResult = await db
    .prepare(rowsSql)
    .bind(...bindings, ...scoreBindings, pageSize, offset)
    .all<NoteRow>();

  const noteIds = rowResult.results.map((row) => row.id);
  const tagMap = await getTagsByNoteIds(db, userId, workspaceId, noteIds);

  return {
    items: rowResult.results.map((row) => normalizeNote(row, tagMap.get(row.id) ?? [])),
    total,
    page,
    pageSize,
  };
}

export async function getNoteById(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
  includeDeleted = false,
) {
  const row = await db
    .prepare(
      `SELECT
         n.id, n.user_id, n.folder_id, f.name AS folder_name, n.database_id,
         n.title, n.content, n.is_favorite, n.is_pinned, n.is_daily, n.daily_date,
         n.created_at, n.updated_at, n.deleted_at, n.archived_at, n.last_opened_at
       FROM notes n
       LEFT JOIN folders f ON f.id = n.folder_id AND f.workspace_id = n.workspace_id
       WHERE n.id = ? AND n.workspace_id = ? ${includeDeleted ? "" : "AND n.deleted_at IS NULL"}`,
    )
    .bind(noteId, workspaceId)
    .first<NoteRow>();
  if (!row) return null;
  const tagMap = await getTagsByNoteIds(db, userId, workspaceId, [noteId]);
  const note = normalizeNote(row, tagMap.get(noteId) ?? []);
  if (row.database_id) {
    const valueMap = await listNotePropertyValuesByNoteIds(db, workspaceId, [noteId]);
    note.database_values = valueMap.get(noteId) ?? {};
  }
  return note;
}

export async function insertNote(
  db: D1Database,
  userId: string,
  workspaceId: string,
  note: {
    id: string;
    title: string;
    content: string;
    isFavorite: boolean;
    folderId?: string | null;
    databaseId?: string | null;
    isDaily?: boolean;
    dailyDate?: string | null;
  },
) {
  await db
    .prepare(
      `INSERT INTO notes (id, user_id, workspace_id, folder_id, database_id, title, content, is_favorite, is_daily, daily_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      note.id,
      userId,
      workspaceId,
      note.folderId ?? null,
      note.databaseId ?? null,
      note.title,
      note.content,
      note.isFavorite ? 1 : 0,
      note.isDaily ? 1 : 0,
      note.dailyDate ?? null,
    )
    .run();
}

export async function updateNoteById(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
  payload: {
    title?: string;
    content?: string;
    isFavorite?: boolean;
    isPinned?: boolean;
    folderId?: string | null;
    databaseId?: string | null;
  },
) {
  const fields: string[] = [];
  const bindings: unknown[] = [];
  if (payload.title !== undefined) {
    fields.push("title = ?");
    bindings.push(payload.title);
  }
  if (payload.content !== undefined) {
    fields.push("content = ?");
    bindings.push(payload.content);
  }
  if (payload.isFavorite !== undefined) {
    fields.push("is_favorite = ?");
    bindings.push(payload.isFavorite ? 1 : 0);
  }
  if (payload.isPinned !== undefined) {
    fields.push("is_pinned = ?");
    bindings.push(payload.isPinned ? 1 : 0);
  }
  if (payload.folderId !== undefined) {
    fields.push("folder_id = ?");
    bindings.push(payload.folderId);
  }
  if (payload.databaseId !== undefined) {
    fields.push("database_id = ?");
    bindings.push(payload.databaseId);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  await db
    .prepare(
      `UPDATE notes
       SET ${fields.join(", ")}
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(...bindings, noteId, workspaceId)
    .run();
}

function parsePropertyConfig(configJson: string | null) {
  try {
    return JSON.parse(configJson || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseDatabaseViewConfig(configJson: string | null) {
  try {
    return JSON.parse(configJson || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeNotePropertyValue(
  row: NotePropertyValueRow,
  propertyType: DatabasePropertyRow["type"],
) {
  let valueJson: string[] | null = null;
  if (row.value_json) {
    try {
      const parsed = JSON.parse(row.value_json) as unknown;
      if (Array.isArray(parsed)) valueJson = parsed.filter((item): item is string => typeof item === "string");
    } catch {
      valueJson = null;
    }
  }

  return {
    property_id: row.property_id,
    type: propertyType,
    value_text: row.value_text,
    value_number: row.value_number,
    value_boolean: row.value_boolean === null ? null : row.value_boolean === 1,
    value_date: row.value_date,
    value_json: valueJson,
  };
}

export async function listDatabases(
  db: D1Database,
  userId: string,
  workspaceId: string,
) {
  const result = await db
    .prepare(
      `SELECT id, workspace_id, name, description, icon, created_by_user_id, board_property_id, calendar_property_id, created_at, updated_at
       FROM databases
       WHERE workspace_id = ?
       ORDER BY created_at ASC`,
    )
    .bind(workspaceId)
    .all<DatabaseRow>();
  return result.results;
}

export async function getDatabaseById(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
) {
  return db
    .prepare(
      `SELECT id, workspace_id, name, description, icon, created_by_user_id, board_property_id, calendar_property_id, created_at, updated_at
       FROM databases
       WHERE id = ? AND workspace_id = ?`,
    )
    .bind(databaseId, workspaceId)
    .first<DatabaseRow>();
}

export async function listDatabaseViews(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
) {
  const result = await db
    .prepare(
      `SELECT v.id, v.database_id, v.name, v.view_kind, v.config_json, v.created_by_user_id, v.created_at, v.updated_at
       FROM database_views v
       JOIN databases d ON d.id = v.database_id
       WHERE v.database_id = ? AND d.workspace_id = ?
       ORDER BY v.updated_at DESC, v.created_at DESC`,
    )
    .bind(databaseId, workspaceId)
    .all<DatabaseViewRow>();
  return result.results.map((row) => ({
    id: row.id,
    database_id: row.database_id,
    name: row.name,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    view: row.view_kind,
    ...parseDatabaseViewConfig(row.config_json),
  }));
}

export async function getDatabaseViewById(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  viewId: string,
) {
  const row = await db
    .prepare(
      `SELECT v.id, v.database_id, v.name, v.view_kind, v.config_json, v.created_by_user_id, v.created_at, v.updated_at
       FROM database_views v
       JOIN databases d ON d.id = v.database_id
       WHERE v.id = ? AND v.database_id = ? AND d.workspace_id = ?`,
    )
    .bind(viewId, databaseId, workspaceId)
    .first<DatabaseViewRow>();
  return row ? {
    id: row.id,
    database_id: row.database_id,
    name: row.name,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    view: row.view_kind,
    ...parseDatabaseViewConfig(row.config_json),
  } : null;
}

export async function insertDatabaseView(
  db: D1Database,
  payload: {
    id: string;
    databaseId: string;
    name: string;
    viewKind: "table" | "board" | "calendar";
    configJson: string;
    createdByUserId: string;
  },
) {
  await db
    .prepare(
      `INSERT INTO database_views (id, database_id, name, view_kind, config_json, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(payload.id, payload.databaseId, payload.name, payload.viewKind, payload.configJson, payload.createdByUserId)
    .run();
}

export async function updateDatabaseViewById(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  viewId: string,
  payload: {
    name?: string;
    viewKind?: "table" | "board" | "calendar";
    configJson?: string;
  },
) {
  const fields: string[] = [];
  const bindings: unknown[] = [];
  if (payload.name !== undefined) {
    fields.push("name = ?");
    bindings.push(payload.name);
  }
  if (payload.viewKind !== undefined) {
    fields.push("view_kind = ?");
    bindings.push(payload.viewKind);
  }
  if (payload.configJson !== undefined) {
    fields.push("config_json = ?");
    bindings.push(payload.configJson);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  await db
    .prepare(
      `UPDATE database_views
       SET ${fields.join(", ")}
       WHERE id = ? AND database_id = ?
         AND EXISTS (SELECT 1 FROM databases WHERE id = ? AND workspace_id = ?)`,
    )
    .bind(...bindings, viewId, databaseId, databaseId, workspaceId)
    .run();
}

export async function deleteDatabaseViewById(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  viewId: string,
) {
  await db
    .prepare(
      `DELETE FROM database_views
       WHERE id = ? AND database_id = ?
         AND EXISTS (SELECT 1 FROM databases WHERE id = ? AND workspace_id = ?)`,
    )
    .bind(viewId, databaseId, databaseId, workspaceId)
    .run();
}

export async function insertDatabase(
  db: D1Database,
  payload: {
    id: string;
    workspaceId: string;
    name: string;
    description?: string | null;
    icon?: string | null;
    createdByUserId: string;
  },
) {
  await db
    .prepare(
      `INSERT INTO databases (id, workspace_id, name, description, icon, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      payload.id,
      payload.workspaceId,
      payload.name,
      payload.description ?? null,
      payload.icon ?? null,
      payload.createdByUserId,
    )
    .run();
}

export async function updateDatabaseById(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  payload: {
    name?: string;
    description?: string | null;
    icon?: string | null;
    boardPropertyId?: string | null;
    calendarPropertyId?: string | null;
  },
) {
  const fields: string[] = [];
  const bindings: unknown[] = [];
  if (payload.name !== undefined) {
    fields.push("name = ?");
    bindings.push(payload.name);
  }
  if (payload.description !== undefined) {
    fields.push("description = ?");
    bindings.push(payload.description);
  }
  if (payload.icon !== undefined) {
    fields.push("icon = ?");
    bindings.push(payload.icon);
  }
  if (payload.boardPropertyId !== undefined) {
    fields.push("board_property_id = ?");
    bindings.push(payload.boardPropertyId);
  }
  if (payload.calendarPropertyId !== undefined) {
    fields.push("calendar_property_id = ?");
    bindings.push(payload.calendarPropertyId);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  await db
    .prepare(
      `UPDATE databases
       SET ${fields.join(", ")}
       WHERE id = ? AND workspace_id = ?`,
    )
    .bind(...bindings, databaseId, workspaceId)
    .run();
}

export async function detachNotesFromDatabase(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
) {
  await db
    .prepare(
      `UPDATE notes
       SET database_id = NULL, updated_at = datetime('now')
       WHERE workspace_id = ? AND database_id = ?`,
    )
    .bind(workspaceId, databaseId)
    .run();
}

export async function deleteDatabaseById(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
) {
  await db
    .prepare(`DELETE FROM databases WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, databaseId)
    .run();
}

export async function listDatabaseProperties(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
) {
  const result = await db
    .prepare(
      `SELECT p.id, p.database_id, p.name, p.type, p.config_json, p.sort_order, p.created_at, p.updated_at
       FROM database_properties p
       JOIN databases d ON d.id = p.database_id
       WHERE p.database_id = ? AND d.workspace_id = ?
       ORDER BY p.sort_order ASC, p.created_at ASC`,
    )
    .bind(databaseId, workspaceId)
    .all<DatabasePropertyRow>();
  return result.results.map((row) => ({
    ...row,
    config: parsePropertyConfig(row.config_json),
  }));
}

export async function getDatabasePropertyById(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  propertyId: string,
) {
  const row = await db
    .prepare(
      `SELECT p.id, p.database_id, p.name, p.type, p.config_json, p.sort_order, p.created_at, p.updated_at
       FROM database_properties p
       JOIN databases d ON d.id = p.database_id
       WHERE p.id = ? AND p.database_id = ? AND d.workspace_id = ?`,
    )
    .bind(propertyId, databaseId, workspaceId)
    .first<DatabasePropertyRow>();
  return row ? { ...row, config: parsePropertyConfig(row.config_json) } : null;
}

export async function insertDatabaseProperty(
  db: D1Database,
  payload: {
    id: string;
    databaseId: string;
    name: string;
    type: DatabasePropertyRow["type"];
    configJson: string;
    sortOrder: number;
  },
) {
  await db
    .prepare(
      `INSERT INTO database_properties (id, database_id, name, type, config_json, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(payload.id, payload.databaseId, payload.name, payload.type, payload.configJson, payload.sortOrder)
    .run();
}

export async function updateDatabasePropertyById(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  propertyId: string,
  payload: {
    name?: string;
    configJson?: string;
    sortOrder?: number;
  },
) {
  const fields: string[] = [];
  const bindings: unknown[] = [];
  if (payload.name !== undefined) {
    fields.push("name = ?");
    bindings.push(payload.name);
  }
  if (payload.configJson !== undefined) {
    fields.push("config_json = ?");
    bindings.push(payload.configJson);
  }
  if (payload.sortOrder !== undefined) {
    fields.push("sort_order = ?");
    bindings.push(payload.sortOrder);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  await db
    .prepare(
      `UPDATE database_properties
       SET ${fields.join(", ")}
       WHERE id = ? AND database_id = ?
         AND EXISTS (SELECT 1 FROM databases WHERE id = ? AND workspace_id = ?)`,
    )
    .bind(...bindings, propertyId, databaseId, databaseId, workspaceId)
    .run();
}

export async function deleteDatabasePropertyById(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  propertyId: string,
) {
  await db
    .prepare(
      `DELETE FROM database_properties
       WHERE id = ? AND database_id = ?
         AND EXISTS (SELECT 1 FROM databases WHERE id = ? AND workspace_id = ?)`,
    )
    .bind(propertyId, databaseId, databaseId, workspaceId)
    .run();
}

export async function listNotePropertyValuesByNoteIds(
  db: D1Database,
  workspaceId: string,
  noteIds: string[],
) {
  if (noteIds.length === 0) return new Map<string, Record<string, ReturnType<typeof normalizeNotePropertyValue>>>();
  const placeholders = noteIds.map(() => "?").join(",");
  const result = await db
    .prepare(
      `SELECT v.note_id, v.property_id, v.value_text, v.value_number, v.value_boolean, v.value_date, v.value_json, v.created_at, v.updated_at, p.type
       FROM note_property_values v
       JOIN database_properties p ON p.id = v.property_id
       JOIN notes n ON n.id = v.note_id
       WHERE v.note_id IN (${placeholders}) AND n.workspace_id = ?
       ORDER BY p.sort_order ASC, p.created_at ASC`,
    )
    .bind(...noteIds, workspaceId)
    .all<NotePropertyValueRow & { type: DatabasePropertyRow["type"] }>();

  const map = new Map<string, Record<string, ReturnType<typeof normalizeNotePropertyValue>>>();
  for (const row of result.results) {
    const current = map.get(row.note_id) ?? {};
    current[row.property_id] = normalizeNotePropertyValue(row, row.type);
    map.set(row.note_id, current);
  }
  return map;
}

export async function listDatabaseNotes(
  db: D1Database,
  userId: string,
  workspaceId: string,
  databaseId: string,
) {
  const noteResult = await listNotes(db, userId, workspaceId, {
    page: 1,
    pageSize: 500,
    databaseId,
    deletedMode: "exclude",
  });
  const valueMap = await listNotePropertyValuesByNoteIds(
    db,
    workspaceId,
    noteResult.items.map((item) => item.id),
  );
  return noteResult.items.map((item) => ({
    ...item,
    database_values: valueMap.get(item.id) ?? {},
  }));
}

export async function upsertNotePropertyValues(
  db: D1Database,
  workspaceId: string,
  noteId: string,
  values: Array<{
    propertyId: string;
    valueText?: string | null;
    valueNumber?: number | null;
    valueBoolean?: boolean | null;
    valueDate?: string | null;
    valueJson?: string[] | null;
  }>,
) {
  for (const value of values) {
    await db
      .prepare(
        `INSERT INTO note_property_values (
           note_id, property_id, value_text, value_number, value_boolean, value_date, value_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(note_id, property_id) DO UPDATE SET
           value_text = excluded.value_text,
           value_number = excluded.value_number,
           value_boolean = excluded.value_boolean,
           value_date = excluded.value_date,
           value_json = excluded.value_json,
           updated_at = datetime('now')`,
      )
      .bind(
        noteId,
        value.propertyId,
        value.valueText ?? null,
        value.valueNumber ?? null,
        value.valueBoolean === undefined ? null : value.valueBoolean ? 1 : 0,
        value.valueDate ?? null,
        value.valueJson ? JSON.stringify(value.valueJson) : null,
      )
      .run();
  }
}

function parseStringArrayJson(json: string | null, fallback: string[] = []) {
  try {
    const parsed = JSON.parse(json || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : fallback;
  } catch {
    return fallback;
  }
}

function parseTemplateValues(json: string | null) {
  try {
    const parsed = JSON.parse(json || "[]") as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function listDatabaseTemplates(db: D1Database, workspaceId: string, databaseId: string) {
  const result = await db
    .prepare(
      `SELECT t.id, t.database_id, t.name, t.title, t.content, t.default_values_json, t.created_by_user_id, t.created_at, t.updated_at
       FROM database_templates t
       JOIN databases d ON d.id = t.database_id
       WHERE t.database_id = ? AND d.workspace_id = ?
       ORDER BY t.updated_at DESC, t.created_at DESC`,
    )
    .bind(databaseId, workspaceId)
    .all<DatabaseTemplateRow>();
  return result.results.map((row) => ({
    id: row.id,
    database_id: row.database_id,
    name: row.name,
    title: row.title,
    content: row.content,
    default_values: parseTemplateValues(row.default_values_json),
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export async function getDatabaseTemplateById(db: D1Database, workspaceId: string, databaseId: string, templateId: string) {
  const row = await db
    .prepare(
      `SELECT t.id, t.database_id, t.name, t.title, t.content, t.default_values_json, t.created_by_user_id, t.created_at, t.updated_at
       FROM database_templates t
       JOIN databases d ON d.id = t.database_id
       WHERE t.id = ? AND t.database_id = ? AND d.workspace_id = ?`,
    )
    .bind(templateId, databaseId, workspaceId)
    .first<DatabaseTemplateRow>();
  return row
    ? {
        id: row.id,
        database_id: row.database_id,
        name: row.name,
        title: row.title,
        content: row.content,
        default_values: parseTemplateValues(row.default_values_json),
        created_by_user_id: row.created_by_user_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }
    : null;
}

export async function insertDatabaseTemplate(
  db: D1Database,
  payload: { id: string; databaseId: string; name: string; title: string; content: string; defaultValuesJson: string; createdByUserId: string },
) {
  await db
    .prepare(
      `INSERT INTO database_templates (id, database_id, name, title, content, default_values_json, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(payload.id, payload.databaseId, payload.name, payload.title, payload.content, payload.defaultValuesJson, payload.createdByUserId)
    .run();
}

export async function updateDatabaseTemplateById(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  templateId: string,
  payload: { name?: string; title?: string; content?: string; defaultValuesJson?: string },
) {
  const fields: string[] = [];
  const bindings: unknown[] = [];
  if (payload.name !== undefined) {
    fields.push("name = ?");
    bindings.push(payload.name);
  }
  if (payload.title !== undefined) {
    fields.push("title = ?");
    bindings.push(payload.title);
  }
  if (payload.content !== undefined) {
    fields.push("content = ?");
    bindings.push(payload.content);
  }
  if (payload.defaultValuesJson !== undefined) {
    fields.push("default_values_json = ?");
    bindings.push(payload.defaultValuesJson);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  await db
    .prepare(
      `UPDATE database_templates
       SET ${fields.join(", ")}
       WHERE id = ? AND database_id = ?
         AND EXISTS (SELECT 1 FROM databases WHERE id = ? AND workspace_id = ?)`,
    )
    .bind(...bindings, templateId, databaseId, databaseId, workspaceId)
    .run();
}

export async function deleteDatabaseTemplateById(db: D1Database, workspaceId: string, databaseId: string, templateId: string) {
  await db
    .prepare(
      `DELETE FROM database_templates
       WHERE id = ? AND database_id = ?
         AND EXISTS (SELECT 1 FROM databases WHERE id = ? AND workspace_id = ?)`,
    )
    .bind(templateId, databaseId, databaseId, workspaceId)
    .run();
}

export async function duplicateDatabaseNote(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId, true);
  if (!note) return null;
  const id = crypto.randomUUID();
  await insertNote(db, userId, workspaceId, {
    id,
    title: `${note.title || "Untitled"} Copy`,
    content: note.content,
    isFavorite: false,
    databaseId: note.database_id ?? null,
    folderId: note.folder_id ?? null,
  });
  const values = await listNotePropertyValuesByNoteIds(db, workspaceId, [noteId]);
  const current = values.get(noteId) ?? {};
  const nextValues = Object.values(current)
    .filter((value) => value.type !== "title")
    .map((value) => ({
      propertyId: value.property_id,
      valueText: value.value_text ?? null,
      valueNumber: value.value_number ?? null,
      valueBoolean: value.value_boolean ?? null,
      valueDate: value.value_date ?? null,
      valueJson: value.value_json ?? null,
    }));
  await upsertNotePropertyValues(db, workspaceId, id, nextValues);
  return getNoteById(db, userId, workspaceId, id);
}

export async function listDatabaseDuplicateTitleGroups(db: D1Database, workspaceId: string, databaseId: string) {
  const result = await db
    .prepare(
      `SELECT lower(trim(title)) AS normalized_title
       FROM notes
       WHERE workspace_id = ? AND database_id = ? AND deleted_at IS NULL AND archived_at IS NULL AND trim(title) <> ''
       GROUP BY lower(trim(title))
       HAVING COUNT(*) > 1
       ORDER BY COUNT(*) DESC, normalized_title ASC
       LIMIT 20`,
    )
    .bind(workspaceId, databaseId)
    .all<{ normalized_title: string }>();

  const groups = [];
  for (const row of result.results) {
    const notesResult = await db
      .prepare(
        `SELECT id, title, updated_at
         FROM notes
         WHERE workspace_id = ? AND database_id = ? AND deleted_at IS NULL AND archived_at IS NULL AND lower(trim(title)) = ?
         ORDER BY updated_at DESC`,
      )
      .bind(workspaceId, databaseId, row.normalized_title)
      .all<{ id: string; title: string; updated_at: string }>();
    groups.push({ title: notesResult.results[0]?.title ?? row.normalized_title, notes: notesResult.results });
  }
  return groups;
}

export async function listDatabasePermissions(db: D1Database, workspaceId: string, databaseId: string) {
  const result = await db
    .prepare(
      `SELECT p.id, p.database_id, p.subject_type, p.subject_id, p.role, p.created_at, p.updated_at
       FROM database_permissions p
       JOIN databases d ON d.id = p.database_id
       WHERE p.database_id = ? AND d.workspace_id = ?
       ORDER BY p.subject_type ASC, p.subject_id ASC`,
    )
    .bind(databaseId, workspaceId)
    .all<DatabasePermissionRow>();
  return result.results;
}

export async function replaceDatabasePermissions(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  permissions: Array<{ subjectType: string; subjectId: string; role: string }>,
) {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `DELETE FROM database_permissions
         WHERE database_id = ?
           AND EXISTS (SELECT 1 FROM databases WHERE id = ? AND workspace_id = ?)`,
      )
      .bind(databaseId, databaseId, workspaceId),
  ];
  for (const permission of permissions) {
    statements.push(
      db
        .prepare(
          `INSERT INTO database_permissions (id, database_id, subject_type, subject_id, role)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), databaseId, permission.subjectType, permission.subjectId, permission.role),
    );
  }
  await db.batch(statements);
}

export async function getDatabaseFieldPermission(db: D1Database, workspaceId: string, databaseId: string, propertyId: string) {
  const row = await db
    .prepare(
      `SELECT fp.id, fp.property_id, fp.viewer_roles_json, fp.editor_roles_json, fp.created_at, fp.updated_at
       FROM database_field_permissions fp
       JOIN database_properties p ON p.id = fp.property_id
       JOIN databases d ON d.id = p.database_id
       WHERE fp.property_id = ? AND p.database_id = ? AND d.workspace_id = ?`,
    )
    .bind(propertyId, databaseId, workspaceId)
    .first<DatabaseFieldPermissionRow>();
  if (!row) {
    return {
      id: "",
      property_id: propertyId,
      viewer_roles: ["owner", "editor", "viewer"],
      editor_roles: ["owner", "editor"],
      created_at: "",
      updated_at: "",
    };
  }
  return {
    id: row.id,
    property_id: row.property_id,
    viewer_roles: parseStringArrayJson(row.viewer_roles_json, ["owner", "editor", "viewer"]),
    editor_roles: parseStringArrayJson(row.editor_roles_json, ["owner", "editor"]),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function upsertDatabaseFieldPermission(
  db: D1Database,
  workspaceId: string,
  databaseId: string,
  propertyId: string,
  payload: { viewerRoles: string[]; editorRoles: string[] },
) {
  await db
    .prepare(
      `INSERT INTO database_field_permissions (id, property_id, viewer_roles_json, editor_roles_json)
       SELECT ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM database_properties p
         JOIN databases d ON d.id = p.database_id
         WHERE p.id = ? AND p.database_id = ? AND d.workspace_id = ?
       )
       ON CONFLICT(property_id) DO UPDATE SET
         viewer_roles_json = excluded.viewer_roles_json,
         editor_roles_json = excluded.editor_roles_json,
         updated_at = datetime('now')`,
    )
    .bind(
      crypto.randomUUID(),
      propertyId,
      JSON.stringify(payload.viewerRoles),
      JSON.stringify(payload.editorRoles),
      propertyId,
      databaseId,
      workspaceId,
    )
    .run();
}

export async function insertActivityLog(
  db: D1Database,
  payload: { workspaceId: string; actorUserId: string; action: string; entityType: string; entityId: string; metadata?: unknown; audit?: boolean },
) {
  const values = [crypto.randomUUID(), payload.workspaceId, payload.actorUserId, payload.action, payload.entityType, payload.entityId, JSON.stringify(payload.metadata ?? {})] as const;
  await db
    .prepare(
      `INSERT INTO activity_logs (id, workspace_id, actor_user_id, action, entity_type, entity_id, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(...values)
    .run();
  if (payload.audit) {
    await db
      .prepare(
        `INSERT INTO audit_logs (id, workspace_id, actor_user_id, action, entity_type, entity_id, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), payload.workspaceId, payload.actorUserId, payload.action, payload.entityType, payload.entityId, JSON.stringify(payload.metadata ?? {}))
      .run();
  }
}

export async function listActivityLogs(db: D1Database, workspaceId: string, limit = 50) {
  const result = await db
    .prepare(
      `SELECT id, workspace_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
       FROM activity_logs
       WHERE workspace_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(workspaceId, limit)
    .all<FeedLogRow>();
  return result.results.map((row) => ({ ...row, metadata: parsePropertyConfig(row.metadata_json) }));
}

export async function listAuditLogs(db: D1Database, workspaceId: string, limit = 100) {
  const result = await db
    .prepare(
      `SELECT id, workspace_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at
       FROM audit_logs
       WHERE workspace_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(workspaceId, limit)
    .all<FeedLogRow>();
  return result.results.map((row) => ({ ...row, metadata: parsePropertyConfig(row.metadata_json) }));
}

export async function listComments(db: D1Database, workspaceId: string, target: { noteId?: string | null; databaseId?: string | null }) {
  const where = target.noteId ? "note_id = ?" : "database_id = ?";
  const targetId = target.noteId ?? target.databaseId ?? "";
  const result = await db
    .prepare(
      `SELECT id, workspace_id, note_id, database_id, body, mentions_json, created_by_user_id, resolved_at, created_at, updated_at
       FROM comments
       WHERE workspace_id = ? AND ${where}
       ORDER BY created_at DESC`,
    )
    .bind(workspaceId, targetId)
    .all<CommentRow>();
  return result.results.map((row) => ({ ...row, mentions: parseStringArrayJson(row.mentions_json) }));
}

export async function insertComment(
  db: D1Database,
  payload: { id: string; workspaceId: string; noteId?: string | null; databaseId?: string | null; body: string; mentions: string[]; createdByUserId: string },
) {
  await db
    .prepare(
      `INSERT INTO comments (id, workspace_id, note_id, database_id, body, mentions_json, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(payload.id, payload.workspaceId, payload.noteId ?? null, payload.databaseId ?? null, payload.body, JSON.stringify(payload.mentions), payload.createdByUserId)
    .run();
}

export async function listSavedSearches(db: D1Database, workspaceId: string) {
  const result = await db
    .prepare(
      `SELECT id, workspace_id, name, query, filters_json, created_by_user_id, created_at, updated_at
       FROM saved_searches
       WHERE workspace_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .bind(workspaceId)
    .all<SavedSearchRow>();
  return result.results.map((row) => ({ ...row, filters: parsePropertyConfig(row.filters_json) }));
}

export async function insertSavedSearch(
  db: D1Database,
  payload: { id: string; workspaceId: string; name: string; query: string; filtersJson: string; createdByUserId: string },
) {
  await db
    .prepare(
      `INSERT INTO saved_searches (id, workspace_id, name, query, filters_json, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(payload.id, payload.workspaceId, payload.name, payload.query, payload.filtersJson, payload.createdByUserId)
    .run();
}

export async function deleteSavedSearchById(db: D1Database, workspaceId: string, searchId: string) {
  await db.prepare(`DELETE FROM saved_searches WHERE workspace_id = ? AND id = ?`).bind(workspaceId, searchId).run();
}

export async function getKnowledgeDiagnostics(db: D1Database, workspaceId: string) {
  const orphanResult = await db
    .prepare(
      `SELECT n.id, n.title, n.updated_at
       FROM notes n
       WHERE n.workspace_id = ?
         AND n.deleted_at IS NULL
         AND n.archived_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM note_links l WHERE l.workspace_id = n.workspace_id AND l.source_note_id = n.id)
         AND NOT EXISTS (SELECT 1 FROM note_links l WHERE l.workspace_id = n.workspace_id AND l.target_note_id = n.id)
       ORDER BY n.updated_at DESC
       LIMIT 30`,
    )
    .bind(workspaceId)
    .all<{ id: string; title: string; updated_at: string }>();
  const duplicateResult = await db
    .prepare(
      `SELECT lower(trim(title)) AS title, COUNT(*) AS count
       FROM notes
       WHERE workspace_id = ? AND deleted_at IS NULL AND archived_at IS NULL AND trim(title) <> ''
       GROUP BY lower(trim(title))
       HAVING COUNT(*) > 1
       ORDER BY count DESC
       LIMIT 30`,
    )
    .bind(workspaceId)
    .all<{ title: string; count: number }>();
  const unorganizedResult = await db
    .prepare(
      `SELECT id, title, updated_at
       FROM notes
       WHERE workspace_id = ?
         AND deleted_at IS NULL
         AND archived_at IS NULL
         AND folder_id IS NULL
         AND database_id IS NULL
         AND is_daily = 0
       ORDER BY updated_at DESC
       LIMIT 30`,
    )
    .bind(workspaceId)
    .all<{ id: string; title: string; updated_at: string }>();
  return {
    orphan_notes: orphanResult.results,
    duplicate_titles: duplicateResult.results,
    unorganized_notes: unorganizedResult.results,
  };
}

export async function softDeleteNoteById(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  await db
    .prepare(
      `UPDATE notes
       SET deleted_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(noteId, workspaceId)
    .run();
}

export async function restoreNoteById(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  await db
    .prepare(
      `UPDATE notes
       SET deleted_at = NULL, updated_at = datetime('now')
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NOT NULL`,
    )
    .bind(noteId, workspaceId)
    .run();
}

export async function permanentlyDeleteNoteById(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  await db
    .prepare(`DELETE FROM notes WHERE id = ? AND workspace_id = ?`)
    .bind(noteId, workspaceId)
    .run();
}

export async function emptyTrash(db: D1Database, userId: string, workspaceId: string) {
  await db
    .prepare(`DELETE FROM notes WHERE workspace_id = ? AND deleted_at IS NOT NULL`)
    .bind(workspaceId)
    .run();
}

export async function archiveNoteById(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  await db
    .prepare(
      `UPDATE notes
       SET archived_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(noteId, workspaceId)
    .run();
}

export async function unarchiveNoteById(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  await db
    .prepare(
      `UPDATE notes
       SET archived_at = NULL, updated_at = datetime('now')
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(noteId, workspaceId)
    .run();
}

export async function markNoteOpened(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  await db
    .prepare(
      `UPDATE notes
       SET last_opened_at = datetime('now')
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(noteId, workspaceId)
    .run();
}

export async function getDailyNoteByDate(
  db: D1Database,
  userId: string,
  workspaceId: string,
  dailyDate: string,
) {
  const result = await listNotes(db, userId, workspaceId, {
    page: 1,
    pageSize: 1,
    daily: true,
    dailyDate,
  });
  return result.items[0] ?? null;
}

export async function findNoteByTitle(
  db: D1Database,
  userId: string,
  workspaceId: string,
  title: string,
) {
  const row = await db
    .prepare(
      `SELECT
         n.id, n.user_id, n.folder_id, f.name AS folder_name,
         n.title, n.content, n.is_favorite, n.is_pinned, n.is_daily, n.daily_date,
         n.created_at, n.updated_at, n.deleted_at, n.archived_at, n.last_opened_at
       FROM notes n
       LEFT JOIN folders f ON f.id = n.folder_id AND f.workspace_id = n.workspace_id
       WHERE n.workspace_id = ? AND n.deleted_at IS NULL AND lower(n.title) = lower(?)
       ORDER BY n.updated_at DESC
       LIMIT 1`,
    )
    .bind(workspaceId, title)
    .first<NoteRow>();
  if (!row) return null;
  const tagMap = await getTagsByNoteIds(db, userId, workspaceId, [row.id]);
  return normalizeNote(row, tagMap.get(row.id) ?? []);
}

export async function rebuildNoteLinks(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
  targetTitles: string[],
) {
  const uniqueTitles = Array.from(
    new Set(targetTitles.map((title) => title.trim()).filter(Boolean)),
  ).slice(0, 80);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(`DELETE FROM note_links WHERE workspace_id = ? AND source_note_id = ?`)
      .bind(workspaceId, noteId),
  ];

  for (const targetTitle of uniqueTitles) {
    const target = await findNoteByTitle(db, userId, workspaceId, targetTitle);
    statements.push(
      db
        .prepare(
          `INSERT INTO note_links (id, user_id, workspace_id, source_note_id, target_note_id, target_title)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), userId, workspaceId, noteId, target?.id ?? null, targetTitle),
    );
  }

  await db.batch(statements);
}

export async function listNoteLinks(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const result = await db
    .prepare(
      `SELECT
         nl.id, nl.user_id, nl.source_note_id, nl.target_note_id, nl.target_title, nl.created_at,
         target.title AS target_note_title
       FROM note_links nl
       LEFT JOIN notes target
         ON target.id = nl.target_note_id
        AND target.workspace_id = nl.workspace_id
        AND target.deleted_at IS NULL
       WHERE nl.workspace_id = ? AND nl.source_note_id = ?
       ORDER BY nl.target_title COLLATE NOCASE ASC`,
    )
    .bind(workspaceId, noteId)
    .all<NoteLinkRow>();
  return result.results;
}

export async function listBacklinks(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId);
  if (!note) return [];
  const result = await db
    .prepare(
      `SELECT
         nl.id, nl.user_id, nl.source_note_id, nl.target_note_id, nl.target_title, nl.created_at,
         source.title AS source_title
       FROM note_links nl
       JOIN notes source
         ON source.id = nl.source_note_id
        AND source.workspace_id = nl.workspace_id
        AND source.deleted_at IS NULL
       WHERE nl.workspace_id = ?
         AND (nl.target_note_id = ? OR lower(nl.target_title) = lower(?))
       ORDER BY source.updated_at DESC`,
    )
    .bind(workspaceId, noteId, note.title)
    .all<NoteLinkRow>();
  return result.results;
}

export async function getGraphData(
  db: D1Database,
  userId: string,
  workspaceId: string,
  centerNoteId?: string,
  databaseId?: string | null,
) {
  const databaseFilter = databaseId ? "AND source.database_id = ?" : "";
  const result = await db
    .prepare(
      `SELECT
         nl.source_note_id AS source,
         COALESCE(nl.target_note_id, nl.target_title) AS target,
         nl.target_title,
         source.title AS source_title,
         target.title AS target_note_title
       FROM note_links nl
       JOIN notes source
         ON source.id = nl.source_note_id
        AND source.workspace_id = nl.workspace_id
        AND source.deleted_at IS NULL
       LEFT JOIN notes target
         ON target.id = nl.target_note_id
        AND target.workspace_id = nl.workspace_id
        AND target.deleted_at IS NULL
       WHERE nl.workspace_id = ?
         ${centerNoteId ? "AND (nl.source_note_id = ? OR nl.target_note_id = ?)" : ""}
         ${databaseFilter}
       ORDER BY source.updated_at DESC
       LIMIT 120`,
    )
    .bind(...(centerNoteId ? [workspaceId, centerNoteId, centerNoteId, ...(databaseId ? [databaseId] : [])] : [workspaceId, ...(databaseId ? [databaseId] : [])]))
    .all<{
      source: string;
      target: string;
      target_title: string;
      source_title: string;
      target_note_title: string | null;
    }>();

  const nodes = new Map<string, GraphNodeRow>();
  const edges: GraphEdgeRow[] = [];
  for (const row of result.results) {
    nodes.set(row.source, {
      id: row.source,
      title: row.source_title,
      is_current: row.source === centerNoteId,
    });
    nodes.set(row.target, {
      id: row.target,
      title: row.target_note_title ?? row.target_title,
      is_current: row.target === centerNoteId,
    });
    edges.push({ source: row.source, target: row.target, target_title: row.target_title });
  }
  return { nodes: Array.from(nodes.values()), edges };
}

export async function listFolders(db: D1Database, userId: string, workspaceId: string) {
  const result = await db
    .prepare(
      `SELECT f.id, f.user_id, f.name, f.created_at, f.updated_at,
              COUNT(n.id) AS note_count
       FROM folders f
       LEFT JOIN notes n
         ON n.folder_id = f.id
        AND n.workspace_id = f.workspace_id
        AND n.deleted_at IS NULL
        AND n.archived_at IS NULL
       WHERE f.workspace_id = ?
       GROUP BY f.id
       ORDER BY f.name COLLATE NOCASE ASC`,
    )
    .bind(workspaceId)
    .all<FolderRow>();
  return result.results;
}

export async function getFolderById(db: D1Database, userId: string, workspaceId: string, folderId: string) {
  return db
    .prepare(
      `SELECT id, user_id, workspace_id, name, created_at, updated_at
       FROM folders
       WHERE id = ? AND workspace_id = ?`,
    )
    .bind(folderId, workspaceId)
    .first<FolderRow>();
}

export async function insertFolder(
  db: D1Database,
  userId: string,
  workspaceId: string,
  folder: { id: string; name: string },
) {
  await db
    .prepare(
      `INSERT INTO folders (id, user_id, workspace_id, name)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(folder.id, userId, workspaceId, folder.name)
    .run();
}

export async function updateFolderById(
  db: D1Database,
  userId: string,
  workspaceId: string,
  folderId: string,
  name: string,
) {
  await db
    .prepare(
      `UPDATE folders
       SET name = ?, updated_at = datetime('now')
       WHERE id = ? AND workspace_id = ?`,
    )
    .bind(name, folderId, workspaceId)
    .run();
}

export async function deleteFolderById(
  db: D1Database,
  userId: string,
  workspaceId: string,
  folderId: string,
) {
  await db.batch([
    db
      .prepare(
        `UPDATE notes
         SET folder_id = NULL, updated_at = datetime('now')
         WHERE folder_id = ? AND workspace_id = ?`,
      )
      .bind(folderId, workspaceId),
    db
      .prepare(`DELETE FROM folders WHERE id = ? AND workspace_id = ?`)
      .bind(folderId, workspaceId),
  ]);
}

export async function listTags(db: D1Database, userId: string, workspaceId: string) {
  const result = await db
    .prepare(
      `SELECT id, user_id, workspace_id, name, color, created_at, updated_at
       FROM tags
       WHERE workspace_id = ?
       ORDER BY name COLLATE NOCASE ASC`,
    )
    .bind(workspaceId)
    .all<TagRow>();
  return result.results.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export async function insertTag(
  db: D1Database,
  userId: string,
  workspaceId: string,
  tag: { id: string; name: string; color: string },
) {
  await db
    .prepare(
      `INSERT INTO tags (id, user_id, workspace_id, name, color)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(tag.id, userId, workspaceId, tag.name, tag.color)
    .run();
}

export async function replaceNoteTags(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
  tagIds: string[],
) {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `DELETE FROM note_tags
         WHERE note_id = ?
           AND EXISTS (SELECT 1 FROM notes WHERE id = ? AND workspace_id = ?)`,
      )
      .bind(noteId, noteId, workspaceId),
  ];

  for (const tagId of tagIds) {
    statements.push(
      db
        .prepare(
          `INSERT INTO note_tags (note_id, tag_id)
           SELECT ?, ?
           WHERE EXISTS (
             SELECT 1 FROM notes
             WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
           )
           AND EXISTS (
             SELECT 1 FROM tags
             WHERE id = ? AND workspace_id = ?
           )`,
        )
        .bind(noteId, tagId, noteId, workspaceId, tagId, workspaceId),
    );
  }

  await db.batch(statements);
  await db
    .prepare(
      `UPDATE notes
       SET updated_at = datetime('now')
       WHERE id = ? AND workspace_id = ?`,
    )
    .bind(noteId, workspaceId)
    .run();
}

export async function insertNoteVersion(
  db: D1Database,
  payload: {
    id: string;
    noteId: string;
    userId: string;
    workspaceId: string;
    title: string;
    content: string;
  },
) {
  await db
    .prepare(
      `INSERT INTO note_versions (id, note_id, user_id, workspace_id, title, content)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(payload.id, payload.noteId, payload.userId, payload.workspaceId, payload.title, payload.content)
    .run();
}

export async function getLatestNoteVersion(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  return db
    .prepare(
      `SELECT id, note_id, user_id, workspace_id, title, content, created_at
       FROM note_versions
       WHERE note_id = ? AND workspace_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(noteId, workspaceId)
    .first<NoteVersionRow>();
}

export async function listNoteVersions(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const result = await db
    .prepare(
      `SELECT id, note_id, user_id, workspace_id, title, content, created_at
       FROM note_versions
       WHERE note_id = ? AND workspace_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(noteId, workspaceId)
    .all<NoteVersionRow>();
  return result.results;
}

export async function getNoteVersionById(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
  versionId: string,
) {
  return db
    .prepare(
      `SELECT id, note_id, user_id, workspace_id, title, content, created_at
       FROM note_versions
       WHERE note_id = ? AND workspace_id = ? AND id = ?`,
    )
    .bind(noteId, workspaceId, versionId)
    .first<NoteVersionRow>();
}

export async function listReminders(
  db: D1Database,
  userId: string,
  workspaceId: string,
  options?: { dueOnly?: boolean; includeCompleted?: boolean },
) {
  const where = ["r.user_id = ?", "r.workspace_id = ?"];
  const bindings: unknown[] = [userId, workspaceId];
  if (!options?.includeCompleted) where.push("r.completed_at IS NULL");
  if (options?.dueOnly) where.push("r.due_at <= datetime('now')");
  const result = await db
    .prepare(
      `SELECT
         r.id, r.user_id, r.workspace_id, r.note_id, r.title, r.description,
         r.due_at, r.completed_at, r.notified_at, r.created_at, r.updated_at,
         n.title AS note_title
       FROM reminders r
       LEFT JOIN notes n
         ON n.id = r.note_id
        AND n.workspace_id = r.workspace_id
       WHERE ${where.join(" AND ")}
       ORDER BY
         CASE WHEN r.completed_at IS NULL THEN 0 ELSE 1 END,
         r.due_at ASC,
         r.created_at DESC`,
    )
    .bind(...bindings)
    .all<ReminderRow>();
  return result.results;
}

export async function getReminderById(
  db: D1Database,
  userId: string,
  workspaceId: string,
  reminderId: string,
) {
  return db
    .prepare(
      `SELECT
         r.id, r.user_id, r.workspace_id, r.note_id, r.title, r.description,
         r.due_at, r.completed_at, r.notified_at, r.created_at, r.updated_at,
         n.title AS note_title
       FROM reminders r
       LEFT JOIN notes n
         ON n.id = r.note_id
        AND n.workspace_id = r.workspace_id
       WHERE r.id = ? AND r.user_id = ? AND r.workspace_id = ?`,
    )
    .bind(reminderId, userId, workspaceId)
    .first<ReminderRow>();
}

export async function insertReminder(
  db: D1Database,
  payload: {
    id: string;
    userId: string;
    workspaceId: string;
    noteId?: string | null;
    title: string;
    description: string;
    dueAt: string;
  },
) {
  await db
    .prepare(
      `INSERT INTO reminders (id, user_id, workspace_id, note_id, title, description, due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      payload.id,
      payload.userId,
      payload.workspaceId,
      payload.noteId ?? null,
      payload.title,
      payload.description,
      payload.dueAt,
    )
    .run();
}

export async function updateReminderById(
  db: D1Database,
  userId: string,
  workspaceId: string,
  reminderId: string,
  payload: { noteId?: string | null; title?: string; description?: string; dueAt?: string; completedAt?: string | null; notifiedAt?: string | null },
) {
  const fields: string[] = [];
  const bindings: unknown[] = [];
  if (payload.noteId !== undefined) {
    fields.push("note_id = ?");
    bindings.push(payload.noteId);
  }
  if (payload.title !== undefined) {
    fields.push("title = ?");
    bindings.push(payload.title);
  }
  if (payload.description !== undefined) {
    fields.push("description = ?");
    bindings.push(payload.description);
  }
  if (payload.dueAt !== undefined) {
    fields.push("due_at = ?");
    bindings.push(payload.dueAt);
  }
  if (payload.completedAt !== undefined) {
    fields.push("completed_at = ?");
    bindings.push(payload.completedAt);
  }
  if (payload.notifiedAt !== undefined) {
    fields.push("notified_at = ?");
    bindings.push(payload.notifiedAt);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  await db
    .prepare(
      `UPDATE reminders
       SET ${fields.join(", ")}
       WHERE id = ? AND user_id = ? AND workspace_id = ?`,
    )
    .bind(...bindings, reminderId, userId, workspaceId)
    .run();
}

export async function deleteReminderById(
  db: D1Database,
  userId: string,
  workspaceId: string,
  reminderId: string,
) {
  await db
    .prepare(`DELETE FROM reminders WHERE id = ? AND user_id = ? AND workspace_id = ?`)
    .bind(reminderId, userId, workspaceId)
    .run();
}

export async function listDueRemindersForNotification(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT
         r.id, r.user_id, r.workspace_id, r.note_id, r.title, r.description,
         r.due_at, r.completed_at, r.notified_at, r.created_at, r.updated_at,
         n.title AS note_title
       FROM reminders r
       LEFT JOIN notes n ON n.id = r.note_id
       WHERE r.completed_at IS NULL
         AND r.notified_at IS NULL
         AND r.due_at <= datetime('now')
       ORDER BY r.due_at ASC
       LIMIT 100`,
    )
    .all<ReminderRow>();
  return result.results;
}

export async function getWorkspaceMember(
  db: D1Database,
  workspaceId: string,
  userId: string,
) {
  return db
    .prepare(
      `SELECT id, workspace_id, user_id, role, created_at, updated_at
       FROM workspace_members
       WHERE workspace_id = ? AND user_id = ?`,
    )
    .bind(workspaceId, userId)
    .first<WorkspaceMemberRow>();
}

export async function listWorkspaceMembers(
  db: D1Database,
  workspaceId: string,
) {
  const result = await db
    .prepare(
      `SELECT wm.id, wm.workspace_id, wm.user_id, wm.role, wm.created_at, wm.updated_at,
              u.email, u.display_name, u.avatar_url
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = ?
       ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, wm.created_at ASC`,
    )
    .bind(workspaceId)
    .all<WorkspaceMemberRow & { email: string; display_name: string | null; avatar_url: string | null }>();
  return result.results;
}

export async function createWorkspace(
  db: D1Database,
  payload: { id: string; name: string; ownerUserId: string },
) {
  await db.batch([
    db
      .prepare(
        `INSERT INTO workspaces (id, name, owner_user_id)
         VALUES (?, ?, ?)`,
      )
      .bind(payload.id, payload.name, payload.ownerUserId),
    db
      .prepare(
        `INSERT INTO workspace_members (id, workspace_id, user_id, role)
         VALUES (?, ?, ?, 'owner')`,
      )
      .bind(crypto.randomUUID(), payload.id, payload.ownerUserId),
  ]);
  return getWorkspaceById(db, payload.id);
}

export async function addWorkspaceMember(
  db: D1Database,
  payload: { workspaceId: string; userId: string; role: "owner" | "editor" | "viewer" },
) {
  await db
    .prepare(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, user_id)
       DO UPDATE SET role = excluded.role, updated_at = datetime('now')`,
    )
    .bind(crypto.randomUUID(), payload.workspaceId, payload.userId, payload.role)
    .run();
}

export async function createWorkspaceInvite(
  db: D1Database,
  payload: {
    id: string;
    workspaceId: string;
    email: string;
    role: "editor" | "viewer";
    noteId?: string | null;
    inviteTokenHash: string;
    invitedByUserId: string;
    expiresAt: string;
  },
) {
  await db
    .prepare(
      `INSERT INTO workspace_invites (
         id, workspace_id, email, role, note_id, invite_token_hash, invited_by_user_id, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, email)
       DO UPDATE SET
         role = excluded.role,
         note_id = excluded.note_id,
         invite_token_hash = excluded.invite_token_hash,
         invited_by_user_id = excluded.invited_by_user_id,
         expires_at = excluded.expires_at,
         accepted_at = NULL,
         updated_at = datetime('now')`,
    )
    .bind(
      payload.id,
      payload.workspaceId,
      payload.email.toLowerCase(),
      payload.role,
      payload.noteId ?? null,
      payload.inviteTokenHash,
      payload.invitedByUserId,
      payload.expiresAt,
    )
    .run();
}

export async function getWorkspaceInviteByTokenHash(db: D1Database, tokenHash: string) {
  return db
    .prepare(
      `SELECT id, workspace_id, email, role, note_id, invite_token_hash, invited_by_user_id, expires_at, accepted_at, created_at, updated_at
       FROM workspace_invites
       WHERE invite_token_hash = ?`,
    )
    .bind(tokenHash)
    .first<WorkspaceInviteRow>();
}

export async function getWorkspaceInvitePreviewByTokenHash(db: D1Database, tokenHash: string) {
  return db
    .prepare(
      `SELECT
         wi.workspace_id,
         w.name AS workspace_name,
         wi.email,
         wi.role,
         wi.note_id,
         wi.expires_at,
         wi.accepted_at,
         u.display_name AS inviter_display_name,
         u.email AS inviter_email,
         n.title AS note_title
       FROM workspace_invites wi
       JOIN workspaces w ON w.id = wi.workspace_id
       JOIN users u ON u.id = wi.invited_by_user_id
       LEFT JOIN notes n ON n.id = wi.note_id
       WHERE wi.invite_token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{
      workspace_id: string;
      workspace_name: string;
      email: string;
      role: "editor" | "viewer";
      note_id: string | null;
      expires_at: string;
      accepted_at: string | null;
      inviter_display_name: string | null;
      inviter_email: string;
      note_title: string | null;
    }>();
}

export async function markWorkspaceInviteAccepted(db: D1Database, inviteId: string) {
  await db
    .prepare(
      `UPDATE workspace_invites
       SET accepted_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(inviteId)
    .run();
}

export async function insertNoteAttachment(
  db: D1Database,
  payload: {
    id: string;
    noteId: string;
    workspaceId: string;
    uploaderId: string;
    storageKey: string;
    fileName: string;
    mimeType: string;
    size: number;
  },
) {
  await db
    .prepare(
      `INSERT INTO note_attachments (
         id, note_id, workspace_id, uploader_id, storage_key, file_name, mime_type, size
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      payload.id,
      payload.noteId,
      payload.workspaceId,
      payload.uploaderId,
      payload.storageKey,
      payload.fileName,
      payload.mimeType,
      payload.size,
    )
    .run();
}

export async function getActivePublicShareByNoteId(
  db: D1Database,
  workspaceId: string,
  noteId: string,
) {
  return db
    .prepare(
      `SELECT id, note_id, workspace_id, creator_user_id, access_mode, access_token_hash, expires_at, revoked_at, created_at, updated_at
       FROM note_public_shares
       WHERE workspace_id = ? AND note_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(workspaceId, noteId)
    .first<NotePublicShareRow>();
}

export async function revokePublicSharesByNoteId(
  db: D1Database,
  workspaceId: string,
  noteId: string,
) {
  await db
    .prepare(
      `UPDATE note_public_shares
       SET revoked_at = datetime('now'), updated_at = datetime('now')
       WHERE workspace_id = ? AND note_id = ? AND revoked_at IS NULL`,
    )
    .bind(workspaceId, noteId)
    .run();
}

export async function createPublicNoteShare(
  db: D1Database,
  payload: {
    id: string;
    noteId: string;
    workspaceId: string;
    creatorUserId: string;
    accessMode: "read";
    accessTokenHash: string;
    passwordHash?: string | null;
    expiresAt?: string | null;
  },
) {
  await db
    .prepare(
      `INSERT INTO note_public_shares (id, note_id, workspace_id, creator_user_id, access_mode, access_token_hash, password_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(payload.id, payload.noteId, payload.workspaceId, payload.creatorUserId, payload.accessMode, payload.accessTokenHash, payload.passwordHash ?? null, payload.expiresAt ?? null)
    .run();
}

export async function getPublicSharedNoteByTokenHash(
  db: D1Database,
  tokenHash: string,
) {
  return db
    .prepare(
      `SELECT
         s.note_id,
         s.access_mode,
         s.password_hash,
         s.created_at AS share_created_at,
         n.id,
         n.title,
         n.content,
         n.updated_at,
         n.created_at,
         w.name AS workspace_name,
         u.display_name AS shared_by_display_name,
         u.email AS shared_by_email
       FROM note_public_shares s
       JOIN notes n ON n.id = s.note_id
       JOIN workspaces w ON w.id = s.workspace_id
       JOIN users u ON u.id = s.creator_user_id
       WHERE s.access_token_hash = ?
         AND s.revoked_at IS NULL
         AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))
         AND n.deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{
      note_id: string;
      access_mode: "read";
      password_hash: string | null;
      share_created_at: string;
      id: string;
      title: string;
      content: string;
      updated_at: string;
      created_at: string;
      workspace_name: string;
      shared_by_display_name: string | null;
      shared_by_email: string;
    }>();
}

export async function getPublicShareSummaryByNoteId(
  db: D1Database,
  workspaceId: string,
  noteId: string,
) {
  return db
    .prepare(
      `SELECT id, note_id, workspace_id, creator_user_id, access_mode, access_token_hash, expires_at, revoked_at, created_at, updated_at
       FROM note_public_shares
       WHERE workspace_id = ? AND note_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(workspaceId, noteId)
    .first<NotePublicShareRow>();
}

export async function listNoteAttachments(
  db: D1Database,
  workspaceId: string,
  noteId: string,
) {
  const result = await db
    .prepare(
        `SELECT id, note_id, workspace_id, uploader_id, storage_key, file_name, mime_type, size, ocr_text, ocr_status, ocr_updated_at, created_at
         FROM note_attachments
         WHERE workspace_id = ? AND note_id = ?
         ORDER BY created_at DESC`,
    )
    .bind(workspaceId, noteId)
    .all<NoteAttachmentRow>();
  return result.results;
}

export async function getNoteAttachmentById(
  db: D1Database,
  workspaceId: string,
  attachmentId: string,
) {
  return db
    .prepare(
        `SELECT id, note_id, workspace_id, uploader_id, storage_key, file_name, mime_type, size, ocr_text, ocr_status, ocr_updated_at, created_at
         FROM note_attachments
         WHERE workspace_id = ? AND id = ?`,
    )
    .bind(workspaceId, attachmentId)
    .first<NoteAttachmentRow>();
}

export async function deleteNoteAttachmentById(
  db: D1Database,
  workspaceId: string,
  attachmentId: string,
) {
  await db
    .prepare(`DELETE FROM note_attachments WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, attachmentId)
    .run();
}
