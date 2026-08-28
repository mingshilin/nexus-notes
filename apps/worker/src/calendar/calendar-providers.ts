import type {
  CalendarEvent,
  CalendarEventsQuery,
  CalendarProvider,
} from "@nexus/contracts";

import type {
  CalendarProviderClient,
  CalendarProviderConfig,
} from "./calendar-service";

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const GOOGLE_HOSTS = new Set(["accounts.google.com", "oauth2.googleapis.com", "www.googleapis.com"]);
const OUTLOOK_HOSTS = new Set(["login.microsoftonline.com", "graph.microsoft.com"]);
const MAX_RESPONSE_BYTES = 1_000_000;
const WINDOWS_TIME_ZONE_MAP: Record<string, string> = {
  "UTC": "UTC",
  "China Standard Time": "Asia/Shanghai",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Tokyo Standard Time": "Asia/Tokyo",
};

function stableEventId(provider: CalendarProvider, providerEventId: string) {
  const source = `${provider}:${providerEventId}`;
  const hashes = [2_166_136_261, 2_169_136_261, 2_172_136_261, 2_175_136_261].map((seed) => {
    let hash = seed;
    for (const character of source) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16_777_619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  });
  return `calendar-${provider}-${hashes.join("")}`;
}

async function readJson(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error("CALENDAR_RESPONSE_TOO_LARGE");
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel("Calendar response exceeded limit").catch(() => undefined);
      throw new Error("CALENDAR_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("CALENDAR_RESPONSE_INVALID");
  }
  if (!response.ok) throw new Error("CALENDAR_PROVIDER_ERROR");
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, max = 4096) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function normalizeTimestamp(value: unknown) {
  const raw = stringValue(value, 128);
  if (!raw) return null;
  const withOffset = /(?:Z|[+-]\d{2}:?\d{2})$/u.test(raw) ? raw : `${raw}Z`;
  const timestamp = Date.parse(withOffset);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function localClockMs(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/u.exec(value);
  if (!match) return null;
  const milliseconds = Number((match[7]?.slice(0, 3) ?? "").padEnd(3, "0") || 0);
  const wallMs = Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6] ?? 0), milliseconds,
  );
  return Number.isFinite(wallMs) ? wallMs : null;
}

function formattedWallClockMs(instantMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs));
  const values = new Map(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return Date.UTC(values.get("year")!, values.get("month")! - 1, values.get("day")!, values.get("hour")!, values.get("minute")!, values.get("second")!);
}

function normalizeLocalTimestamp(value: unknown, requestedTimeZone: unknown) {
  const raw = stringValue(value, 128);
  if (!raw) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/u.test(raw)) return normalizeTimestamp(raw);
  const wallMs = localClockMs(raw);
  if (wallMs === null) return null;
  const timeZone = WINDOWS_TIME_ZONE_MAP[stringValue(requestedTimeZone, 128) ?? "UTC"] ?? stringValue(requestedTimeZone, 128) ?? "UTC";
  try {
    const targetSecond = Math.floor(wallMs / 1000) * 1000;
    const candidates: number[] = [];
    for (let hours = -14; hours <= 14; hours += 1) {
      const instant = targetSecond + hours * 60 * 60 * 1000;
      const shown = formattedWallClockMs(instant, timeZone);
      const offset = shown - instant;
      const candidate = wallMs - offset;
      if (formattedWallClockMs(candidate, timeZone) === targetSecond) candidates.push(candidate);
    }
    if (candidates.length > 0) return new Date(Math.min(...candidates) + (wallMs - targetSecond)).toISOString();

    // A wall time in a DST gap does not have a direct candidate. Choose the
    // first valid instant after the requested local time, per calendar rules.
    let previous = targetSecond - 14 * 60 * 60 * 1000;
    let previousShown = formattedWallClockMs(previous, timeZone);
    for (let index = 1; index <= 28 * 60; index += 1) {
      const current = previous + 60_000;
      const currentShown = formattedWallClockMs(current, timeZone);
      if (currentShown >= targetSecond && previousShown < targetSecond) {
        let low = previous;
        let high = current;
        for (let step = 0; step < 32; step += 1) {
          const middle = Math.floor((low + high) / 2);
          if (formattedWallClockMs(middle, timeZone) >= targetSecond) high = middle;
          else low = middle;
        }
        return new Date(high + (wallMs - targetSecond)).toISOString();
      }
      previous = current;
      previousShown = currentShown;
    }
  } catch {
    // Unknown provider time zones are treated as UTC rather than aborting the
    // entire import; the original provider value remains visible in metadata.
    return new Date(wallMs).toISOString();
  }
  return new Date(wallMs).toISOString();
}

