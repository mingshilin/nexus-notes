import {
  assertBooleanOrUndefined,
  assertString,
  assertStringArray,
  HttpError,
  jsonSuccess,
  okMessage,
  parseJson,
} from "../http";
import {
  archiveNoteById,
  createPublicNoteShare,
  emptyTrash,
  findNoteByTitle,
  getDailyNoteByDate,
  getGraphData,
  getLatestNoteVersion,
  getNoteById,
  getPublicShareSummaryByNoteId,
  getPublicSharedNoteByTokenHash,
  getNoteVersionById,
  insertActivityLog,
  insertNote,
  insertNoteVersion,
  listBacklinks,
  listNoteLinks,
  listNoteVersions,
  listNotes,
  markNoteOpened,
  permanentlyDeleteNoteById,
  replaceNoteTags,
  rebuildNoteLinks,
  revokePublicSharesByNoteId,
  restoreNoteById,
  softDeleteNoteById,
  unarchiveNoteById,
  updateNoteById,
} from "../db/queries";
import { randomToken, sha256 } from "../auth";
import { assertDatabaseReadable, type WorkspaceRole } from "../permissions/databases";

interface CreateNoteBody {
  title?: string;
  content?: string;
  is_favorite?: boolean;
  folder_id?: string | null;
  database_id?: string | null;
  is_daily?: boolean;
  daily_date?: string | null;
}

interface UpdateNoteBody {
  title?: string;
  content?: string;
  is_favorite?: boolean;
  is_pinned?: boolean;
  folder_id?: string | null;
  database_id?: string | null;
}

interface UpdateNoteTagsBody {
  tagIds?: string[];
}

interface PublicShareBody {
  expires_in?: number | null;
  password?: string | null;
}

interface DatabaseReadFilterOptions {
  workspaceRole: WorkspaceRole;
}

function normalizeText(value: string | undefined) {
  return (value ?? "").trim();
}

const WIKI_LINK_PATTERN = /\[\[([^\]\n]{1,160})\]\]/g;
const DAILY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function extractWikiLinks(content: string) {
  const titles: string[] = [];
  for (const match of content.matchAll(WIKI_LINK_PATTERN)) {
    const title = match[1]?.trim();
    if (title) titles.push(title);
  }
  return titles;
}

async function rebuildLinksForContent(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
  content: string,
) {
  await rebuildNoteLinks(db, userId, workspaceId, noteId, extractWikiLinks(content));
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function buildDailyTemplateContent(date: string) {
  return `# ${date}\n\n## 今日重点\n- \n\n## 时间线\n- \n\n## 回顾\n- `;
}

function shouldCreateVersion(
  previous: { title: string; content: string } | null,
  next: { title: string; content: string },
  lastVersionAt: string | null,
) {
  if (!previous) return true;
  if (previous.title !== next.title || previous.content !== next.content) {
    if (!lastVersionAt) return true;
    const elapsed = Date.now() - new Date(lastVersionAt).getTime();
    return elapsed >= 1000 * 60 * 5;
  }
  return false;
}

async function createVersionIfNeeded(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
  payload: { title: string; content: string },
) {
  const latest = await getLatestNoteVersion(db, userId, workspaceId, noteId);
  const should = shouldCreateVersion(
    latest ? { title: latest.title, content: latest.content } : null,
    payload,
    latest?.created_at ?? null,
  );
  if (!should) return;
  await insertNoteVersion(db, {
    id: crypto.randomUUID(),
    noteId,
    userId,
    workspaceId,
    title: payload.title,
    content: payload.content,
  });
}

export async function handleListNotes(
  db: D1Database,
  userId: string,
  workspaceId: string,
  request: Request,
  access?: DatabaseReadFilterOptions,
) {
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "30");
  const q = url.searchParams.get("q") ?? undefined;
  const tag = url.searchParams.get("tag") ?? undefined;
  const folder = url.searchParams.has("folder") ? url.searchParams.get("folder") : undefined;
  const favoriteRaw = url.searchParams.get("favorite");
  const favorite =
    favoriteRaw === null ? undefined : favoriteRaw.toLowerCase() === "true";
  const pinnedRaw = url.searchParams.get("pinned");
  const pinned = pinnedRaw === null ? undefined : pinnedRaw.toLowerCase() === "true";
  const archivedRaw = url.searchParams.get("archived");
  const archived = archivedRaw === null ? undefined : archivedRaw.toLowerCase() === "true";
  const deletedModeParam = url.searchParams.get("deletedMode");
  const includeDeleted = url.searchParams.get("deleted") === "true";
  const deletedMode = deletedModeParam === "include" || deletedModeParam === "only" || deletedModeParam === "exclude"
    ? deletedModeParam
    : includeDeleted
      ? "only"
      : "exclude";
  const recent = url.searchParams.get("recent") === "true";
  const databaseId = url.searchParams.has("databaseId") ? url.searchParams.get("databaseId") : undefined;

  const result = await listNotes(db, userId, workspaceId, {
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 30,
    q,
    tag,
    folderId: folder,
    favorite,
    pinned,
    archived,
    recent,
    databaseId,
    deletedMode,
  });
  const items = access
    ? (await Promise.all(result.items.map(async (note) => {
        if (!note.database_id || access.workspaceRole === "owner") return note;
        try {
          await assertDatabaseReadable({
            db,
            workspaceId,
            databaseId: note.database_id,
            userId,
            workspaceRole: access.workspaceRole,
          });
          return note;
        } catch (error) {
          if (error instanceof HttpError && (error.status === 403 || error.status === 404)) return null;
          throw error;
        }
      }))).filter((note): note is (typeof result.items)[number] => Boolean(note))
    : result.items;

  return jsonSuccess(items, undefined, {
    page: result.page,
    pageSize: result.pageSize,
    total: items.length === result.items.length ? result.total : items.length,
  });
}

