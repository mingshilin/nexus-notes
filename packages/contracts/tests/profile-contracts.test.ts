import { describe, expect, it } from "vitest";
import {
  AccountSessionSchema,
  ChangePasswordInputSchema,
  ProfileSchema,
  UpdateProfileInputSchema,
} from "../src/profile";

describe("profile contracts", () => {
  it("accepts a complete profile and rejects unknown fields", () => {
    const profile = {
      id: "user-1",
      email: "user@example.com",
      display_name: "明实林",
      biography: "记录与整理",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      avatar_url: "/api/v2/profile/avatar",
      updated_at: "2026-08-22T00:00:00.000Z",
    };

    expect(ProfileSchema.parse(profile)).toEqual(profile);
    expect(() => ProfileSchema.parse({ ...profile, password_hash: "secret" })).toThrow();
  });

  it("bounds profile and password changes", () => {
    expect(UpdateProfileInputSchema.parse({ display_name: " User ", locale: "zh-CN", timezone: "Asia/Shanghai" }))
      .toEqual({ display_name: "User", locale: "zh-CN", timezone: "Asia/Shanghai" });
    expect(() => UpdateProfileInputSchema.parse({ biography: "x".repeat(501) })).toThrow();
    expect(() => ChangePasswordInputSchema.parse({ current_password: "x", new_password: "short" })).toThrow();
  });

  it("marks only the caller session as current", () => {
    expect(AccountSessionSchema.parse({
      id: "session-1", current: true, user_agent: "Chrome",
      created_at: "2026-08-22T00:00:00.000Z",
      last_seen_at: "2026-08-22T00:00:00.000Z",
      expires_at: "2026-09-21T00:00:00.000Z",
    }).current).toBe(true);
  });
});
