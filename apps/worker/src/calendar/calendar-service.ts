import type {
  CalendarConnectionSummary,
  CalendarEvent,
  CalendarEventsQuery,
  CalendarProvider,
  CalendarConnectResponse,
} from "@nexus/contracts";

import { UserSecretBox, type EncryptedUserSecret } from "../security/user-secret-box";

export interface CalendarProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface CalendarProviderClient {
  authorizationUrl(input: { clientId: string; redirectUri: string; state: string }): string;
  exchangeCode(input: { code: string; config: CalendarProviderConfig }, signal: AbortSignal): Promise<{
    accessToken: string;
    refreshToken: string;
    accountId: string;
  }>;
  refreshAccessToken(input: { refreshToken: string; config: CalendarProviderConfig }, signal: AbortSignal): Promise<{
    accessToken: string;
    refreshToken?: string;
  }>;
  listEvents(input: {
    accessToken: string;
    query: CalendarEventsQuery;
    cursor: string | null;
  }, signal: AbortSignal): Promise<{ events: CalendarEvent[]; nextCursor: string | null; cancelledEventIds?: string[] }>;
}

export interface StoredCalendarConnection {
  id: string;
  userId: string;
  provider: CalendarProvider;
  providerAccountId: string;
  status: "active" | "error" | "revoked";
  refreshTokenCiphertext: string;
  refreshTokenIv: string;
  refreshTokenKeyVersion: number;
  syncCursor: string | null;
  syncFrom: string | null;
  syncTo: string | null;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
}

export interface CalendarConnectionRepository {
  createOAuthState(input: {
    id: string;
    userId: string;
    provider: CalendarProvider;
    stateHash: string;
    expiresAt: string;
    createdAt: string;
  }): Promise<void>;
  consumeOAuthState(stateHash: string, provider: CalendarProvider, now: string): Promise<{ id: string; userId: string } | null>;
  upsertConnection(input: {
    id: string;
    userId: string;
    provider: CalendarProvider;
    providerAccountId: string;
    encryptedRefreshToken: EncryptedUserSecret;
    now: string;
  }): Promise<CalendarConnectionSummary>;
  listConnections(userId: string): Promise<CalendarConnectionSummary[]>;
  getConnection(userId: string, connectionId: string): Promise<StoredCalendarConnection | null>;
  markSync(userId: string, connectionId: string, input: {
    status: "active" | "error";
    syncCursor: string | null;
    syncFrom: string | null;
    syncTo: string | null;
    lastSyncedAt: string | null;
    lastErrorCode: string | null;
    now: string;
  }): Promise<CalendarConnectionSummary | null>;
  updateRefreshToken?(userId: string, connectionId: string, encryptedRefreshToken: EncryptedUserSecret, now: string): Promise<void>;
  upsertEvents(userId: string, connectionId: string, events: CalendarEvent[]): Promise<boolean>;
  removeEvents?(userId: string, connectionId: string, providerEventIds: string[]): Promise<void>;
  listEvents(userId: string, query: CalendarEventsQuery): Promise<CalendarEvent[]>;
  revokeConnection(userId: string, connectionId: string, now: string): Promise<boolean>;
}

export class CalendarServiceError extends Error {
  readonly retryable: boolean;

  constructor(readonly code: string, message: string, readonly status: number, retryable = false) {
    super(message);
    this.name = "CalendarServiceError";
    this.retryable = retryable;
  }
}

interface StateToken {
  create(): string;
  hash(value: string): Promise<string>;
}

export interface CalendarServiceOptions {
  now?: () => Date;
  createId?: () => string;
  stateToken?: StateToken;
  secretBox?: UserSecretBox;
  configs?: Partial<Record<CalendarProvider, CalendarProviderConfig>>;
  providers: Partial<Record<CalendarProvider, CalendarProviderClient>>;
}

const STATE_TTL_MS = 10 * 60_000;

function providerIsConfigured(
  provider: CalendarProvider,
  configs: Partial<Record<CalendarProvider, CalendarProviderConfig>>,
  providers: Partial<Record<CalendarProvider, CalendarProviderClient>>,
  stateToken: StateToken | undefined,
  secretBox: UserSecretBox | undefined,
) {
  const config = configs[provider];
  let redirectValid = false;
  if (config?.redirectUri) {
    try {
      const redirect = new URL(config.redirectUri);
      redirectValid = redirect.protocol === "https:" && !redirect.username && !redirect.password && !redirect.search && !redirect.hash;
    } catch {
      redirectValid = false;
    }
  }
  return Boolean(
    config?.clientId.trim()
    && config.clientSecret.trim()
    && redirectValid
    && providers[provider]
    && stateToken
    && secretBox,
  );
}

function abortSignal() {
  return new AbortController().signal;
}

export class CalendarService {
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly stateToken?: StateToken;
  private readonly secretBox?: UserSecretBox;
  private readonly configs: Partial<Record<CalendarProvider, CalendarProviderConfig>>;
  private readonly providers: Partial<Record<CalendarProvider, CalendarProviderClient>>;

  constructor(
    private readonly repository: CalendarConnectionRepository,
    options: CalendarServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.stateToken = options.stateToken;
    this.secretBox = options.secretBox;
    this.configs = options.configs ?? {};
    this.providers = options.providers;
  }

  async startConnection(userId: string, provider: CalendarProvider): Promise<CalendarConnectResponse> {
    if (!providerIsConfigured(provider, this.configs, this.providers, this.stateToken, this.secretBox)) {
      return { provider, status: "unconfigured" };
    }
    const config = this.configs[provider]!;
    const state = this.stateToken!.create();
    const now = this.now();
    await this.repository.createOAuthState({
      id: this.createId(),
      userId,
      provider,
      stateHash: await this.stateToken!.hash(state),
      expiresAt: new Date(now.getTime() + STATE_TTL_MS).toISOString(),
      createdAt: now.toISOString(),
    });
    return {
      provider,
      status: "ready",
      authorization_url: this.providers[provider]!.authorizationUrl({
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        state,
      }),
    };
  }