export async function handleListTrash(
  db: D1Database,
  userId: string,
  workspaceId: string,
  request: Request,
) {
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "30");
  const q = url.searchParams.get("q") ?? undefined;

  const result = await listNotes(db, userId, workspaceId, {
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 30,
    q,
    deletedMode: "only",
  });

  return jsonSuccess(result.items, undefined, {
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
  });
}

export async function handleCreateNote(
  db: D1Database,
  userId: string,
  workspaceId: string,
  request: Request,
) {
  const body = await parseJson<CreateNoteBody>(request);
  const title = normalizeText(body.title);
  const content = body.content ?? "";
  const isFavorite = assertBooleanOrUndefined(body.is_favorite, "is_favorite") ?? false;
  const isDaily = assertBooleanOrUndefined(body.is_daily, "is_daily") ?? false;
  const dailyDate =
    body.daily_date === undefined || body.daily_date === null
      ? null
      : assertString(body.daily_date, "daily_date", { allowEmpty: false });
  const folderId =
    body.folder_id === undefined || body.folder_id === null
      ? null
      : assertString(body.folder_id, "folder_id", { allowEmpty: true }) || null;
  const databaseId =
    body.database_id === undefined || body.database_id === null
      ? null
      : assertString(body.database_id, "database_id", { allowEmpty: true }) || null;

  if (title.length > 160) {
    throw new HttpError(400, "VALIDATION_ERROR", "title length must be <= 160");
  }
  if (content.length > 200000) {
    throw new HttpError(400, "VALIDATION_ERROR", "content length must be <= 200000");
  }
  if (dailyDate && !DAILY_DATE_PATTERN.test(dailyDate)) {
    throw new HttpError(400, "VALIDATION_ERROR", "daily_date must be YYYY-MM-DD");
  }

  const id = crypto.randomUUID();
  await insertNote(db, userId, workspaceId, {
    id,
    title,
    content,
    isFavorite,
    folderId,
    databaseId,
    isDaily,
    dailyDate,
  });
  await createVersionIfNeeded(db, userId, workspaceId, id, { title, content });
  await rebuildLinksForContent(db, userId, workspaceId, id, content);
  const created = await getNoteById(db, userId, workspaceId, id);
  if (!created) throw new HttpError(500, "INTERNAL_ERROR", "failed to create note");
  return jsonSuccess(created, { status: 201 });
}