function normalizeDate(value: unknown) {
  const raw = stringValue(value, 32);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return null;
  const timestamp = Date.parse(`${raw}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function providerStatus(value: unknown, cancelled: boolean): CalendarEvent["status"] {
  if (cancelled || value === "cancelled") return "cancelled";
  return value === "tentative" ? "tentative" : "confirmed";
}

function googleEvent(provider: "google", raw: Record<string, unknown>): CalendarEvent | null {
  const providerEventId = stringValue(raw.id, 512);
  const start = raw.start && typeof raw.start === "object" ? raw.start as Record<string, unknown> : {};
  const end = raw.end && typeof raw.end === "object" ? raw.end as Record<string, unknown> : {};
  const allDay = typeof start.date === "string";
  const startsAt = allDay ? normalizeDate(start.date) : normalizeLocalTimestamp(start.dateTime, start.timeZone);
  const endsAt = allDay ? normalizeDate(end.date) : normalizeLocalTimestamp(end.dateTime, end.timeZone ?? start.timeZone);
  if (!providerEventId || !startsAt || !endsAt) return null;
  const timeZone = stringValue(start.timeZone, 64) ?? "UTC";
  return {
    id: stableEventId(provider, providerEventId),
    connection_id: "pending",
    provider,
    provider_event_id: providerEventId,
    title: (stringValue(raw.summary, 240) ?? "").slice(0, 240),
    starts_at: startsAt,
    ends_at: endsAt,
    timezone: timeZone,
    all_day: allDay,
    status: providerStatus(raw.status, false),
    updated_at: normalizeTimestamp(raw.updated) ?? new Date().toISOString(),
  };
}

function outlookEvent(provider: "outlook", raw: Record<string, unknown>): CalendarEvent | null {
  const providerEventId = stringValue(raw.id, 512);
  const start = raw.start && typeof raw.start === "object" ? raw.start as Record<string, unknown> : {};
  const end = raw.end && typeof raw.end === "object" ? raw.end as Record<string, unknown> : {};
  const startsAt = normalizeLocalTimestamp(start.dateTime, start.timeZone);
  const endsAt = normalizeLocalTimestamp(end.dateTime, end.timeZone ?? start.timeZone);
  if (!providerEventId || !startsAt || !endsAt) return null;
  return {
    id: stableEventId(provider, providerEventId),
    connection_id: "pending",
    provider,
    provider_event_id: providerEventId,
    title: (stringValue(raw.subject, 240) ?? "").slice(0, 240),
    starts_at: startsAt,
    ends_at: endsAt,
    timezone: stringValue(start.timeZone, 64) ?? "UTC",
    all_day: raw.isAllDay === true,
    status: providerStatus(raw.showAs, raw.isCancelled === true),
    updated_at: normalizeTimestamp(raw.lastModifiedDateTime) ?? new Date().toISOString(),
  };
}

function trustedNextLink(value: unknown, host: string) {
  const raw = stringValue(value, 4096);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === host && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

class HttpCalendarProvider implements CalendarProviderClient {
  constructor(
    private readonly provider: "google" | "outlook",
    private readonly endpoints: {
      authorization: string;
      token: string;
      account: string;
      events: string;
      host: string;
      scope: string;
    },
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  authorizationUrl(input: { clientId: string; redirectUri: string; state: string }) {
    const url = new URL(this.endpoints.authorization);
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", input.state);
    url.searchParams.set("scope", this.endpoints.scope);
    if (this.provider === "google") {
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
    }
    return url.toString();
  }

  async exchangeCode(input: { code: string; config: CalendarProviderConfig }, signal: AbortSignal) {
    const body = new URLSearchParams({
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      code: input.code,
      redirect_uri: input.config.redirectUri,
      grant_type: "authorization_code",
    });
    const token = await this.postForm(this.endpoints.token, body, signal);
    const accessToken = stringValue(token.access_token, 4096);
    const refreshToken = stringValue(token.refresh_token, 4096);
    if (!accessToken || !refreshToken) throw new Error("CALENDAR_TOKEN_INCOMPLETE");
    const account = await this.accountId(accessToken, signal);
    if (!account) throw new Error("CALENDAR_ACCOUNT_UNAVAILABLE");
    return { accessToken, refreshToken, accountId: account };
  }

  async refreshAccessToken(input: { refreshToken: string; config: CalendarProviderConfig }, signal: AbortSignal) {
    const body = new URLSearchParams({
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    });
    const token = await this.postForm(this.endpoints.token, body, signal);
    const accessToken = stringValue(token.access_token, 4096);
    if (!accessToken) throw new Error("CALENDAR_ACCESS_TOKEN_UNAVAILABLE");
    const refreshToken = stringValue(token.refresh_token, 4096) ?? undefined;
    return { accessToken, ...(refreshToken ? { refreshToken } : {}) };
  }

  async listEvents(input: { accessToken: string; query: CalendarEventsQuery; cursor: string | null }, signal: AbortSignal) {
    const googlePageToken = this.provider === "google" && input.cursor?.startsWith("google:page:")
      ? input.cursor.slice("google:page:".length)
      : null;
    const googleSyncToken = this.provider === "google" && input.cursor?.startsWith("google:sync:")
      ? input.cursor.slice("google:sync:".length)
      : null;
    if (this.provider === "google" && input.cursor && !googlePageToken && !googleSyncToken) throw new Error("CALENDAR_CURSOR_INVALID");
    const url = input.cursor && this.provider === "outlook" ? trustedNextLink(input.cursor, this.endpoints.host) : null;
    if (this.provider === "outlook" && input.cursor && !url) throw new Error("CALENDAR_CURSOR_INVALID");
    const eventsUrl = url ? new URL(url) : new URL(this.endpoints.events);
    if (!url) {
      if (this.provider === "google") {
        if (googleSyncToken) eventsUrl.searchParams.set("syncToken", googleSyncToken);
        else {
          eventsUrl.searchParams.set("timeMin", `${input.query.from}T00:00:00.000Z`);
          eventsUrl.searchParams.set("timeMax", `${input.query.to}T23:59:59.999Z`);
          eventsUrl.searchParams.set("orderBy", "startTime");
        }
        eventsUrl.searchParams.set("singleEvents", "true");
        eventsUrl.searchParams.set("showDeleted", "true");
        eventsUrl.searchParams.set("maxResults", "500");
        if (googlePageToken) eventsUrl.searchParams.set("pageToken", googlePageToken);
      } else {
        eventsUrl.searchParams.set("startDateTime", `${input.query.from}T00:00:00.000Z`);
        eventsUrl.searchParams.set("endDateTime", `${input.query.to}T23:59:59.999Z`);
        eventsUrl.searchParams.set("$top", "500");
      }
    }
    if (!GOOGLE_HOSTS.has(eventsUrl.hostname) && !OUTLOOK_HOSTS.has(eventsUrl.hostname)) throw new Error("CALENDAR_ENDPOINT_UNTRUSTED");
    const raw = await this.getJson(eventsUrl, input.accessToken, signal);
    const values = this.provider === "google" ? raw.items : raw.value;
    const items = Array.isArray(values) ? values : [];
    const events = items
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      .map((item) => this.provider === "google" ? googleEvent("google", item) : outlookEvent("outlook", item))
      .filter((item): item is CalendarEvent => item !== null)
      .slice(0, 500);
    const nextCursor = this.provider === "google"
      ? stringValue(raw.nextPageToken, 4096)
        ? `google:page:${stringValue(raw.nextPageToken, 4096)}`
        : stringValue(raw.nextSyncToken, 4096)
          ? `google:sync:${stringValue(raw.nextSyncToken, 4096)}`
          : null
      : trustedNextLink(raw["@odata.nextLink"], this.endpoints.host)
        ?? trustedNextLink(raw["@odata.deltaLink"], this.endpoints.host);
    return { events, nextCursor };
  }

  private async accountId(accessToken: string, signal: AbortSignal) {
    const raw = await this.getJson(new URL(this.endpoints.account), accessToken, signal);
    return stringValue(raw.sub, 512) ?? stringValue(raw.id, 512) ?? stringValue(raw.email, 512) ?? stringValue(raw.userPrincipalName, 512);
  }

  private async postForm(endpoint: string, body: URLSearchParams, signal: AbortSignal) {
    const url = new URL(endpoint);
    if (!((this.provider === "google" && GOOGLE_HOSTS.has(url.hostname)) || (this.provider === "outlook" && OUTLOOK_HOSTS.has(url.hostname)))) {
      throw new Error("CALENDAR_ENDPOINT_UNTRUSTED");
    }
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal,
      redirect: "error",
    });
    return readJson(response);
  }

  private async getJson(url: URL, accessToken: string, signal: AbortSignal) {
    const response = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal,
      redirect: "error",
    });
    return readJson(response);
  }
}

export function createGoogleCalendarProvider(fetchImpl?: FetchImpl) {
  return new HttpCalendarProvider("google", {
    authorization: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    account: "https://www.googleapis.com/oauth2/v3/userinfo",
    events: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    host: "www.googleapis.com",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
  }, fetchImpl);
}

export function createOutlookCalendarProvider(fetchImpl?: FetchImpl) {
  return new HttpCalendarProvider("outlook", {
    authorization: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    account: "https://graph.microsoft.com/v1.0/me",
    events: "https://graph.microsoft.com/v1.0/me/calendarView/delta",
    host: "graph.microsoft.com",
    scope: "offline_access https://graph.microsoft.com/Calendars.Read",
  }, fetchImpl);
}
