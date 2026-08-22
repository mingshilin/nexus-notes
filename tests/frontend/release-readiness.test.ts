import { afterEach, describe, expect, it, vi } from "vitest";

import { checkRemoteDeploy } from "../../scripts/verify-deploy-readiness.mjs";

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
  it("accepts the Beta health route and verifies browser security headers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${baseUrl}/`) {
        return new Response('<script type="module" src="/assets/main.js"></script>', {
          status: 200,
          headers: securityHeaders,
        });
      }
      if (url === `${baseUrl}/assets/main.js`) {
        return new Response(new Uint8Array(10), { status: 200 });
      }
      if (url === `${baseUrl}/api/v2/health`) {
        return new Response(JSON.stringify({ success: true, data: { status: "ok", version: "preview" } }), {
          status: 200,
          headers: { "content-type": "application/json", ...securityHeaders },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkRemoteDeploy(baseUrl);

    expect(result.healthPath).toBe("/api/v2/health");
    expect(result.healthConfigured).toBe(false);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(`${baseUrl}/api/v2/health`);
  });
});
