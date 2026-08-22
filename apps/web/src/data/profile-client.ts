import {
  AccountSessionSchema,
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
import { z } from "zod";
import type { ApiClient } from "./api-client";

type ProfileApi = Pick<ApiClient, "request">;

export interface ProfileClientOptions {
  createId?: () => string;
}

const AcceptedSchema = z.object({ accepted: z.literal(true) }).strict();
const ChangedSchema = z.object({ changed: z.literal(true) }).strict();
const RevokedSchema = z.object({ revoked: z.literal(true) }).strict();
const DeletedSchema = z.object({ deleted: z.literal(true) }).strict();
const SessionsSchema = z.object({ items: z.array(AccountSessionSchema) }).strict();

export class ProfileClient {
  private readonly createId: () => string;

  constructor(private readonly client: ProfileApi, options: ProfileClientOptions = {}) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  getProfile(signal?: AbortSignal): Promise<Profile> {
    return this.query<unknown>("/api/v2/profile", "profile", signal).then((value) => ProfileSchema.parse(value));
  }

  updateProfile(input: UpdateProfileInput, signal?: AbortSignal): Promise<Profile> {
    return this.command<unknown>("/api/v2/profile", "PATCH", UpdateProfileInputSchema.parse(input), signal)
      .then((value) => ProfileSchema.parse(value));
  }

  uploadAvatar(file: File, signal?: AbortSignal): Promise<Profile> {
    return this.client.request<unknown>({
      path: "/api/v2/profile/avatar",
      method: "POST",
      body: file,
      bodyMode: "raw",
      headers: { "content-type": file.type },
      requestClass: "command",
      policy: { timeoutMs: 15_000, retry: 0, idempotencyKey: this.createId(), signal },
    }).then((value) => ProfileSchema.parse(value));
  }

  deleteAvatar(signal?: AbortSignal): Promise<Profile> {
    return this.command<unknown>("/api/v2/profile/avatar", "DELETE", undefined, signal)
      .then((value) => ProfileSchema.parse(value));
  }

  requestEmailChange(input: RequestEmailChangeInput, signal?: AbortSignal) {
    return this.command<unknown>("/api/v2/profile/email/change", "POST", RequestEmailChangeInputSchema.parse(input), signal)
      .then((value) => AcceptedSchema.parse(value));
  }

  confirmEmailChange(input: ConfirmEmailChangeInput, signal?: AbortSignal): Promise<Profile> {
    return this.command<unknown>("/api/v2/profile/email/confirm", "POST", ConfirmEmailChangeInputSchema.parse(input), signal)
      .then((value) => ProfileSchema.parse(value));
  }

  changePassword(input: ChangePasswordInput, signal?: AbortSignal) {
    return this.command<unknown>("/api/v2/profile/password/change", "POST", ChangePasswordInputSchema.parse(input), signal)
      .then((value) => ChangedSchema.parse(value));
  }

  listSessions(signal?: AbortSignal): Promise<AccountSession[]> {
    return this.query<unknown>("/api/v2/profile/sessions", "profile:sessions", signal)
      .then((value) => SessionsSchema.parse(value).items);
  }

  revokeSession(sessionId: string, signal?: AbortSignal) {
    return this.command<unknown>(`/api/v2/profile/sessions/${encodeURIComponent(sessionId)}`, "DELETE", undefined, signal)
      .then((value) => RevokedSchema.parse(value));
  }

  deleteAccount(input: DeleteAccountInput, signal?: AbortSignal) {
    return this.command<unknown>("/api/v2/profile", "DELETE", DeleteAccountInputSchema.parse(input), signal)
      .then((value) => DeletedSchema.parse(value));
  }

  private query<T>(path: string, dedupeKey: string, signal?: AbortSignal) {
    return this.client.request<T>({
      path,
      method: "GET",
      requestClass: "query",
      policy: { timeoutMs: 8_000, retry: 2, dedupeKey, signal },
    });
  }

  private command<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown, signal?: AbortSignal) {
    return this.client.request<T>({
      path,
      method,
      body,
      requestClass: "command",
      policy: { timeoutMs: 8_000, retry: 0, idempotencyKey: this.createId(), signal },
    });
  }
}
