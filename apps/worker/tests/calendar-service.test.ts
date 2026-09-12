import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent, CalendarProvider, CalendarEventsQuery } from "@nexus/contracts";
import { UserSecretBox } from "../src/security/user-secret-box";
import { CalendarService, type CalendarConnectionRepository, type CalendarProviderClient } from "../src/calendar/calendar-service";

const now = "2026-08-28T00:00:00.000Z";

function repository(): CalendarConnectionRepository & {
  states: Array<{ stateHash: string; provider: CalendarProvider; userId: string }>;
  connections: Array<Record<string, unknown>>;
  events: CalendarEvent[];
} {
  const value = {
    states: [] as Array<{ stateHash: string; provider: CalendarProvider; userId: string }>,
    connections: [] as Array<Record<string, unknown>>,
    events: [] as CalendarEvent[],
    createOAuthState: vi.fn(async (input: { stateHash: string; provider: CalendarProvider; userId: string }) => { value.states.push(input); }),
    consumeOAuthState: vi.fn(async (stateHash: string, provider: CalendarProvider) => {
      const state = value.states.find((item) => item.stateHash === stateHash && item.provider === provider);
      if (!state) return null;
      value.states.splice(value.states.indexOf(state), 1);
      return { id: "oauth-1", userId: state.userId };
    }),
    upsertConnection: vi.fn(async (input: Record<string, unknown>) => {
      value.connections.push(input);
      return { id: input.id, provider: input.provider, status: "active", last_synced_at: null, last_error_code: null };
    }),
    listConnections: vi.fn(async (userId: string) => value.connections.filter((item) => item.userId === userId).map((item) => ({ id: item.id, provider: item.provider, status: "active", last_synced_at: null, last_error_code: null }))),
    getConnection: vi.fn(async (userId: string, id: string) => value.connections.find((item) => item.userId === userId && item.id === id) ?? null),
    markSync: vi.fn(async (userId: string, connectionId: string, input: { status: string; syncCursor: string | null; syncFrom: string | null; syncTo: string | null; lastSyncedAt: string | null; lastErrorCode: string | null }) => {
      const connection = value.connections.find((item) => item.userId === userId && item.id === connectionId);
      if (!connection) return null;
      Object.assign(connection, { status: input.status, syncCursor: input.syncCursor, syncFrom: input.syncFrom, syncTo: input.syncTo, lastSyncedAt: input.lastSyncedAt, lastErrorCode: input.lastErrorCode });
      return { id: connectionId, provider: connection.provider, status: input.status, last_synced_at: input.lastSyncedAt, last_error_code: input.lastErrorCode };
    }),
    upsertEvents: vi.fn(async (items: CalendarEvent[]) => { value.events = items; }),
    removeEvents: vi.fn(async () => undefined),
    listEvents: vi.fn(async (userId: string, query: CalendarEventsQuery) => value.events.filter((item) => item.starts_at.slice(0, 10) >= query.from && item.starts_at.slice(0, 10) <= query.to && value.connections.some((connection) => connection.id === item.connection_id && connection.userId === userId))),
    updateRefreshToken: vi.fn(async () => undefined),
    revokeConnection: vi.fn(async () => true),
  };
  return value;
}

function provider(): CalendarProviderClient {
  return {
    authorizationUrl: vi.fn((input) => `https://calendar.example/authorize?state=${encodeURIComponent(input.state)}`),
    exchangeCode: vi.fn(async () => ({ accessToken: "access", refreshToken: "refresh", accountId: "account-1" })),
    refreshAccessToken: vi.fn(async () => ({ accessToken: "access" })),
    listEvents: vi.fn(async () => ({ events: [], nextCursor: null })),
  };
}

