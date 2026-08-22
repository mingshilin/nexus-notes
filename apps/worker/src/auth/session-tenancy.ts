import type { WorkspaceContext } from "@nexus/contracts";
import type { WorkspaceRole } from "@nexus/domain";
import type { SessionPrincipal } from "../http/route-registry";

interface TokenHasher {
  hash(value: string): Promise<string>;
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export class D1SessionAuthenticator {
  constructor(
    private readonly db: D1Database,
    private readonly tokens: TokenHasher,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async authenticate(request: Request): Promise<SessionPrincipal | null> {
    const token = readCookie(request, "nexus_session");
    if (!token) return null;
    const tokenHash = await this.tokens.hash(token);
    const now = this.clock().toISOString();
    const session = await this.db.prepare(
      `SELECT s.id AS session_id, s.user_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > ?
         AND u.status = 'active'
       LIMIT 1`,
    ).bind(tokenHash, now).first<{ session_id: string; user_id: string }>();
    return session ? { userId: session.user_id, sessionId: session.session_id } : null;
  }
}

function isWorkspaceRole(value: string): value is WorkspaceRole {
  return value === "owner" || value === "editor" || value === "viewer";
}

export class D1WorkspaceAuthorizer {
  constructor(private readonly db: D1Database) {}

  async authorize(principal: SessionPrincipal, workspaceId: string): Promise<WorkspaceContext | null> {
    const membership = await this.db.prepare(
      `SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1`,
    ).bind(workspaceId, principal.userId).first<{ role: string }>();
    if (!membership || !isWorkspaceRole(membership.role)) return null;

    const capabilityRows = await this.db.prepare(
      `SELECT capability FROM workspace_capabilities WHERE workspace_id = ? AND enabled = 1 ORDER BY capability`,
    ).bind(workspaceId).all<{ capability: string }>();
    return {
      workspaceId,
      userId: principal.userId,
      role: membership.role,
      capabilities: new Set(capabilityRows.results.map((row) => row.capability)),
    };
  }
}
