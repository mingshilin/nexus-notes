import { describe, expect, it } from "vitest";
import { detectAvatarMimeType, normalizeProfilePatch } from "../src/profile";

describe("profile domain", () => {
  it("normalizes supported profile values", () => {
    expect(normalizeProfilePatch({ display_name: "  User  ", biography: "  Bio  ", locale: "zh-CN", timezone: "Asia/Shanghai" }))
      .toEqual({ display_name: "User", biography: "Bio", locale: "zh-CN", timezone: "Asia/Shanghai" });
  });

  it("detects real avatar bytes instead of trusting Content-Type", () => {
    expect(detectAvatarMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectAvatarMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectAvatarMimeType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
});
