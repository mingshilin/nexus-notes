import {
  ChangePasswordInputSchema,
  ConfirmEmailChangeInputSchema,
  DeleteAccountInputSchema,
  RequestEmailChangeInputSchema,
  UpdateProfileInputSchema,
} from "@nexus/contracts";

import type { RouteDefinition } from "../http/route-registry";
import type { ProfileServiceApi } from "../profile/profile-service";
import { ProfileServiceError } from "../profile/profile-model";
import { expiredSessionCookie } from "./auth";

const avatarMaximumBytes = 2 * 1024 * 1024;
const standardRateLimit = { bucket: "ip", limit: 30, windowSeconds: 60 } as const;
const sensitiveRateLimit = { bucket: "ip", limit: 5, windowSeconds: 30 * 60 } as const;
const confirmationRateLimit = { bucket: "ip", limit: 10, windowSeconds: 30 * 60 } as const;

interface ProfileRegistry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

function currentSessionId(sessionId: string | undefined) {
  if (!sessionId) throw new ProfileServiceError("SESSION_INVALID", "Session is unavailable", 401);
  return sessionId;
}

async function readAvatar(request: Request, maximum = avatarMaximumBytes) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const normalized = contentLength.trim();
    if (!/^(0|[1-9]\d*)$/u.test(normalized) || !Number.isSafeInteger(Number(normalized))) {
      throw new ProfileServiceError("AVATAR_CONTENT_LENGTH_INVALID", "Content-Length must be a non-negative integer", 400);
    }
    if (Number(normalized) > maximum) {
      throw new ProfileServiceError("AVATAR_SIZE_INVALID", "Avatar exceeds 2 MiB", 413);
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel("Avatar exceeds 2 MiB").catch(() => undefined);
      throw new ProfileServiceError("AVATAR_SIZE_INVALID", "Avatar exceeds 2 MiB", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function registerProfileRoutes<TEnv>(
  registry: ProfileRegistry<TEnv>,
  createService: (env: TEnv) => ProfileServiceApi,
) {
  registry.register({
    method: "GET", path: "/api/v2/profile", auth: "session", rateLimit: standardRateLimit,
    handler: async ({ env, principal }) => ({ data: await createService(env).getProfile(principal!.userId) }),
  });
  registry.register({
    method: "PATCH", path: "/api/v2/profile", auth: "session", rateLimit: standardRateLimit, body: UpdateProfileInputSchema,
    handler: async ({ env, principal, body, requestId }) => ({ data: await createService(env).updateProfile(principal!.userId, body, requestId) }),
  });
  registry.register({
    method: "GET", path: "/api/v2/profile/avatar", auth: "session", rateLimit: standardRateLimit,
    handler: async ({ env, principal }) => {
      const avatar = await createService(env).getAvatar(principal!.userId);
      if (!avatar) throw new ProfileServiceError("AVATAR_NOT_FOUND", "Avatar is unavailable", 404);
      return new Response(avatar.body, {
        headers: {
          "cache-control": "private, no-store",
          "content-type": avatar.httpMetadata?.contentType ?? "application/octet-stream",
        },
      });
    },
  });
  registry.register({
    method: "POST", path: "/api/v2/profile/avatar", auth: "session", rateLimit: standardRateLimit,
    handler: async ({ request, env, principal, requestId }) => ({
      data: await createService(env).uploadAvatar(
        principal!.userId,
        request.headers.get("content-type")?.split(";", 1)[0]!.trim() ?? "",
        await readAvatar(request),
        requestId,
      ),
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/profile/avatar", auth: "session", rateLimit: standardRateLimit,
    handler: async ({ env, principal, requestId }) => ({ data: await createService(env).deleteAvatar(principal!.userId, requestId) }),
  });
  registry.register({
    method: "POST", path: "/api/v2/profile/email/change", auth: "session", rateLimit: sensitiveRateLimit, body: RequestEmailChangeInputSchema,
    handler: async ({ env, principal, body, requestId }) => ({ data: await createService(env).requestEmailChange(principal!.userId, body, requestId) }),
  });
  registry.register({
    method: "POST", path: "/api/v2/profile/email/confirm", auth: "session", rateLimit: confirmationRateLimit, body: ConfirmEmailChangeInputSchema,
    handler: async ({ env, principal, body, requestId }) => ({ data: await createService(env).confirmEmailChange(principal!.userId, body, requestId) }),
  });
  registry.register({
    method: "POST", path: "/api/v2/profile/password/change", auth: "session", rateLimit: sensitiveRateLimit, body: ChangePasswordInputSchema,
    handler: async ({ env, principal, body, requestId }) => ({
      data: await createService(env).changePassword(principal!.userId, currentSessionId(principal!.sessionId), body, requestId),
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/profile/sessions", auth: "session", rateLimit: standardRateLimit,
    handler: async ({ env, principal }) => ({
      data: { items: await createService(env).listSessions(principal!.userId, currentSessionId(principal!.sessionId)) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/profile/sessions/:sessionId", auth: "session", rateLimit: standardRateLimit,
    handler: async ({ env, principal, params, requestId }) => ({
      data: await createService(env).revokeSession(principal!.userId, currentSessionId(principal!.sessionId), params.sessionId!, requestId),
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/profile", auth: "session", rateLimit: sensitiveRateLimit, body: DeleteAccountInputSchema,
    handler: async ({ env, principal, body, requestId }) => ({
      data: await createService(env).deleteAccount(principal!.userId, body, requestId),
      headers: { "set-cookie": expiredSessionCookie },
    }),
  });
}