export async function handleGetNoteById(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  assertString(noteId, "id");
  const note = await getNoteById(db, userId, workspaceId, noteId);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  return jsonSuccess(note);
}

export async function handleUpdateNote(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
  request: Request,
) {
  assertString(noteId, "id");
  const body = await parseJson<UpdateNoteBody>(request);
  const title =
    body.title === undefined ? undefined : assertString(body.title, "title", { allowEmpty: true });
  const content =
    body.content === undefined
      ? undefined
      : assertString(body.content, "content", { allowEmpty: true });
  const isFavorite = assertBooleanOrUndefined(body.is_favorite, "is_favorite");
  const isPinned = assertBooleanOrUndefined(body.is_pinned, "is_pinned");
  const folderId =
    body.folder_id === undefined
      ? undefined
      : body.folder_id === null
        ? null
        : assertString(body.folder_id, "folder_id", { allowEmpty: true }) || null;
  const databaseId =
    body.database_id === undefined
      ? undefined
      : body.database_id === null
        ? null
        : assertString(body.database_id, "database_id", { allowEmpty: true }) || null;

  if (title !== undefined && title.length > 160) {
    throw new HttpError(400, "VALIDATION_ERROR", "title length must be <= 160");
  }
  if (content !== undefined && content.length > 200000) {
    throw new HttpError(400, "VALIDATION_ERROR", "content length must be <= 200000");
  }

  if (
    title === undefined &&
    content === undefined &&
    isFavorite === undefined &&
    isPinned === undefined &&
    folderId === undefined
    && databaseId === undefined
  ) {
    throw new HttpError(400, "VALIDATION_ERROR", "at least one field is required");
  }

  const before = await getNoteById(db, userId, workspaceId, noteId);
  if (!before) throw new HttpError(404, "NOT_FOUND", "note not found");

  await updateNoteById(db, userId, workspaceId, noteId, { title, content, isFavorite, isPinned, folderId, databaseId });
  const updated = await getNoteById(db, userId, workspaceId, noteId);
  if (!updated) throw new HttpError(404, "NOT_FOUND", "note not found");

  await createVersionIfNeeded(db, userId, workspaceId, noteId, {
    title: updated.title,
    content: updated.content,
  });
  await rebuildLinksForContent(db, userId, workspaceId, noteId, updated.content);

  return jsonSuccess(updated);
}

export async function handleInboxNotes(
  db: D1Database,
  userId: string,
  workspaceId: string,
  request: Request,
) {
  const url = new URL(request.url);
  url.searchParams.set("folder", "");
  url.searchParams.set("deleted", "false");
  return handleListNotes(db, userId, workspaceId, new Request(url.toString(), request));
}

export async function handleTodayDailyNote(
  db: D1Database,
  userId: string,
  workspaceId: string,
) {
  const date = todayString();
  const localizedTitle = `${date} 每日笔记`;
  const existing = await getDailyNoteByDate(db, userId, workspaceId, date);
  if (existing) {
    const legacyDailyTitle = `${date} Daily Note`;
    if (existing.title === legacyDailyTitle) {
      await updateNoteById(db, userId, workspaceId, existing.id, { title: localizedTitle });
      await createVersionIfNeeded(db, userId, workspaceId, existing.id, {
        title: localizedTitle,
        content: existing.content,
      });
      const renamed = await getNoteById(db, userId, workspaceId, existing.id);
      if (renamed) return jsonSuccess(renamed);
    }
    return jsonSuccess(existing);
  }

  const id = crypto.randomUUID();
  const title = localizedTitle;
  const content = buildDailyTemplateContent(date);
  await insertNote(db, userId, workspaceId, {
    id,
    title,
    content,
    isFavorite: false,
    folderId: null,
    isDaily: true,
    dailyDate: date,
  });
  await createVersionIfNeeded(db, userId, workspaceId, id, { title, content });
  const created = await getNoteById(db, userId, workspaceId, id);
  if (!created) throw new HttpError(500, "INTERNAL_ERROR", "failed to create daily note");
  return jsonSuccess(created, { status: 201 });
}

