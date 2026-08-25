import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkRemoteDeploy,
  INITIAL_CHUNK_BUDGET_BYTES,
} from "../../scripts/verify-deploy-readiness.mjs";

const baseUrl = "https://beta.example";
const securityHeaders = {
  "content-security-policy": "default-src 'self'",
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=()",
  "x-frame-options": "DENY",
};

afterEach(() => vi.unstubAllGlobals());

describe("online deploy readiness", () => {
  it("uses the exact decimal Vite warning threshold", () => {
    expect(INITIAL_CHUNK_BUDGET_BYTES).toBe(500_000);
  });

  it("accepts the Beta health route and verifies browser security headers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.origin === baseUrl && url.pathname === "/") {
        return new Response('<script type="module" src="/assets/main.js"></script>', {
          status: 200,
          headers: securityHeaders,
        });
      }
      if (url.href === `${baseUrl}/assets/main.js`) {
        return new Response(new Uint8Array(10), { status: 200 });
      }
      if (url.href === `${baseUrl}/api/v2/health`) {
        return new Response(JSON.stringify({ success: true, data: { status: "ok", version: "preview", ocr: "ready" } }), {
          status: 200,
          headers: { "content-type": "application/json", ...securityHeaders },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkRemoteDeploy(baseUrl);

    expect(result.healthPath).toBe("/api/v2/health");
    expect("healthConfigured" in result).toBe(false);
    expect(result.healthStatus).toBe("ok");
    expect(result.healthOcr).toBe("ready");
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(`${baseUrl}/api/v2/health`);
  });

  it("fetches a fresh HTML shell for online verification", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.origin === baseUrl && url.pathname === "/") {
        expect(url.searchParams.has("_deploy_check")).toBe(true);
        return new Response('<script type="module" src="/assets/main.js"></script>', {
          status: 200,
          headers: securityHeaders,
        });
      }
      if (url.href === `${baseUrl}/assets/main.js`) {
        return new Response(new Uint8Array(10), { status: 200 });
      }
      if (url.href === `${baseUrl}/api/v2/health`) {
        return new Response(JSON.stringify({ success: true, data: { status: "ok" } }), {
          status: 200,
          headers: { "content-type": "application/json", ...securityHeaders },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkRemoteDeploy(baseUrl)).resolves.toMatchObject({ healthPath: "/api/v2/health" });
  });
});
