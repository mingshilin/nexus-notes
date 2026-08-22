import { SecureTokenService } from "../auth/crypto";
import { D1WorkspaceAuthorizer } from "../auth/session-tenancy";
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

const MAX_WORKSPACE_ID_LENGTH = 128;
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

function validWorkspaceId(value: string) {
  return value.length <= MAX_WORKSPACE_ID_LENGTH && WORKSPACE_ID_PATTERN.test(value);
}

function presenceWorkspaceId(request: Request) {
  const queryValues = new URL(request.url).searchParams.getAll("workspace_id");
  if (queryValues.length > 1 || queryValues.some((value) => !validWorkspaceId(value))) {
    throw new PresenceRouteError("WORKSPACE_INVALID", "Workspace identifier is invalid", 400);
  }

  const headerValue = request.headers.get("x-workspace-id");
  const workspaceId = headerValue ?? queryValues[0];
  if (!workspaceId) {
    throw new PresenceRouteError("WORKSPACE_REQUIRED", "Workspace context is required", 400);
  }
  if (!validWorkspaceId(workspaceId)) {
    throw new PresenceRouteError("WORKSPACE_INVALID", "Workspace identifier is invalid", 400);
  }
  return workspaceId;
}

function identityPayload(workspaceId: string, userId: string, displayName: string, membershipEpoch: number) {
  return `${workspaceId}\n${userId}\n${displayName}\n${membershipEpoch}`;
}

export async function signPresenceIdentity(env: Pick<PresenceRouteEnv, "RATE_LIMIT_SECRET">, input: {
  workspaceId: string;
  userId: string;
  displayName: string;
  membershipEpoch: number;
}) {
  return new SecureTokenService(`presence:${env.RATE_LIMIT_SECRET}`).hash(
    identityPayload(input.workspaceId, input.userId, input.displayName, input.membershipEpoch),
  );
}

export function registerPresenceRoute<TEnv extends PresenceRouteEnv>(registry: PresenceRegistry<TEnv>) {
  registry.register({
    method: "GET",
    path: "/api/v2/presence",
    auth: "session",
    handler: async ({ request, env, principal }) => {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        throw new PresenceRouteError("WEBSOCKET_REQUIRED", "WebSocket upgrade is required", 426);
      }
      if (!principal) throw new PresenceRouteError("UNAUTHENTICATED", "Authentication is required", 401);
      const workspaceId = presenceWorkspaceId(request);
      const workspace = await new D1WorkspaceAuthorizer(env.DB).authorize(principal, workspaceId);
      if (!workspace) throw new PresenceRouteError("FORBIDDEN", "Workspace permission denied", 403);
      if (!env.PRESENCE) {
        throw new PresenceRouteError("PRESENCE_UNAVAILABLE", "Presence is temporarily unavailable", 503, true);
      }
      const user = await env.DB.prepare(
        `SELECT u.display_name, e.membership_epoch FROM users u
         JOIN workspace_members m ON m.user_id = u.id
         JOIN workspace_membership_epochs e ON e.workspace_id = m.workspace_id AND e.user_id = m.user_id
         WHERE m.workspace_id = ? AND m.user_id = ? LIMIT 1`,
      ).bind(workspace!.workspaceId, principal!.userId).first<{ display_name: string; membership_epoch: number }>();
      if (!user) throw new PresenceRouteError("FORBIDDEN", "Workspace permission denied", 403);

      const identity = {
        workspaceId: workspace!.workspaceId,
        userId: principal!.userId,
        displayName: user.display_name,
        membershipEpoch: user.membership_epoch,
      };
      const headers = new Headers({
        upgrade: "websocket",
        "x-presence-workspace-id": identity.workspaceId,
        "x-presence-user-id": identity.userId,
        "x-presence-display-name": identity.displayName,
        "x-presence-membership-epoch": String(identity.membershipEpoch),
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