export async function handleListLinks(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  return jsonSuccess(await listNoteLinks(db, userId, workspaceId, noteId));
}

export async function handleListBacklinks(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  return jsonSuccess(await listBacklinks(db, userId, workspaceId, noteId));
}

export async function handleGraph(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId?: string,
) {
  if (noteId) {
    const note = await getNoteById(db, userId, workspaceId, noteId);
    if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  }
  return jsonSuccess(await getGraphData(db, userId, workspaceId, noteId));
}

export async function handleRebuildLinks(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  await rebuildLinksForContent(db, userId, workspaceId, noteId, note.content);
  return jsonSuccess(await listNoteLinks(db, userId, workspaceId, noteId));
}

export async function handleOpenOrCreateWikiLink(
  db: D1Database,
  userId: string,
  workspaceId: string,
  title: string,
) {
  const normalized = normalizeText(title);
  if (!normalized) throw new HttpError(400, "VALIDATION_ERROR", "title is required");
  const existing = await findNoteByTitle(db, userId, workspaceId, normalized);
  if (existing) return jsonSuccess(existing);
  const id = crypto.randomUUID();
  await insertNote(db, userId, workspaceId, {
    id,
    title: normalized,
    content: "",
    isFavorite: false,
    folderId: null,
  });
  const created = await getNoteById(db, userId, workspaceId, id);
  if (!created) throw new HttpError(500, "INTERNAL_ERROR", "failed to create note");
  return jsonSuccess(created, { status: 201 });
}

export async function handleDeleteNote(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  await softDeleteNoteById(db, userId, workspaceId, noteId);
  return okMessage(noteId);
}

export async function handleArchiveNote(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  await archiveNoteById(db, userId, workspaceId, noteId);
  const updated = await getNoteById(db, userId, workspaceId, noteId, true);
  if (!updated) throw new HttpError(500, "INTERNAL_ERROR", "failed to archive note");
  return jsonSuccess(updated);
}

export async function handleUnarchiveNote(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId, true);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  await unarchiveNoteById(db, userId, workspaceId, noteId);
  const updated = await getNoteById(db, userId, workspaceId, noteId, true);
  if (!updated) throw new HttpError(500, "INTERNAL_ERROR", "failed to unarchive note");
  return jsonSuccess(updated);
}

export async function handleOpenNote(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId, true);
  if (!note || note.deleted_at) throw new HttpError(404, "NOT_FOUND", "note not found");
  await markNoteOpened(db, userId, workspaceId, noteId);
  return jsonSuccess({ id: noteId });
}

export async function handleRestoreNote(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId, true);
  if (!note || !note.deleted_at) throw new HttpError(404, "NOT_FOUND", "trashed note not found");
  await restoreNoteById(db, userId, workspaceId, noteId);
  const restored = await getNoteById(db, userId, workspaceId, noteId);
  if (!restored) throw new HttpError(500, "INTERNAL_ERROR", "failed to restore note");
  return jsonSuccess(restored);
}

export async function handlePermanentDeleteNote(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId, true);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  await permanentlyDeleteNoteById(db, userId, workspaceId, noteId);
  return okMessage(noteId);
}

export async function handleEmptyTrash(db: D1Database, userId: string, workspaceId: string) {
  await emptyTrash(db, userId, workspaceId);
  return jsonSuccess({ cleared: true });
}

export async function handleUpdateNoteTags(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
  request: Request,
) {
  const body = await parseJson<UpdateNoteTagsBody>(request);
  const tagIds = assertStringArray(body.tagIds ?? [], "tagIds");
  await replaceNoteTags(db, userId, workspaceId, noteId, tagIds);
  const updated = await getNoteById(db, userId, workspaceId, noteId);
  if (!updated) throw new HttpError(404, "NOT_FOUND", "note not found");
  return jsonSuccess(updated);
}

export async function handleListNoteVersions(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId, true);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  const versions = await listNoteVersions(db, userId, workspaceId, noteId);
  return jsonSuccess(versions);
}

