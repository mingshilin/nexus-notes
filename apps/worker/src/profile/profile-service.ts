import {
  ChangePasswordInputSchema, ConfirmEmailChangeInputSchema, DeleteAccountInputSchema, ProfileSchema,
  RequestEmailChangeInputSchema, UpdateProfileInputSchema, type AccountSession, type ChangePasswordInput,
  type ConfirmEmailChangeInput, type DeleteAccountInput, type Profile, type RequestEmailChangeInput, type UpdateProfileInput,
} from "@nexus/contracts";
import { assertPasswordPolicy, detectAvatarMimeType, normalizeEmail, normalizeProfilePatch } from "@nexus/domain";

import type { ProfileAvatarStore } from "./profile-avatar-store";
import { type AccountAuditEvent, ProfileServiceError, type ProfileMutationAudit, type ProfileRepository, type StoredProfile } from "./profile-model";

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
    const patch = normalizeProfilePatch(this.parse(UpdateProfileInputSchema, input));
    const audit = this.audit("profile.updated", requestId);
    await this.dependencies.repository.updateProfile(userId, patch, audit);
    return this.getProfile(userId);
  }

  async uploadAvatar(userId: string, declaredType: string, bytes: Uint8Array, requestId: string) {
    if (!(bytes instanceof Uint8Array)) throw this.invalidInput();
    if (bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) {
      throw new ProfileServiceError("AVATAR_SIZE_INVALID", "Avatar must be between 1 byte and 2 MiB", 413);
    }
    const mime = detectAvatarMimeType(bytes);
    if (!mime || mime !== declaredType) {
      throw new ProfileServiceError("AVATAR_TYPE_INVALID", "Avatar content type is invalid", 415);
    }

    const key = `profiles/${userId}/${this.dependencies.createId()}`;
    await this.dependencies.avatars.put(key, bytes, mime);
    try {
      const oldKey = await this.dependencies.repository.replaceAvatar(userId, key, this.audit("avatar.updated", requestId));
      if (oldKey && oldKey !== key) await this.deletePrivateAvatar(oldKey, requestId);
    } catch (error) {
      await this.deletePrivateAvatar(key, requestId);
      throw error;
    }
    return this.getProfile(userId);
  }

  async getAvatar(userId: string) {
    const profile = await this.requireProfile(userId);
    return profile.avatar_key ? this.dependencies.avatars.get(profile.avatar_key) : null;
  }

  async deleteAvatar(userId: string, requestId: string) {
    const oldKey = await this.dependencies.repository.replaceAvatar(userId, null, this.audit("avatar.deleted", requestId));
    if (oldKey) await this.deletePrivateAvatar(oldKey, requestId);
    return this.getProfile(userId);
  }

  async requestEmailChange(userId: string, input: RequestEmailChangeInput, requestId: string) {
    const raw = this.record(input);
    const profile = await this.requireProfile(userId);
    await this.requireCurrentPassword(this.passwordValue(raw), profile);
    const newEmail = typeof raw.new_email === "string" ? normalizeEmail(raw.new_email) : raw.new_email;
    const request = this.parse(RequestEmailChangeInputSchema, { ...raw, new_email: newEmail });
    const email = normalizeEmail(request.new_email);
    if (email === normalizeEmail(profile.email)) {
      throw new ProfileServiceError("EMAIL_UNCHANGED", "New email must be different from the current email");
    }
    if (await this.dependencies.repository.findActiveUserByEmail(email)) {
      throw new ProfileServiceError("EMAIL_EXISTS", "This email is already registered", 409);
    }

    const date = this.dependencies.clock();
    const code = this.dependencies.tokens.createEmailCode();
    const codeHash = await this.dependencies.tokens.hash(`email_change:${userId}:${email}:${code}`);
    await this.dependencies.repository.createEmailChange(
      userId, email, codeHash, addMinutes(date, 15), this.audit("email.change_requested", requestId, date.toISOString()),
    );
    await this.dependencies.email.sendEmailChange(email, code);
    return { accepted: true } as const;
  }

  async confirmEmailChange(userId: string, input: ConfirmEmailChangeInput, requestId: string) {
    const raw = this.record(input);
    const newEmail = typeof raw.new_email === "string" ? normalizeEmail(raw.new_email) : raw.new_email;
    const confirmation = this.parse(ConfirmEmailChangeInputSchema, { ...raw, new_email: newEmail });
    const email = normalizeEmail(confirmation.new_email);
    const audit = this.audit("email.changed", requestId);
    const codeHash = await this.dependencies.tokens.hash(`email_change:${userId}:${email}:${confirmation.code}`);
    const consumed = await this.dependencies.repository.consumeEmailChange(userId, email, codeHash, audit);
    if (!consumed) throw new ProfileServiceError("EMAIL_CHANGE_CODE_INVALID", "Email change code is invalid or expired");
    return this.getProfile(userId);
  }

  async changePassword(userId: string, sessionId: string, input: ChangePasswordInput, requestId: string) {
    const raw = this.record(input);
    const profile = await this.requireProfile(userId);
    await this.requireCurrentPassword(this.passwordValue(raw), profile);
    if (typeof raw.new_password !== "string") throw this.invalidInput();
    assertPasswordPolicy(raw.new_password);
    const change = this.parse(ChangePasswordInputSchema, raw);
    const passwordHash = await this.dependencies.password.hash(change.new_password);
    await this.dependencies.repository.changePasswordAndRevokeOthers(
      userId, sessionId, passwordHash, this.audit("password.changed", requestId),
    );
    return { changed: true } as const;
  }

  listSessions(userId: string, sessionId: string) {
    return this.dependencies.repository.listSessions(userId, sessionId, this.now());
  }

  async revokeSession(userId: string, sessionId: string, targetSessionId: string, requestId: string) {
    const revoked = await this.dependencies.repository.revokeOwnedSession(
      userId, targetSessionId, sessionId, this.audit("session.revoked", requestId),
    );
    if (!revoked) throw new ProfileServiceError("SESSION_NOT_FOUND", "Session is unavailable", 404);
    return { revoked: true } as const;
  }

  async deleteAccount(userId: string, input: DeleteAccountInput, requestId: string) {
    const raw = this.record(input);
    const profile = await this.requireProfile(userId);
    await this.requireCurrentPassword(this.passwordValue(raw), profile);
    this.parse(DeleteAccountInputSchema, raw);
    const ownedWorkspaces = await this.dependencies.repository.listOwnedTeamWorkspaces(userId);
    if (ownedWorkspaces.length > 0) {
      throw this.ownershipError(ownedWorkspaces.map(({ name }) => name));
    }

    const now = this.now();
    const replacementPasswordHash = await this.dependencies.password.hash(`${userId}:${now}`);
    const oldKey = await this.dependencies.repository.deleteAccount(
      userId, `deleted-${userId}@example.invalid`, replacementPasswordHash, this.audit("account.deleted", requestId, now),
    );
    if (oldKey) await this.deletePrivateAvatar(oldKey, requestId);
    return { deleted: true } as const;
  }

  private now() {
    return this.dependencies.clock().toISOString();
  }

  private audit(event: AccountAuditEvent, requestId: string, now = this.now()): ProfileMutationAudit {
    return { event, requestId, now };
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

  private async deletePrivateAvatar(key: string, requestId: string) {
    try {
      await this.dependencies.avatars.delete(key);
    } catch {
      try {
        this.dependencies.logger.log(JSON.stringify({ type: "profile.avatar_cleanup_failed", request_id: requestId }));
      } catch {
        // Diagnostics must never replace a committed operation or its original failure.
      }
    }
  }

  private record(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw this.invalidInput();
    return input as Record<string, unknown>;
  }

  private passwordValue(input: Record<string, unknown>) {
    if (typeof input.current_password !== "string") throw this.invalidInput();
    return input.current_password;
  }

  private parse<T>(schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } }, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw this.invalidInput();
    return result.data;
  }

  private invalidInput() {
    return new ProfileServiceError("PROFILE_INPUT_INVALID", "Profile input is invalid", 400);
  }

  private ownershipError(names: string[]) {
    return new ProfileServiceError(
      "OWNERSHIP_TRANSFER_REQUIRED",
      `Transfer owned team workspaces before deleting the account: ${names.join(", ")}`,
      409,
    );
  }

  private toProfile(profile: StoredProfile) {
    const { password_hash: _passwordHash, avatar_key: _avatarKey, ...value } = profile;
    return ProfileSchema.parse(value);
  }
}