describe("CalendarService", () => {
  it("returns an explicit unconfigured result without creating OAuth state", async () => {
    const repo = repository();
    const service = new CalendarService(repo, { now: () => new Date(now), providers: { google: provider() } });

    await expect(service.startConnection("user-1", "google")).resolves.toEqual({ provider: "google", status: "unconfigured" });
    expect(repo.createOAuthState).not.toHaveBeenCalled();
  });

  it("rejects an unsafe OAuth redirect URI as unconfigured", async () => {
    const repo = repository();
    const service = new CalendarService(repo, {
      providers: { google: provider() },
      stateToken: { create: () => "state", hash: async (value: string) => value },
      secretBox: new UserSecretBox("calendar-secret-with-at-least-32-characters"),
      configs: { google: { clientId: "client", clientSecret: "secret", redirectUri: "https://notes.example/callback?next=https://evil.example" } },
    });
    await expect(service.startConnection("user-1", "google")).resolves.toEqual({ provider: "google", status: "unconfigured" });
  });

  it("creates a one-time provider-bound OAuth state and exchanges it into an encrypted connection", async () => {
    const repo = repository();
    const google = provider();
    const service = new CalendarService(repo, {
      now: () => new Date(now),
      createId: () => "connection-1",
      stateToken: { create: () => "raw-state", hash: async (value: string) => `hash:${value}` },
      secretBox: new UserSecretBox("calendar-secret-with-at-least-32-characters"),
      providers: { google },
      configs: { google: { clientId: "client-1", clientSecret: "client-secret", redirectUri: "https://notes.example/calendar/callback" } },
    });

    await expect(service.startConnection("user-1", "google")).resolves.toMatchObject({ provider: "google", status: "ready", authorization_url: expect.stringContaining("raw-state") });
    expect(repo.createOAuthState).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", provider: "google", stateHash: "hash:raw-state" }));

    await expect(service.completeOAuth("google", "raw-state", "code-1")).resolves.toEqual({ userId: "user-1", provider: "google" });
    expect(google.exchangeCode).toHaveBeenCalledWith(expect.objectContaining({ code: "code-1" }), expect.any(AbortSignal));
    expect(repo.upsertConnection).toHaveBeenCalledWith(expect.objectContaining({ id: "connection-1", userId: "user-1", provider: "google" }));
    const saved = repo.connections[0]!;
    expect(saved.refreshToken).toBeUndefined();
    const encrypted = saved.encryptedRefreshToken as { ciphertext: string };
    expect(encrypted.ciphertext).toBeTypeOf("string");
    expect(encrypted.ciphertext).not.toContain("refresh");
  });

  it("keeps event reads user-scoped and marks a failed sync without leaking provider errors", async () => {
    const repo = repository();
    const google = provider();
    const service = new CalendarService(repo, {
      now: () => new Date(now),
      secretBox: new UserSecretBox("calendar-secret-with-at-least-32-characters"),
      providers: { google },
      configs: { google: { clientId: "client-1", clientSecret: "client-secret", redirectUri: "https://notes.example/calendar/callback" } },
    });
    repo.connections.push({ id: "connection-1", userId: "user-1", provider: "google", refreshTokenCiphertext: "", refreshTokenIv: "", refreshTokenKeyVersion: 1 });
    await expect(service.listEvents("user-2", { from: "2026-08-28", to: "2026-08-28" })).resolves.toEqual([]);
    google.refreshAccessToken = vi.fn(async () => { throw new Error("provider secret must not escape"); });
    await expect(service.syncConnection("user-1", "connection-1", { from: "2026-08-28", to: "2026-08-28" })).rejects.toMatchObject({ code: "CALENDAR_SYNC_FAILED", status: 502 });
    expect(repo.markSync).toHaveBeenCalledWith("user-1", "connection-1", expect.objectContaining({ status: "error", lastErrorCode: "CALENDAR_SYNC_FAILED" }));
  });

  it("does not sync or expose events from a revoked connection", async () => {
    const repo = repository();
    const google = provider();
    const service = new CalendarService(repo, {
      now: () => new Date(now),
      secretBox: new UserSecretBox("calendar-secret-with-at-least-32-characters"),
      providers: { google },
      configs: { google: { clientId: "client-1", clientSecret: "client-secret", redirectUri: "https://notes.example/calendar/callback" } },
    });
    repo.connections.push({ id: "connection-revoked", userId: "user-1", provider: "google", status: "revoked", refreshTokenCiphertext: "", refreshTokenIv: "", refreshTokenKeyVersion: 1 });
    await expect(service.syncConnection("user-1", "connection-revoked", { from: "2026-08-28", to: "2026-08-28" })).rejects.toMatchObject({ code: "CALENDAR_CONNECTION_REVOKED", status: 409 });
    expect(google.refreshAccessToken).not.toHaveBeenCalled();
    await expect(service.listEvents("user-1", { from: "2026-08-28", to: "2026-08-28" })).resolves.toEqual([]);
  });

  it("resets a stored cursor when the requested window changes", async () => {
    const repo = repository();
    const google = provider();
    google.refreshAccessToken = vi.fn(async () => ({ accessToken: "access" }));
    google.listEvents = vi.fn(async ({ cursor }) => ({ events: [], nextCursor: cursor ? "next-2" : "next-1" }));
    const service = new CalendarService(repo, {
      now: () => new Date(now),
      secretBox: new UserSecretBox("calendar-secret-with-at-least-32-characters"),
      providers: { google },
      configs: { google: { clientId: "client-1", clientSecret: "client-secret", redirectUri: "https://notes.example/calendar/callback" } },
    });
    const box = new UserSecretBox("calendar-secret-with-at-least-32-characters");
    const encrypted = await box.encrypt("user-1", "calendar-refresh-token:google:account-1", "refresh");
    repo.connections.push({ id: "connection-1", userId: "user-1", provider: "google", providerAccountId: "account-1", status: "active", refreshTokenCiphertext: encrypted.ciphertext, refreshTokenIv: encrypted.iv, refreshTokenKeyVersion: encrypted.keyVersion, syncCursor: "google:sync:old", syncFrom: "2026-08-01", syncTo: "2026-08-31", lastSyncedAt: null });
    await service.syncConnection("user-1", "connection-1", { from: "2026-08-01", to: "2026-08-31" });
    await service.syncConnection("user-1", "connection-1", { from: "2026-09-01", to: "2026-09-30" });
    expect(google.listEvents).toHaveBeenNthCalledWith(1, expect.objectContaining({ cursor: "google:sync:old" }), expect.any(AbortSignal));
    expect(google.listEvents).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: null }), expect.any(AbortSignal));
  });

  it("removes provider cancellation tombstones instead of retaining stale events", async () => {
    const repo = repository();
    const google = provider();
    google.refreshAccessToken = vi.fn(async () => ({ accessToken: "access" }));
    google.listEvents = vi.fn(async () => ({ events: [], nextCursor: null, cancelledEventIds: ["provider-event-cancelled"] }));
    const service = new CalendarService(repo, {
      now: () => new Date(now),
      secretBox: new UserSecretBox("calendar-secret-with-at-least-32-characters"),
      providers: { google },
      configs: { google: { clientId: "client-1", clientSecret: "client-secret", redirectUri: "https://notes.example/calendar/callback" } },
    });
    const box = new UserSecretBox("calendar-secret-with-at-least-32-characters");
    const encrypted = await box.encrypt("user-1", "calendar-refresh-token:google:account-1", "refresh");
    repo.connections.push({ id: "connection-1", userId: "user-1", provider: "google", providerAccountId: "account-1", status: "active", refreshTokenCiphertext: encrypted.ciphertext, refreshTokenIv: encrypted.iv, refreshTokenKeyVersion: encrypted.keyVersion, syncCursor: null, syncFrom: null, syncTo: null, lastSyncedAt: null });
    await service.syncConnection("user-1", "connection-1", { from: "2026-08-28", to: "2026-08-28" });
    expect(repo.removeEvents).toHaveBeenCalledWith("user-1", "connection-1", ["provider-event-cancelled"]);
  });

  it("encrypts and persists a rotated refresh token without exposing it", async () => {
    const repo = repository();
    const google = provider();
    google.refreshAccessToken = vi.fn(async () => ({ accessToken: "access", refreshToken: "rotated-refresh" }));
    google.listEvents = vi.fn(async () => ({ events: [], nextCursor: null }));
    const service = new CalendarService(repo, {
      now: () => new Date(now),
      secretBox: new UserSecretBox("calendar-secret-with-at-least-32-characters"),
      providers: { google },
      configs: { google: { clientId: "client-1", clientSecret: "client-secret", redirectUri: "https://notes.example/calendar/callback" } },
    });
    const box = new UserSecretBox("calendar-secret-with-at-least-32-characters");
    const encrypted = await box.encrypt("user-1", "calendar-refresh-token:google:account-1", "refresh");
    repo.connections.push({ id: "connection-1", userId: "user-1", provider: "google", providerAccountId: "account-1", status: "active", refreshTokenCiphertext: encrypted.ciphertext, refreshTokenIv: encrypted.iv, refreshTokenKeyVersion: encrypted.keyVersion, syncCursor: null, lastSyncedAt: null });
    await service.syncConnection("user-1", "connection-1", { from: "2026-08-28", to: "2026-08-28" });
    expect(repo.updateRefreshToken).toHaveBeenCalledWith("user-1", "connection-1", expect.objectContaining({ ciphertext: expect.not.stringContaining("rotated-refresh") }), now);
  });
});
