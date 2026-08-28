import { describe, expect, it, vi } from "vitest";
import { createGoogleCalendarProvider, createOutlookCalendarProvider } from "../src/calendar/calendar-providers";

const config = { clientId: "client-1", clientSecret: "secret-1", redirectUri: "https://notes.example/calendar/callback" };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("calendar providers", () => {
  it("builds a bounded Google authorization URL and normalizes events", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access", refresh_token: "refresh" }))
      .mockResolvedValueOnce(response({ sub: "google-account" }))
      .mockResolvedValueOnce(response({ items: [{ id: "event-1", summary: "Review", start: { dateTime: "2026-08-28T01:00:00Z", timeZone: "UTC" }, end: { dateTime: "2026-08-28T02:00:00Z" }, status: "confirmed" }], nextPageToken: "next" }));
    const provider = createGoogleCalendarProvider(fetchImpl);
    const url = provider.authorizationUrl({ clientId: config.clientId, redirectUri: config.redirectUri, state: "raw state" });
    expect(new URL(url).hostname).toBe("accounts.google.com");
    expect(new URL(url).searchParams.get("state")).toBe("raw state");
    const exchanged = await provider.exchangeCode({ code: "code-1", config }, new AbortController().signal);
    expect(exchanged).toMatchObject({ accessToken: "access", refreshToken: "refresh", accountId: "google-account" });
    const page = await provider.listEvents({ accessToken: "access", query: { from: "2026-08-28", to: "2026-08-28" }, cursor: null }, new AbortController().signal);
    expect(page.nextCursor).toBe("google:page:next");
    expect(page.events[0]).toMatchObject({ provider: "google", provider_event_id: "event-1", title: "Review", all_day: false, status: "confirmed" });
    expect(fetchImpl.mock.calls.every(([input]) => new URL(String(input)).hostname.endsWith("googleapis.com") || new URL(String(input)).hostname === "accounts.google.com")).toBe(true);
  });

  it("uses Outlook calendarView and rejects an untrusted next link", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access", refresh_token: "refresh" }))
      .mockResolvedValueOnce(response({ id: "outlook-account" }))
      .mockResolvedValueOnce(response({ value: [{ id: "event-1", subject: "Planning", start: { dateTime: "2026-08-28T01:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-08-28T02:00:00.0000000", timeZone: "UTC" }, isAllDay: false, isCancelled: false, showAs: "tentative" }], "@odata.nextLink": "https://evil.example/events" }));
    const provider = createOutlookCalendarProvider(fetchImpl);
    const exchanged = await provider.exchangeCode({ code: "code-1", config }, new AbortController().signal);
    expect(exchanged.accountId).toBe("outlook-account");
    const page = await provider.listEvents({ accessToken: "access", query: { from: "2026-08-28", to: "2026-08-28" }, cursor: null }, new AbortController().signal);
    expect(page.nextCursor).toBeNull();
    expect(page.events[0]).toMatchObject({ provider: "outlook", title: "Planning", all_day: false, status: "tentative" });
    const eventRequest = fetchImpl.mock.calls[2]![0];
    expect(String(eventRequest)).toContain("graph.microsoft.com");
  });

  it("resolves Outlook DST gaps to the next valid time and overlaps to the earlier occurrence", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access", refresh_token: "refresh" }))
      .mockResolvedValueOnce(response({ id: "outlook-account" }))
      .mockResolvedValueOnce(response({ value: [
        { id: "gap", subject: "Gap", start: { dateTime: "2026-03-08T02:30:00", timeZone: "America/New_York" }, end: { dateTime: "2026-03-08T03:30:00", timeZone: "America/New_York" }, isAllDay: false, isCancelled: false },
        { id: "overlap", subject: "Overlap", start: { dateTime: "2026-11-01T01:30:00", timeZone: "America/New_York" }, end: { dateTime: "2026-11-01T02:30:00", timeZone: "America/New_York" }, isAllDay: false, isCancelled: false },
      ] }));
    const provider = createOutlookCalendarProvider(fetchImpl);
    await provider.exchangeCode({ code: "code-1", config }, new AbortController().signal);
    const page = await provider.listEvents({ accessToken: "access", query: { from: "2026-03-08", to: "2026-11-01" }, cursor: null }, new AbortController().signal);
    expect(page.events.find((event) => event.provider_event_id === "gap")?.starts_at).toBe("2026-03-08T07:00:00.000Z");
    expect(page.events.find((event) => event.provider_event_id === "overlap")?.starts_at).toBe("2026-11-01T05:30:00.000Z");
  });

  it("parses Google local dateTime values with the event timezone", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ access_token: "access", refresh_token: "refresh" }))
      .mockResolvedValueOnce(response({ sub: "google-account" }))
      .mockResolvedValueOnce(response({ items: [{ id: "event-local", summary: "Local", start: { dateTime: "2026-08-28T09:00:00", timeZone: "Asia/Shanghai" }, end: { dateTime: "2026-08-28T10:00:00", timeZone: "Asia/Shanghai" } }] }));
    const provider = createGoogleCalendarProvider(fetchImpl);
    await provider.exchangeCode({ code: "code-1", config }, new AbortController().signal);
    const page = await provider.listEvents({ accessToken: "access", query: { from: "2026-08-28", to: "2026-08-28" }, cursor: null }, new AbortController().signal);
    expect(page.events[0]?.starts_at).toBe("2026-08-28T01:00:00.000Z");
  });
});
