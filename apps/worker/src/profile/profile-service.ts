import {
  ChangePasswordInputSchema,
  ConfirmEmailChangeInputSchema,
  DeleteAccountInputSchema,
  ProfileSchema,
  RequestEmailChangeInputSchema,
  UpdateProfileInputSchema,
  type AccountSession,
  type ChangePasswordInput,
  type ConfirmEmailChangeInput,
  type DeleteAccountInput,
  type Profile,
  type RequestEmailChangeInput,
  type UpdateProfileInput,
} from "@nexus/contracts";
import { assertPasswordPolicy, detectAvatarMimeType, normalizeEmail, normalizeProfilePatch } from "@nexus/domain";

import type { ProfileAvatarStore } from "./profile-avatar-store";
import { ProfileServiceError, type ProfileRepository, type StoredProfile } from "./profile-model";

export interface ProfileServiceLogger {
  log(message: string): void;
}

export interface ProfileServiceDependencies {
  repository: ProfileRepository;
  password: { verify(password: string, encodedHash: string): Promise<boolean>; hash(password: string): Promise<string> };
  tokens: { createEmailCode(): string; hash(value: string): Promise<string> };
  email: { sendEmailChange(email: string, code: string): Promise<void> | void };
  avatars: Pick<ProfileAvatarStore, "put" | "get" | "delete">;
  logger: ProfileServiceLogger;
  createId(): string;
  clock(): Date;
}

export interface ProfileServiceApi {
  getProfile(userId: string): Promise<Profile>;
  updateProfile(userId: string, input: UpdateProfileInput, requestId: string): Promise<Profile>;
  uploadAvatar(userId: string, declaredType: string, bytes: Uint8Array, requestId: string): Promise<Profile>;
  getAvatar(userId: string): Promise<R2ObjectBody | null>;
  deleteAvatar(userId: string, requestId: string): Promise<Profile>;
  requestEmailChange(userId: string, input: RequestEmailChangeInput, requestId: string): Promise<{ accepted: true }>;
  confirmEmailChange(userId: string, input: ConfirmEmailChangeInput, requestId: string): Promise<Profile>;
  changePassword(userId: string, sessionId: string, input: ChangePasswordInput, requestId: string): Promise<{ changed: true }>;
  listSessions(userId: string, sessionId: string): Promise<AccountSession[]>;
  revokeSession(userId: string, sessionId: string, targetSessionId: string, requestId: string): Promise<{ revoked: true }>;
  deleteAccount(userId: string, input: DeleteAccountInput, requestId: string): Promise<{ deleted: true }>;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

export class ProfileService implements ProfileServiceApi {
  constructor(private readonly dependencies: ProfileServiceDependencies) {}

  async getProfile(userId: string) {
    return this.toProfile(await this.requireProfile(userId));
  }

  async updateProfile(userId: string, input: UpdateProfileInput, requestId: string) {
    const patch = normalizeProfilePatch(UpdateProfileInputSchema.parse(input));
    const now = this.now();
    await this.dependencies.repository.updateProfile(userId, patch, now);
    await this.audit(userId, "profile.updated", requestId, now);
    return this.getProfile(userId);
  }

  async uploadAvatar(userId: string, declaredType: string, bytes: Uint8Array, requestId: string) {
    if (bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) {
      throw new ProfileServiceError("AVATAR_SIZE_INVALID", "Avatar must be between 1 byte and 2 MiB", 413);
    }
    const mime = detectAvatarMimeType(bytes);
    if (!mime || mime !== declaredType) {
      throw new ProfileServiceError("AVATAR_TYPE_INVALID", "Avatar content type is invalid", 415);
    }

    const now = this.now();
    const key = `profiles/${userId}/${this.dependencies.createId()}`;
    await this.dependencies.avatars.put(key, bytes, mime);
    try {
      const oldKey = await this.dependencies.repository.replaceAvatar(userId, key, now);
      if (oldKey && oldKey !== key) await this.deleteOldAvatar(oldKey, requestId);
    } catch (error) {
      await this.dependencies.avatars.delete(key);
      throw error;
    }
    await this.audit(userId, "avatar.updated", requestId, now);
    return this.getProfile(userId);
  }

  async getAvatar(userId: string) {
    const profile = await this.requireProfile(userId);
    return profile.avatar_key ? this.dependencies.avatars.get(profile.avatar_key) : null;
  }

  async deleteAvatar(userId: string, requestId: string) {
    const now = this.now();
    const oldKey = await this.dependencies.repository.replaceAvatar(userId, null, now);
    if (oldKey) await this.deleteOldAvatar(oldKey, requestId);
    await this.audit(userId, "avatar.deleted", requestId, now);
    return this.getProfile(userId);
  }

