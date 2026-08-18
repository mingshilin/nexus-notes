import { HttpError, jsonSuccess, parseJson } from "../http";
import { getUserById, updateUserProfile } from "../db/queries";

interface UpdateProfileBody {
  display_name?: string;
  bio?: string;
  avatar_url?: string | null;
}

function sanitizeProfile(user: Awaited<ReturnType<typeof getUserById>>) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    bio: user.bio,
    avatar_url: user.avatar_url,
    email_verified_at: user.email_verified_at,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

export async function handleGetProfile(db: D1Database, userId: string) {
  const user = await getUserById(db, userId);
  if (!user) throw new HttpError(404, "NOT_FOUND", "user not found");
  return jsonSuccess(sanitizeProfile(user));
}

export async function handleUpdateProfile(db: D1Database, userId: string, request: Request) {
  const body = await parseJson<UpdateProfileBody>(request);
  const displayName = body.display_name?.trim();
  const bio = body.bio?.trim();

  if (displayName !== undefined && displayName.length > 80) {
    throw new HttpError(400, "VALIDATION_ERROR", "display_name length must be <= 80");
  }
  if (bio !== undefined && bio.length > 400) {
    throw new HttpError(400, "VALIDATION_ERROR", "bio length must be <= 400");
  }
  if (body.avatar_url !== undefined && body.avatar_url !== null && body.avatar_url.length > 500) {
    throw new HttpError(400, "VALIDATION_ERROR", "avatar_url length must be <= 500");
  }

  await updateUserProfile(db, userId, {
    displayName: displayName === undefined ? undefined : displayName || null,
    bio: bio === undefined ? undefined : bio,
    avatarUrl: body.avatar_url,
  });
  const updated = await getUserById(db, userId);
  if (!updated) throw new HttpError(404, "NOT_FOUND", "user not found");
  return jsonSuccess(sanitizeProfile(updated));
}