  async completeOAuth(provider: CalendarProvider, state: string, code: string, signal = abortSignal()) {
    if (!state || state.length > 512 || !code || code.length > 4096 || !providerIsConfigured(provider, this.configs, this.providers, this.stateToken, this.secretBox)) {
      throw new CalendarServiceError("CALENDAR_OAUTH_INVALID", "Calendar authorization is unavailable", 400);
    }
    const stateHash = await this.stateToken!.hash(state);
    const consumed = await this.repository.consumeOAuthState(stateHash, provider, this.now().toISOString());
    if (!consumed) throw new CalendarServiceError("CALENDAR_OAUTH_STATE_INVALID", "Calendar authorization has expired or was already used", 400);
    try {
      const exchanged = await this.providers[provider]!.exchangeCode({ code, config: this.configs[provider]! }, signal);
      if (!exchanged.refreshToken || !exchanged.accountId) throw new Error("CALENDAR_TOKEN_INCOMPLETE");
      const encryptedRefreshToken = await this.secretBox!.encrypt(consumed.userId, `calendar-refresh-token:${provider}:${exchanged.accountId}`, exchanged.refreshToken);
      await this.repository.upsertConnection({
        id: this.createId(),
        userId: consumed.userId,
        provider,
        providerAccountId: exchanged.accountId,
        encryptedRefreshToken,
        now: this.now().toISOString(),
      });
      return { userId: consumed.userId, provider };
    } catch {
      throw new CalendarServiceError("CALENDAR_OAUTH_FAILED", "Calendar authorization could not be completed", 502, true);
    }
  }

  listConnections(userId: string) {
    return this.repository.listConnections(userId);
  }

  async syncConnection(userId: string, connectionId: string, query: CalendarEventsQuery, signal = abortSignal()) {
    const connection = await this.repository.getConnection(userId, connectionId);
    if (!connection) throw new CalendarServiceError("CALENDAR_CONNECTION_NOT_FOUND", "Calendar connection not found", 404);
    if (connection.status === "revoked") throw new CalendarServiceError("CALENDAR_CONNECTION_REVOKED", "Calendar connection has been revoked", 409);
    const config = this.configs[connection.provider];
    const provider = this.providers[connection.provider];
    if (!config || !provider || !this.secretBox) {
      throw new CalendarServiceError("CALENDAR_UNCONFIGURED", "Calendar provider is not configured", 503);
    }
    try {
      const encrypted: EncryptedUserSecret = {
        ciphertext: connection.refreshTokenCiphertext,
        iv: connection.refreshTokenIv,
        keyVersion: connection.refreshTokenKeyVersion,
      };
      const refreshToken = await this.secretBox.decrypt(userId, `calendar-refresh-token:${connection.provider}:${connection.providerAccountId}`, encrypted);
      const access = await provider.refreshAccessToken({ refreshToken, config }, signal);
      if (access.refreshToken && this.repository.updateRefreshToken) {
        const rotated = await this.secretBox.encrypt(userId, `calendar-refresh-token:${connection.provider}:${connection.providerAccountId}`, access.refreshToken);
        await this.repository.updateRefreshToken(userId, connectionId, rotated, this.now().toISOString());
      }
      const sameWindow = connection.syncFrom === query.from && connection.syncTo === query.to;
      const page = await provider.listEvents({ accessToken: access.accessToken, query, cursor: sameWindow ? connection.syncCursor : null }, signal);
      if (page.cancelledEventIds?.length && this.repository.removeEvents) {
        await this.repository.removeEvents(userId, connectionId, page.cancelledEventIds);
      }
      const accepted = await this.repository.upsertEvents(userId, connectionId, page.events);
      if (accepted === false) throw new CalendarServiceError("CALENDAR_CONNECTION_REVOKED", "Calendar connection has been revoked", 409);
      const refreshed = await this.repository.markSync(userId, connectionId, {
        status: "active",
        syncCursor: page.nextCursor,
        syncFrom: query.from,
        syncTo: query.to,
        lastSyncedAt: this.now().toISOString(),
        lastErrorCode: null,
        now: this.now().toISOString(),
      });
      if (refreshed === null) throw new CalendarServiceError("CALENDAR_CONNECTION_REVOKED", "Calendar connection has been revoked", 409);
      return { connection: refreshed, importedCount: page.events.length };
    } catch (error) {
      await this.repository.markSync(userId, connectionId, {
        status: "error",
        syncCursor: connection.syncCursor,
        syncFrom: connection.syncFrom,
        syncTo: connection.syncTo,
        lastSyncedAt: connection.lastSyncedAt,
        lastErrorCode: "CALENDAR_SYNC_FAILED",
        now: this.now().toISOString(),
      });
      if (error instanceof CalendarServiceError && error.code === "CALENDAR_CONNECTION_REVOKED") throw error;
      throw new CalendarServiceError("CALENDAR_SYNC_FAILED", "Calendar synchronization failed; retry is available", 502, true);
    }
  }

  listEvents(userId: string, query: CalendarEventsQuery) {
    return this.repository.listEvents(userId, query);
  }

  async disconnect(userId: string, connectionId: string) {
    const removed = await this.repository.revokeConnection(userId, connectionId, this.now().toISOString());
    if (!removed) throw new CalendarServiceError("CALENDAR_CONNECTION_NOT_FOUND", "Calendar connection not found", 404);
    return { deleted: true as const };
  }
}
