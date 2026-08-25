import type { AccountSession, Profile, UpdateProfileInput } from "@nexus/contracts";

export const ACCOUNT_AUDIT_EVENTS = [
  "profile.updated", "avatar.updated", "avatar.deleted", "email.change_requested",
  "email.changed", "password.changed", "session.revoked", "account.deleted",
] as const;

export type AccountAuditEvent = typeof ACCOUNT_AUDIT_EVENTS[number];

export interface ProfileMutationAudit {
  event: AccountAuditEvent;
  requestId: string;
  now: string;
}

export interface StoredProfile extends Profile {
  password_hash: string;
  avatar_key: string | null;
}

export interface ProfileRepository {
  getProfile(userId: string): Promise<StoredProfile | null>;
  findActiveUserByEmail(email: string): Promise<{ id: string } | null>;
  updateProfile(userId: string, patch: UpdateProfileInput, audit: ProfileMutationAudit): Promise<void>;
  replaceAvatar(userId: string, avatarKey: string | null, audit: ProfileMutationAudit): Promise<string | null>;
  listSessions(userId: string, currentSessionId: string, now: string): Promise<AccountSession[]>;
  listOwnedTeamWorkspaces(userId: string): Promise<Array<{ id: string; name: string }>>;
  revokeOwnedSession(userId: string, sessionId: string, currentSessionId: string, audit: ProfileMutationAudit): Promise<boolean>;
  createEmailChange(userId: string, email: string, codeHash: string, expiresAt: string, audit: ProfileMutationAudit): Promise<void>;
  consumeEmailChange(userId: string, email: string, codeHash: string, audit: ProfileMutationAudit): Promise<boolean>;
  changePasswordAndRevokeOthers(userId: string, currentSessionId: string, passwordHash: string, audit: ProfileMutationAudit): Promise<void>;
  deleteAccount(userId: string, anonymizedEmail: string, passwordHash: string, audit: ProfileMutationAudit): Promise<string | null>;
}

export class ProfileServiceError extends Error {
  readonly retryable = false;

  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "ProfileServiceError";
  }
}

export function assertAccountAuditEvent(event: string): asserts event is AccountAuditEvent {
  if (!(ACCOUNT_AUDIT_EVENTS as readonly string[]).includes(event)) {
    throw new ProfileServiceError("ACCOUNT_AUDIT_EVENT_INVALID", "Account audit event is invalid", 400);
  }
}
