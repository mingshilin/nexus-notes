import { assertString, HttpError, jsonSuccess, parseJson } from "../http";
import { insertTag, listTags } from "../db/queries";

interface CreateTagBody {
  name?: string;
  color?: string;
}

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export async function handleListTags(db: D1Database, userId: string, workspaceId: string) {
  const tags = await listTags(db, userId, workspaceId);
  return jsonSuccess(tags);
}

export async function handleCreateTag(
  db: D1Database,
  userId: string,
  workspaceId: string,
  request: Request,
) {
  const body = await parseJson<CreateTagBody>(request);
  const name = assertString(body.name, "name", { max: 36 }).trim();
  const color = body.color?.trim() || "#94A3B8";

  if (!HEX_COLOR_PATTERN.test(color)) {
    throw new HttpError(400, "VALIDATION_ERROR", "color must be #RRGGBB");
  }

  const id = crypto.randomUUID();
  try {
    await insertTag(db, userId, workspaceId, { id, name, color });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      throw new HttpError(409, "DUPLICATE_TAG", "tag already exists");
    }
    throw error;
  }

  const tags = await listTags(db, userId, workspaceId);
  const created = tags.find((tag) => tag.id === id);
  if (!created) throw new HttpError(500, "INTERNAL_ERROR", "failed to create tag");
  return jsonSuccess(created, { status: 201 });
}