export async function handleRestoreNoteVersion(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
  versionId: string,
) {
  const version = await getNoteVersionById(db, userId, workspaceId, noteId, versionId);
  if (!version) throw new HttpError(404, "NOT_FOUND", "version not found");
  await updateNoteById(db, userId, workspaceId, noteId, {
    title: version.title,
    content: version.content,
  });
  await createVersionIfNeeded(db, userId, workspaceId, noteId, {
    title: version.title,
    content: version.content,
  });
  const updated = await getNoteById(db, userId, workspaceId, noteId, true);
  if (!updated) throw new HttpError(500, "INTERNAL_ERROR", "failed to restore version");
  return jsonSuccess(updated);
}

export async function handleCreatePublicNoteShare(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
  request: Request,
  appBaseUrl?: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId, true);
  if (!note || note.deleted_at) throw new HttpError(404, "NOT_FOUND", "note not found");
  await revokePublicSharesByNoteId(db, workspaceId, noteId);
  const body = await parseJson<PublicShareBody>(request).catch(() => ({} as PublicShareBody));
  const expiresIn = body.expires_in ?? null;
  const password = body.password === undefined || body.password === null ? "" : assertString(body.password, "password", { allowEmpty: true, max: 120 }).trim();
  if (expiresIn !== null && (!Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 60 * 60 * 24 * 365)) {
    throw new HttpError(400, "VALIDATION_ERROR", "expires_in is invalid");
  }

  const token = randomToken(24);
  const tokenHash = await sha256(token);
  const passwordHash = password ? await sha256(password) : null;
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  await createPublicNoteShare(db, {
    id: crypto.randomUUID(),
    noteId,
    workspaceId,
    creatorUserId: userId,
    accessMode: "read",
    accessTokenHash: tokenHash,
    passwordHash,
    expiresAt,
  });
  await insertActivityLog(db, {
    workspaceId,
    actorUserId: userId,
    action: "share.create",
    entityType: "note",
    entityId: noteId,
    audit: true,
    metadata: { expires_at: expiresAt, password_protected: Boolean(password) },
  });
  const base = (appBaseUrl ?? "").replace(/\/$/, "");
  return jsonSuccess({
    note_id: noteId,
    access_mode: "read" as const,
    share_url: base ? `${base}/?share=${encodeURIComponent(token)}` : `?share=${encodeURIComponent(token)}`,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
  }, { status: 201 });
}

export async function handleRevokePublicNoteShare(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId, true);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  await revokePublicSharesByNoteId(db, workspaceId, noteId);
  await insertActivityLog(db, {
    workspaceId,
    actorUserId: userId,
    action: "share.revoke",
    entityType: "note",
    entityId: noteId,
    audit: true,
  });
  return jsonSuccess({ revoked: true as const });
}

export async function handleGetPublicNoteShareSummary(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId, true);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  const share = await getPublicShareSummaryByNoteId(db, workspaceId, noteId);
  return jsonSuccess({
    active: Boolean(share),
    expires_at: share?.expires_at ?? null,
  });
}

export async function handleGetPublicSharedNote(
  db: D1Database,
  token: string,
  password?: string | null,
) {
  if (!token) throw new HttpError(400, "VALIDATION_ERROR", "token is required");
  const tokenHash = await sha256(token);
  const shared = await getPublicSharedNoteByTokenHash(db, tokenHash);
  if (!shared) throw new HttpError(404, "NOT_FOUND", "shared note not found");
  if (shared.password_hash) {
    const providedHash = password ? await sha256(password) : "";
    if (providedHash !== shared.password_hash) {
      throw new HttpError(401, "SHARE_PASSWORD_REQUIRED", "share password is required");
    }
  }
  return jsonSuccess({
    note: {
      id: shared.id,
      title: shared.title,
      content: shared.content,
      updated_at: shared.updated_at,
      created_at: shared.created_at,
    },
    access_mode: shared.access_mode,
    workspace_name: shared.workspace_name,
    shared_by: shared.shared_by_display_name?.trim() || shared.shared_by_email,
    created_at: shared.share_created_at,
  });
}