  async requestEmailChange(userId: string, input: RequestEmailChangeInput, requestId: string) {
    const request = RequestEmailChangeInputSchema.parse({ ...input, new_email: normalizeEmail(input.new_email) });
    const profile = await this.requireProfile(userId);
    const email = normalizeEmail(request.new_email);
    if (email === normalizeEmail(profile.email)) {
      throw new ProfileServiceError("EMAIL_UNCHANGED", "New email must be different from the current email");
    }
    if (await this.dependencies.repository.findActiveUserByEmail(email)) {
      throw new ProfileServiceError("EMAIL_EXISTS", "This email is already registered", 409);
    }
    await this.requireCurrentPassword(request.current_password, profile);

    const date = this.dependencies.clock();
    const now = date.toISOString();
    const code = this.dependencies.tokens.createEmailCode();
    const codeHash = await this.dependencies.tokens.hash(`email_change:${userId}:${email}:${code}`);
    await this.dependencies.repository.createEmailChange(userId, email, codeHash, addMinutes(date, 15), now);
    await this.dependencies.email.sendEmailChange(email, code);
    await this.audit(userId, "email.change_requested", requestId, now);
    return { accepted: true } as const;
  }

  async confirmEmailChange(userId: string, input: ConfirmEmailChangeInput, requestId: string) {
    const confirmation = ConfirmEmailChangeInputSchema.parse({ ...input, new_email: normalizeEmail(input.new_email) });
    const email = normalizeEmail(confirmation.new_email);
    const now = this.now();
    const codeHash = await this.dependencies.tokens.hash(`email_change:${userId}:${email}:${confirmation.code}`);
    const consumed = await this.dependencies.repository.consumeEmailChange(userId, email, codeHash, now);
    if (!consumed) throw new ProfileServiceError("EMAIL_CHANGE_CODE_INVALID", "Email change code is invalid or expired");
    await this.audit(userId, "email.changed", requestId, now);
    return this.getProfile(userId);
  }

  async changePassword(userId: string, sessionId: string, input: ChangePasswordInput, requestId: string) {
    assertPasswordPolicy(input.new_password);
    const change = ChangePasswordInputSchema.parse(input);
    const profile = await this.requireProfile(userId);
    await this.requireCurrentPassword(change.current_password, profile);
    const now = this.now();
    const passwordHash = await this.dependencies.password.hash(change.new_password);
    await this.dependencies.repository.changePasswordAndRevokeOthers(userId, sessionId, passwordHash, now);
    await this.audit(userId, "password.changed", requestId, now);
    return { changed: true } as const;
  }

  listSessions(userId: string, sessionId: string) {
    return this.dependencies.repository.listSessions(userId, sessionId, this.now());
  }

  async revokeSession(userId: string, sessionId: string, targetSessionId: string, requestId: string) {
    const now = this.now();
    const revoked = await this.dependencies.repository.revokeOwnedSession(userId, targetSessionId, sessionId, now);
    if (!revoked) throw new ProfileServiceError("SESSION_NOT_FOUND", "Session is unavailable", 404);
    await this.audit(userId, "session.revoked", requestId, now);
    return { revoked: true } as const;
  }

  async deleteAccount(userId: string, input: DeleteAccountInput, requestId: string) {
    const deletion = DeleteAccountInputSchema.parse(input);
    const profile = await this.requireProfile(userId);
    await this.requireCurrentPassword(deletion.current_password, profile);
    const ownedWorkspaces = await this.dependencies.repository.listOwnedTeamWorkspaces(userId);
    if (ownedWorkspaces.length > 0) {
      throw new ProfileServiceError(
        "OWNERSHIP_TRANSFER_REQUIRED",
        `Transfer owned team workspaces before deleting the account: ${ownedWorkspaces.map(({ name }) => name).join(", ")}`,
        409,
      );
    }

    const now = this.now();
    const replacementPasswordHash = await this.dependencies.password.hash(`${userId}:${now}`);
    const oldKey = await this.dependencies.repository.deleteAccount(
      userId,
      `deleted-${userId}@example.invalid`,
      replacementPasswordHash,
      now,
    );
    if (oldKey) await this.deleteOldAvatar(oldKey, requestId);
    await this.audit(userId, "account.deleted", requestId, now);
    return { deleted: true } as const;
  }

  private now() {
    return this.dependencies.clock().toISOString();
  }

  private async requireProfile(userId: string): Promise<StoredProfile> {
    const profile = await this.dependencies.repository.getProfile(userId);
    if (!profile) throw new ProfileServiceError("PROFILE_NOT_FOUND", "Profile is unavailable", 404);
    return profile;
  }

  private async requireCurrentPassword(password: string, profile: StoredProfile) {
    if (!await this.dependencies.password.verify(password, profile.password_hash)) {
      throw new ProfileServiceError("CURRENT_PASSWORD_INVALID", "Current password is incorrect", 403);
    }
  }

  private async audit(userId: string, event: string, requestId: string, now: string) {
    await this.dependencies.repository.appendAudit(userId, event, requestId, now);
  }

  private async deleteOldAvatar(key: string, requestId: string) {
    try {
      await this.dependencies.avatars.delete(key);
    } catch {
      try {
        this.dependencies.logger.log(JSON.stringify({ type: "profile.avatar_cleanup_failed", request_id: requestId }));
      } catch {
        // Cleanup diagnostics must never change a committed profile update.
      }
    }
  }

  private toProfile(profile: StoredProfile) {
    const { password_hash: _passwordHash, avatar_key: _avatarKey, ...value } = profile;
    return ProfileSchema.parse(value);
  }
}
