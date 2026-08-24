import { UpdateUserPreferencesInputSchema } from "@nexus/contracts";
import type { D1AccountRepository } from "../account/d1-account-repository";
import type { RouteDefinition } from "../http/route-registry";

interface Registry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

type AccountService = Pick<D1AccountRepository,
  "getOverview" | "getPreferences" | "updatePreferences" | "listActivity" | "revokeOtherSessions">;

function sessionId(value: string | undefined) {
  if (!value) throw Object.assign(new Error("Session is unavailable"), { code: "SESSION_INVALID", status: 401, retryable: false });
  return value;
}

function activityOptions(request: Request) {
  const search = new URL(request.url).searchParams;
  const raw = Number(search.get("limit") ?? 25);
  return {
    cursor: search.get("cursor") || undefined,
    limit: Number.isInteger(raw) ? Math.max(1, Math.min(100, raw)) : 25,
  };
}

export function registerAccountRoutes<TEnv>(registry: Registry<TEnv>, createService: (env: TEnv) => AccountService) {
  const rateLimit = { bucket: "ip", limit: 30, windowSeconds: 60 } as const;
  registry.register({
    method: "GET", path: "/api/v2/profile/overview", auth: "session", rateLimit,
    handler: async ({ env, principal }) => ({ data: await createService(env).getOverview(principal!.userId) }),
  });
  registry.register({
    method: "GET", path: "/api/v2/profile/preferences", auth: "session", rateLimit,
    handler: async ({ env, principal }) => ({ data: await createService(env).getPreferences(principal!.userId) }),
  });
  registry.register({
    method: "PATCH", path: "/api/v2/profile/preferences", auth: "session", rateLimit,
    body: UpdateUserPreferencesInputSchema,
    handler: async ({ env, principal, body, requestId }) => ({
      data: await createService(env).updatePreferences(principal!.userId, body, requestId),
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/profile/activity", auth: "session", rateLimit,
    handler: async ({ request, env, principal }) => ({
      data: await createService(env).listActivity(principal!.userId, activityOptions(request)),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/profile/sessions/revoke-others", auth: "session",
    rateLimit: { bucket: "ip", limit: 5, windowSeconds: 30 * 60 },
    handler: async ({ env, principal, requestId }) => ({
      data: await createService(env).revokeOtherSessions(principal!.userId, sessionId(principal!.sessionId), requestId),
    }),
  });
}
