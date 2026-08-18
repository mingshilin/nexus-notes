import { HttpError } from "./http";
import {
  ensurePersonalWorkspaceForUser,
  getWorkspaceById,
  getWorkspaceMember,
  getSessionByTokenHash,
  getUserById,
  revokeSessionByTokenHash,
  type UserRow,
  type WorkspaceRow,
} from "./db/queries";

const SESSION_COOKIE = "mn_session";
const WORKSPACE_COOKIE = "mn_workspace";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_PBKDF2_ITERATIONS = 100000;

function base64urlToBytes(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomToken(size = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return bytesToBase64url(bytes);
}

export async function sha256(input: string) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToBase64url(new Uint8Array(digest));
}

export async function hashPassword(password: string) {
  const salt = randomToken(16);
  const saltBytes = base64urlToBytes(salt);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const iterations = PASSWORD_PBKDF2_ITERATIONS;
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations,
      salt: saltBytes,
    },
    keyMaterial,
    256,
  );
  const hash = bytesToBase64url(new Uint8Array(derivedBits));
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const parts = passwordHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isFinite(iterations)) return false;

  const saltBytes = base64urlToBytes(salt);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  try {
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations,
        salt: saltBytes,
      },
      keyMaterial,
      256,
    );
    const actual = bytesToBase64url(new Uint8Array(derivedBits));
    return actual === expected;
  } catch {
    return false;
  }
}

export function readSessionTokenFromCookie(cookieHeader: string | null) {
  if (!cookieHeader) return null;
  const items = cookieHeader.split(";").map((item) => item.trim());
  for (const item of items) {
    if (item.startsWith(`${SESSION_COOKIE}=`)) {
      return item.slice(`${SESSION_COOKIE}=`.length);
    }
  }
  return null;
}

function readCookieValue(cookieHeader: string | null, key: string) {
  if (!cookieHeader) return null;
  const items = cookieHeader.split(";").map((item) => item.trim());
  for (const item of items) {
    if (item.startsWith(`${key}=`)) {
      return item.slice(`${key}=`.length);
    }
  }
  return null;
}

export function buildSessionCookie(token: string, secure: boolean) {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function buildClearSessionCookie(secure: boolean) {
  const attributes = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function buildWorkspaceCookie(workspaceId: string, secure: boolean) {
  const attributes = [
    `${WORKSPACE_COOKIE}=${workspaceId}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function buildClearWorkspaceCookie(secure: boolean) {
  const attributes = [
    `${WORKSPACE_COOKIE}=`,
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export interface AuthContext {
  user: UserRow;
  workspace: WorkspaceRow;
  workspaceRole: "owner" | "editor" | "viewer";
  sessionToken: string;
  sessionTokenHash: string;
}

export async function requireAuth(
  db: D1Database,
  request: Request,
): Promise<AuthContext> {
  const token = readSessionTokenFromCookie(request.headers.get("cookie"));
  if (!token) throw new HttpError(401, "UNAUTHORIZED", "authentication required");

  const tokenHash = await sha256(token);
  const session = await getSessionByTokenHash(db, tokenHash);
  if (!session || session.revoked_at) {
    throw new HttpError(401, "UNAUTHORIZED", "invalid session");
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await revokeSessionByTokenHash(db, tokenHash);
    throw new HttpError(401, "SESSION_EXPIRED", "session expired");
  }

  const user = await getUserById(db, session.user_id);
  if (!user) throw new HttpError(401, "UNAUTHORIZED", "user not found");
  const ensuredWorkspace = await ensurePersonalWorkspaceForUser(db, user.id);

  const cookieWorkspaceId = readCookieValue(request.headers.get("cookie"), WORKSPACE_COOKIE);
  const headerWorkspaceId = request.headers.get("x-workspace-id");
  const requestedWorkspaceId = (headerWorkspaceId || cookieWorkspaceId || "").trim();

  if (requestedWorkspaceId) {
    const membership = await getWorkspaceMember(db, requestedWorkspaceId, user.id);
    if (membership) {
      const workspace = await getWorkspaceById(db, requestedWorkspaceId);
      if (workspace) {
        return {
          user,
          workspace,
          workspaceRole: membership.role,
          sessionToken: token,
          sessionTokenHash: tokenHash,
        };
      }
    }
  }

  const ensuredMembership = await getWorkspaceMember(db, ensuredWorkspace.id, user.id);
  return {
    user,
    workspace: ensuredWorkspace,
    workspaceRole: ensuredMembership?.role ?? "owner",
    sessionToken: token,
    sessionTokenHash: tokenHash,
  };
}
