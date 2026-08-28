import { describe, expect, it } from "vitest";
import { resolveCalendarConfig } from "../src/bootstrap";

const base = {
  APP_BASE_URL: "https://notes.example",
  GOOGLE_CALENDAR_CLIENT_ID: "google-client",
  GOOGLE_CALENDAR_CLIENT_SECRET: "google-secret",
  OUTLOOK_CALENDAR_CLIENT_ID: "outlook-client",
  OUTLOOK_CALENDAR_CLIENT_SECRET: "outlook-secret",
};

describe("calendar configuration", () => {
  it("selects provider-specific redirect URIs and rejects a legacy URI for another provider", () => {
    expect(resolveCalendarConfig({ ...base, CALENDAR_OAUTH_REDIRECT_URI: "https://notes.example/api/v2/calendar/oauth/google/callback" }, "google"))
      .toMatchObject({ clientId: "google-client" });
    expect(resolveCalendarConfig({ ...base, CALENDAR_OAUTH_REDIRECT_URI: "https://notes.example/api/v2/calendar/oauth/google/callback" }, "outlook"))
      .toBeUndefined();
    expect(resolveCalendarConfig({ ...base, OUTLOOK_CALENDAR_REDIRECT_URI: "https://notes.example/api/v2/calendar/oauth/outlook/callback" }, "outlook"))
      .toMatchObject({ clientId: "outlook-client" });
  });
});
