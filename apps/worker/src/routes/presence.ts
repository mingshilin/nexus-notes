import { SecureTokenService } from "../auth/crypto";
import type { RouteDefinition } from "../http/route-registry";

interface PresenceRegistry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

export interface PresenceRouteEnv {
  DB: D1Database;
  PRESENCE?: DurableObjectNamespace;
  RATE_LIMIT_SECRET: string;
}

class PresenceRouteError extends Error {
  readonly retryable: boolean;

  constructor(readonly code: string, message: string, readonly status: number, retryable = false) {
    super(message);
    this.name = "PresenceRouteError";
    this.retryable = retryable;
  }
}

function identityPayload(workspaceId: string, userId: string, displayName: string) {
  return `${workspaceId}\n${userId}\n${displayName}`;
}

export async function signPresenceIdentity(env: Pick<PresenceRouteEnv, "RATE_LIMIT_SECRET">, input: {
  workspaceId: string;
  userId: string;
  displayName: string;
}) {
  return new SecureTokenService(`presence:${env.RATE_LIMIT_SECRET}`).hash(
    identityPayload(input.workspaceId, input.userId, input.displayName),
  );
}

export function registerPresenceRoute<TEnv extends PresenceRouteEnv>(registry: PresenceRegistry<TEnv>) {
  registry.register({
    method: "GET",
    path: "/api/v2/presence",
    auth: "workspace",
    handler: async ({ request, env, principal, workspace }) => {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        throw new PresenceRouteError("WEBSOCKET_REQUIRED", "WebSocket upgrade is required", 426);
      }
      if (!env.PRESENCE) {
        throw new PresenceRouteError("PRESENCE_UNAVAILABLE", "Presence is temporarily unavailable", 503, true);
      }
      const user = await env.DB.prepare(
        `SELECT u.display_name FROM users u
         JOIN workspace_members m ON m.user_id = u.id
         WHERE m.workspace_id = ? AND m.user_id = ? LIMIT 1`,
      ).bind(workspace!.workspaceId, principal!.userId).first<{ display_name: string }>();
      if (!user) throw new PresenceRouteError("FORBIDDEN", "Workspace permission denied", 403);

      const identity = {
        workspaceId: workspace!.workspaceId,
        userId: principal!.userId,
        displayName: user.display_name,
      };
      const headers = new Headers({
        upgrade: "websocket",
        "x-presence-workspace-id": identity.workspaceId,
        "x-presence-user-id": identity.userId,
        "x-presence-display-name": identity.displayName,
        "x-presence-signature": await signPresenceIdentity(env, identity),
      });
      try {
        const id = env.PRESENCE.idFromName(identity.workspaceId);
        return await env.PRESENCE.get(id).fetch(new Request("https://presence.internal/connect", { headers }));
      } catch {
        throw new PresenceRouteError("PRESENCE_UNAVAILABLE", "Presence is temporarily unavailable", 503, true);
      }
    },
  });
}
