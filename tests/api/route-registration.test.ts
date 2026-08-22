import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import worker, { type Env } from "../../worker";

const testDir = dirname(fileURLToPath(import.meta.url));
const workerIndex = readFileSync(resolve(testDir, "../../worker/index.ts"), "utf8");
const wranglerConfig = readFileSync(resolve(testDir, "../../wrangler.toml"), "utf8");

describe("worker route registration", () => {
  it("keeps core database API routes wired", () => {
    [
      'pathname === "/api/databases"',
      "\\/api\\/databases\\/([^/]+)\\/views",
      "\\/api\\/databases\\/([^/]+)\\/notes",
      "\\/api\\/databases\\/([^/]+)\\/templates",
      "\\/api\\/databases\\/([^/]+)\\/permissions",
      "\\/api\\/databases\\/([^/]+)\\/properties",
      "\\/api\\/notes\\/([^/]+)\\/database-values",
      "\\/api\\/notes\\/([^/]+)\\/database-membership",
    ].forEach((needle) => {
      expect(workerIndex).toContain(needle);
    });
  });

  it("keeps knowledge-center, capture, import, and offline routes wired", () => {
    [
      'pathname === "/api/activity"',
      'pathname === "/api/audit"',
      'pathname === "/api/notifications"',
      'pathname === "/api/notifications/read-all"',
      'pathname === "/api/attachments"',
      "\\/api\\/attachments\\/([^/]+)\\/ocr",
      'pathname === "/api/clipper/capture"',
      'pathname === "/api/import/markdown"',
      'pathname === "/api/import/jobs"',
      'pathname === "/api/offline/drafts"',
      'pathname === "/api/calendar/feed"',
      'pathname === "/api/comments"',
    ].forEach((needle) => {
      expect(workerIndex).toContain(needle);
    });
  });

  it("serves real fetch-layer health checks with CORS headers", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/health/turnstile"), {
      DB: {} as D1Database,
      ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } as Fetcher,
      APP_NAME: "Nexus Notes",
      TURNSTILE_SECRET_KEY: "secret",
    } satisfies Env);
    const body = await response.json() as { success: boolean; data: { configured: boolean } };

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(body.data.configured).toBe(true);
  });

  it("returns an API error envelope from the real fetch layer when auth is missing", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/databases"), {
      DB: {} as D1Database,
      ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } as Fetcher,
      APP_NAME: "Nexus Notes",
    } satisfies Env);
    const body = await response.json() as { success: boolean; error: { code: string } };

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ success: false, error: { code: "UNAUTHORIZED" } });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("falls back to index.html through the real fetch layer for client routes", async () => {
    const assets = {
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        return path === "/index.html"
          ? new Response("<!doctype html><div id=\"root\"></div>", { status: 200, headers: { "content-type": "text/html" } })
          : new Response("missing", { status: 404 });
      },
    } as Fetcher;

    const response = await worker.fetch(new Request("https://example.com/workspace/db-1"), {
      DB: {} as D1Database,
      ASSETS: assets,
      APP_NAME: "Nexus Notes",
    } satisfies Env);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("root");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("runs the Worker before every static asset so security headers are applied", () => {
    expect(wranglerConfig).toContain('run_worker_first = ["/*"]');
  });
});
