import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

describe("TurnstileVerifier", () => {
  it("verifies secret, response, remote IP, success and action", async () => {
    const worker = await loadWorker();
    expect(worker.TurnstileVerifier).toBeTypeOf("function");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, action: "register" }), {
      headers: { "content-type": "application/json" },
    }));
    const Verifier = worker.TurnstileVerifier as new (secret: string, fetchImpl: typeof fetch) => {
      verify(token: string, ip: string, action: string): Promise<boolean>;
    };
    const verifier = new Verifier("turnstile-secret", fetchImpl as typeof fetch);

    await expect(verifier.verify("browser-token", "203.0.113.1", "register")).resolves.toBe(true);

    const body = fetchImpl.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get("secret")).toBe("turnstile-secret");
    expect(body.get("response")).toBe("browser-token");
    expect(body.get("remoteip")).toBe("203.0.113.1");
  });

  it("rejects a successful token issued for another action", async () => {
    const worker = await loadWorker();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, action: "login" })));
    const Verifier = worker.TurnstileVerifier as new (secret: string, fetchImpl: typeof fetch) => {
      verify(token: string, ip: string, action: string): Promise<boolean>;
    };
    const verifier = new Verifier("turnstile-secret", fetchImpl as typeof fetch);

    await expect(verifier.verify("browser-token", "203.0.113.1", "register")).resolves.toBe(false);
  });
});
