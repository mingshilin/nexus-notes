import { assertString, HttpError, jsonSuccess, okMessage, parseJson } from "../http";
import {
  deleteFolderById,
  getFolderById,
  insertFolder,
  listFolders,
  updateFolderById,
} from "../db/queries";

interface FolderBody {
  name?: string;
}

function normalizeName(value: string | undefined) {
  const name = assertString(value, "name", { max: 48 }).trim();
  if (!name) throw new HttpError(400, "VALIDATION_ERROR", "folder name is required");
  return name;
}

function mapFolderError(error: unknown): never {
  if (error instanceof Error && error.message.includes("UNIQUE")) {
    throw new HttpError(409, "DUPLICATE_FOLDER", "folder already exists");
  }
  throw error;
}

export async function handleListFolders(db: D1Database, userId: string, workspaceId: string) {
  return jsonSuccess(await listFolders(db, userId, workspaceId));
}

export async function handleCreateFolder(
  db: D1Database,
  userId: string,
  workspaceId: string,
  request: Request,
) {
  const body = await parseJson<FolderBody>(request);
  const name = normalizeName(body.name);
  const id = crypto.randomUUID();
  try {
    await insertFolder(db, userId, workspaceId, { id, name });
  } catch (error) {
    mapFolderError(error);
  }
  const folder = await getFolderById(db, userId, workspaceId, id);
  if (!folder) throw new HttpError(500, "INTERNAL_ERROR", "failed to create folder");
  return jsonSuccess(folder, { status: 201 });
}

export async function handleUpdateFolder(
  db: D1Database,
  userId: string,
  workspaceId: string,
  folderId: string,
  request: Request,
) {
  const body = await parseJson<FolderBody>(request);
  const name = normalizeName(body.name);
  const folder = await getFolderById(db, userId, workspaceId, folderId);
  if (!folder) throw new HttpError(404, "NOT_FOUND", "folder not found");
  try {
    await updateFolderById(db, userId, workspaceId, folderId, name);
  } catch (error) {
    mapFolderError(error);
  }
  const updated = await getFolderById(db, userId, workspaceId, folderId);
  if (!updated) throw new HttpError(500, "INTERNAL_ERROR", "failed to update folder");
  return jsonSuccess(updated);
}

export async function handleDeleteFolder(
  db: D1Database,
  userId: string,
  workspaceId: string,
  folderId: string,
) {
  const folder = await getFolderById(db, userId, workspaceId, folderId);
  if (!folder) throw new HttpError(404, "NOT_FOUND", "folder not found");
  await deleteFolderById(db, userId, workspaceId, folderId);
  return okMessage(folderId);
}
