import type { AccountSession, Profile, UpdateProfileInput } from "@nexus/contracts";

export interface StoredProfile extends Profile {
  password_hash: string;
  avatar_key: string | null;
}

export interface ProfileRepository {
  getProfile(userId: string): Promise<StoredProfile | null>;
  findActiveUserByEmail(email: string): Promise<{ id: string } | null>;
  updateProfile(userId: string, patch: UpdateProfileInput, now: string): Promise<void>;
  replaceAvatar(userId: string, avatarKey: string | null, now: string): Promise<string | null>;
  listSessions(userId: string, currentSessionId: string, now: string): Promise<AccountSession[]>;
  listOwnedTeamWorkspaces(userId: string): Promise<Array<{ id: string; name: string }>>;
  revokeOwnedSession(userId: string, sessionId: string, currentSessionId: string, now: string): Promise<boolean>;
  createEmailChange(userId: string, email: string, codeHash: string, expiresAt: string, now: string): Promise<void>;
  consumeEmailChange(userId: string, email: string, codeHash: string, now: string): Promise<boolean>;
  changePasswordAndRevokeOthers(userId: string, currentSessionId: string, passwordHash: string, now: string): Promise<void>;
  deleteAccount(userId: string, anonymizedEmail: string, passwordHash: string, now: string): Promise<string | null>;
  appendAudit(userId: string, event: string, requestId: string, now: string): Promise<void>;
}

export class ProfileServiceError extends Error {
  readonly retryable = false;

  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "ProfileServiceError";
  }
}
