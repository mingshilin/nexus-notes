import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

describe("secure gateway", () => {
  it("allows only configured origins and adds browser security headers", async () => {
    const worker = await loadWorker();
    expect(worker.createSecureGateway).toBeTypeOf("function");
    const handler = vi.fn(async () => new Response("ok"));
    const gateway = (worker.createSecureGateway as any)({
      allowedOrigins: ["https://notes.example.com"], handler,
    });

    const response = await gateway.fetch(new Request("https://worker.test/api/v2/health", {
      headers: { origin: "https://notes.example.com" },
    }), {});

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://notes.example.com");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("vary")).toContain("Origin");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(response.headers.get("content-security-policy")).toContain("frame-src https://challenges.cloudflare.com");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("rejects unknown origins before reaching a handler", async () => {
    const worker = await loadWorker();
    const handler = vi.fn(async () => new Response("unexpected"));
    const gateway = (worker.createSecureGateway as any)({
      allowedOrigins: ["https://notes.example.com"], handler,
    });

    const response = await gateway.fetch(new Request("https://worker.test/api/v2/notes", {
      headers: { origin: "https://evil.example" },
    }), {});

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers allowed preflight without dispatching a route", async () => {
    const worker = await loadWorker();
    const handler = vi.fn(async () => new Response("unexpected"));
    const gateway = (worker.createSecureGateway as any)({
      allowedOrigins: ["https://notes.example.com"], handler,
    });

    const response = await gateway.fetch(new Request("https://worker.test/api/v2/auth/login", {
      method: "OPTIONS",
      headers: {
        origin: "https://notes.example.com",
        "access-control-request-method": "POST",
      },
    }), {});

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(handler).not.toHaveBeenCalled();
  });
});
