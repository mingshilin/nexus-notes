import { SecureTokenService } from "../auth/crypto";

const MAX_CONTROL_BYTES = 4_096;
const DISPATCH_TIMEOUT_MS = 250;

export interface PresenceInvalidation {
  workspaceId: string;
  entityType: string;
  entityId: string;
  revision: number;
}

export interface PresenceMembershipRevocation {
  workspaceId: string;
  userId: string;
  membershipEpoch: number;
}

export interface PresenceNotifier {
  invalidate(input: PresenceInvalidation): Promise<void>;
  revoke(input: PresenceMembershipRevocation): Promise<void>;
}

interface PresenceDispatcherEnv {
  PRESENCE?: DurableObjectNamespace;
  RATE_LIMIT_SECRET: string;
}

export function presenceCommandPayload(workspaceId: string, body: string) {
  return `${workspaceId}\n${body}`;
}

export function signPresenceCommand(secret: string, workspaceId: string, body: string) {
  return new SecureTokenService(`presence-command:${secret}`).hash(
    presenceCommandPayload(workspaceId, body),
  );
}

function timeout() {
  return new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Presence dispatch timed out")), DISPATCH_TIMEOUT_MS);
  });
}

export function createPresenceNotifier(env: PresenceDispatcherEnv): PresenceNotifier | undefined {
  if (!env.PRESENCE || !env.RATE_LIMIT_SECRET || env.RATE_LIMIT_SECRET.length < 32) return undefined;

  const dispatch = async (workspaceId: string, command: Record<string, unknown>) => {
    const body = JSON.stringify(command);
    if (new TextEncoder().encode(body).byteLength > MAX_CONTROL_BYTES) {
      throw new Error("Presence command is too large");
    }
    const signature = await signPresenceCommand(env.RATE_LIMIT_SECRET, workspaceId, body);
    const id = env.PRESENCE!.idFromName(workspaceId);
    const request = new Request("https://presence.internal/control", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-presence-workspace-id": workspaceId,
        "x-presence-command-signature": signature,
      },
      body,
    });
    const response = await Promise.race([env.PRESENCE!.get(id).fetch(request), timeout()]);
    if (!response.ok) throw new Error(`Presence dispatch failed with ${response.status}`);
  };

  return {
    invalidate: (input) => dispatch(input.workspaceId, {
      type: "entity.invalidated",
      entity_type: input.entityType,
      entity_id: input.entityId,
      revision: input.revision,
    }),
    revoke: (input) => dispatch(input.workspaceId, {
      type: "membership.revoked",
      user_id: input.userId,
      membership_epoch: input.membershipEpoch,
    }),
  };
}
