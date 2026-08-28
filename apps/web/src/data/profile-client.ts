import {
  AccountSessionSchema,
  AccountActivitySchema,
  AccountOverviewSchema,
  ChangePasswordInputSchema,
  ConfirmEmailChangeInputSchema,
  DeleteAccountInputSchema,
  ProfileSchema,
  PushSubscriptionInputSchema,
  PushSubscriptionSummarySchema,
  RequestEmailChangeInputSchema,
  UpdateProfileInputSchema,
  UpdateUserPreferencesInputSchema,
  UserPreferencesSchema,
  type AccountSession,
  type AccountOverview,
  type ChangePasswordInput,
  type ConfirmEmailChangeInput,
  type DeleteAccountInput,
  type Profile,
  type PushSubscriptionInput,
  type PushSubscriptionSummary,
  type RequestEmailChangeInput,
  type UpdateProfileInput,
  type UpdateUserPreferencesInput,
  type UserPreferences,
} from "@nexus/contracts";
import { z } from "zod";
import type { ApiClient } from "./api-client";
import type { WorkspaceQueryCache } from "./workspace-query-cache";

type ProfileApi = Pick<ApiClient, "request">;

export interface ProfileClientOptions {
  createId?: () => string;
  now?: () => number;
  userId?: string;
  workspaceId?: string;
  queryCache?: WorkspaceQueryCache;
}

const AcceptedSchema = z.object({ accepted: z.literal(true) }).strict();
const ChangedSchema = z.object({ changed: z.literal(true) }).strict();
const RevokedSchema = z.object({ revoked: z.literal(true) }).strict();
const DeletedSchema = z.object({ deleted: z.literal(true) }).strict();
const SessionsSchema = z.object({ items: z.array(AccountSessionSchema) }).strict();
const ActivityPageSchema = z.object({ items: z.array(AccountActivitySchema), next_cursor: z.string().nullable() }).strict();
const PushSubscriptionsSchema = z.object({ items: z.array(PushSubscriptionSummarySchema) }).strict();
const PushPublicKeySchema = z.object({ public_key: z.string().min(1) }).strict();
const PushSubscriptionResponseSchema = z.object({ subscription: PushSubscriptionSummarySchema }).strict();
const PushTestSchema = z.object({ queued: z.number().int().nonnegative() }).strict();
const RevokedOthersSchema = z.object({ revoked: z.number().int().nonnegative() }).strict();

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ProfileClient {
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly userId?: string;
  private readonly workspaceId: string;
  private readonly queryCache?: WorkspaceQueryCache;
  private overviewCache: CacheEntry<AccountOverview> | null = null;
  private preferencesCache: CacheEntry<UserPreferences> | null = null;

  constructor(private readonly client: ProfileApi, options: ProfileClientOptions = {}) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => Date.now());
    this.userId = options.userId;
    this.workspaceId = options.workspaceId ?? "account";
    this.queryCache = options.queryCache;
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

  getOverview(signal?: AbortSignal) {
    const load = (requestSignal?: AbortSignal) => this.query<unknown>(
      "/api/v2/profile/overview",
      "profile:overview",
      requestSignal,
    ).then((value) => AccountOverviewSchema.parse(value));
    const shared = this.shared("overview", load, signal);
    if (shared) return shared;
    return this.cached(this.overviewCache, 5 * 60_000, async () => {
      const value = await load(signal);
      this.overviewCache = { value, expiresAt: this.now() + 5 * 60_000 };
      return value;
    });
  }

  getPreferences(signal?: AbortSignal) {
    const load = (requestSignal?: AbortSignal) => this.query<unknown>(
      "/api/v2/profile/preferences",
      "profile:preferences",
      requestSignal,
    ).then((value) => UserPreferencesSchema.parse(value));
    const shared = this.shared("preferences", load, signal);
    if (shared) return shared;
    return this.cached(this.preferencesCache, 5 * 60_000, async () => {
      const value = await load(signal);
      this.preferencesCache = { value, expiresAt: this.now() + 5 * 60_000 };
      return value;
    });
  }

  async updatePreferences(input: UpdateUserPreferencesInput, signal?: AbortSignal) {
    const value = UserPreferencesSchema.parse(await this.command<unknown>(
      "/api/v2/profile/preferences",
      "PATCH",
      UpdateUserPreferencesInputSchema.parse(input),
      signal,
    ));
    this.preferencesCache = null;
    this.overviewCache = null;
    this.invalidateAccountCache();
    return value;
  }

  getActivity(limit = 25, cursor?: string, signal?: AbortSignal) {
    const search = new URLSearchParams({ limit: String(limit) });
    if (cursor) search.set("cursor", cursor);
    return this.query<unknown>(`/api/v2/profile/activity?${search}`, `profile:activity:${cursor ?? "first"}:${limit}`, signal)
      .then((value) => ActivityPageSchema.parse(value));
  }

  revokeOtherSessions(signal?: AbortSignal) {
    return this.command<unknown>("/api/v2/profile/sessions/revoke-others", "POST", undefined, signal)
      .then((value) => RevokedOthersSchema.parse(value));
  }

  listPushSubscriptions(signal?: AbortSignal): Promise<PushSubscriptionSummary[]> {
    return this.query<unknown>("/api/v2/push/subscriptions", "push:subscriptions", signal)
      .then((value) => PushSubscriptionsSchema.parse(value).items);
  }

  getPushPublicKey(signal?: AbortSignal) {
    return this.query<unknown>("/api/v2/push/public-key", "push:public-key", signal)
      .then((value) => PushPublicKeySchema.parse(value).public_key);
  }

  subscribePush(input: PushSubscriptionInput, signal?: AbortSignal) {
    return this.command<unknown>("/api/v2/push/subscriptions", "POST", PushSubscriptionInputSchema.parse(input), signal)
      .then((value) => PushSubscriptionResponseSchema.parse(value).subscription);
  }

  disablePushSubscription(subscriptionId: string, signal?: AbortSignal) {
    return this.command<unknown>(`/api/v2/push/subscriptions/${encodeURIComponent(subscriptionId)}`, "DELETE", undefined, signal)
      .then((value) => DeletedSchema.parse(value));
  }

  testPush(signal?: AbortSignal) {
    return this.command<unknown>("/api/v2/push/test", "POST", undefined, signal)
      .then((value) => PushTestSchema.parse(value));
  }

  private cached<T>(entry: CacheEntry<T> | null, _ttl: number, load: () => Promise<T>) {
    if (entry && entry.expiresAt > this.now()) return Promise.resolve(entry.value);
    return load();
  }

  private shared<T>(query: string, load: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) {
    if (!this.queryCache || !this.userId) return null;
    return this.queryCache.get(
      { userId: this.userId, workspaceId: this.workspaceId, domain: "account", query },
      (requestSignal) => load(requestSignal),
      { ttlMs: 5 * 60_000, signal },
    );
  }

  private invalidateAccountCache() {
    this.queryCache?.invalidate({ userId: this.userId, workspaceId: this.workspaceId, domain: "account" });
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
    }).then((value) => {
      this.overviewCache = null;
      this.preferencesCache = null;
      this.invalidateAccountCache();
      return value;
    });
  }
}
