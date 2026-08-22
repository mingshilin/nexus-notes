import { describe, expect, it, vi } from "vitest";

import { createBetaWorker } from "../src/bootstrap";

describe("Beta static asset gateway", () => {
  it("serves the app shell through the secure gateway", async () => {
    const assetFetch = vi.fn(async () => new Response("<html>beta</html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }));
    const worker = createBetaWorker({ logger: { log: vi.fn() } });
    const response = await worker.fetch(new Request("https://beta.test/"), {
      DB: {} as D1Database,
      ASSETS: { fetch: assetFetch } as unknown as Fetcher,
      APP_BASE_URL: "https://beta.test",
      RATE_LIMIT_SECRET: "r".repeat(32),
      TURNSTILE_SECRET_KEY: "",
      RESEND_API_KEY: "",
      EMAIL_FROM: "preview@example.test",
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>beta</html>");
    expect(assetFetch).toHaveBeenCalledOnce();
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
  });
});
