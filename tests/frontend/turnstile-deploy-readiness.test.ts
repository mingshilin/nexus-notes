import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertTurnstileBundle,
  checkRemoteDeploy,
} from "../../scripts/verify-deploy-readiness.mjs";

const securityHeaders = {
  "content-security-policy": "default-src 'self'",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=()",
  "x-frame-options": "DENY",
};

afterEach(() => vi.unstubAllGlobals());

describe("Turnstile deployment readiness", () => {
  it("rejects a bundle that only contains a stale site key", () => {
    expect(() =>
      assertTurnstileBundle(
        [{ path: "assets/AuthPanel-old.js", source: 'sitekey:"0x4AAAAAAAAAAAAAAAAAAAAAAA"' }],
        "0x4BBBBBBBBBBBBBBBBBBBBBBB",
        "local",
      ),
    ).toThrow("configured Turnstile site key");
  });

  it("accepts the configured key when it is in a lazy authentication chunk", () => {
    expect(() =>
      assertTurnstileBundle(
        [
          { path: "assets/index.js", source: "const app = true;" },
          { path: "assets/AuthPanel.js", source: 'sitekey:"0x4BBBBBBBBBBBBBBBBBBBBBBB"' },
        ],
        "0x4BBBBBBBBBBBBBBBBBBBBBBB",
        "local",
      ),
    ).not.toThrow();
  });

  it("scans same-origin lazy chunks during online readiness", async () => {
    const baseUrl = "https://beta.example";
    const siteKey = "0x4BBBBBBBBBBBBBBBBBBBBBBB";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.origin === baseUrl && url.pathname === "/") {
        return new Response('<script type="module" src="/assets/main.js"></script>', {
          status: 200,
          headers: securityHeaders,
        });
      }
      if (url.href === `${baseUrl}/assets/main.js`) {
        return new Response('import("assets/AuthPanel.js");', { status: 200 });
      }
      if (url.href === `${baseUrl}/assets/AuthPanel.js`) {
        return new Response(`const siteKey = "${siteKey}";`, { status: 200 });
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

    await expect(checkRemoteDeploy(baseUrl, { turnstileSiteKey: siteKey })).resolves.toMatchObject({
      healthPath: "/api/v2/health",
    });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(`${baseUrl}/assets/AuthPanel.js`);
  });
});
