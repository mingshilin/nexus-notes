import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_INVALID_EVENT, request } from "@/api/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("can suppress expected auth invalid events for bootstrap auth checks", async () => {
    const listener = vi.fn();
    window.addEventListener(AUTH_INVALID_EVENT, listener);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "auth required" } }),
      { status: 401, headers: { "content-type": "application/json" } },
    ))));

    await expect(request("/api/auth/me", { suppressAuthInvalid: true })).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_INVALID_EVENT, listener);
  });

  it("emits auth invalid events for real unauthorized API calls", async () => {
    const listener = vi.fn();
    window.addEventListener(AUTH_INVALID_EVENT, listener);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "auth required" } }),
      { status: 401, headers: { "content-type": "application/json" } },
    ))));

    await expect(request("/api/notes")).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_INVALID_EVENT, listener);
  });
});
