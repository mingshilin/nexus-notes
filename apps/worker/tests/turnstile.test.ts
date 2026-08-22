import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

describe("TurnstileVerifier", () => {
  it("verifies secret, response, remote IP, success and action", async () => {
    const worker = await loadWorker();
    expect(worker.TurnstileVerifier).toBeTypeOf("function");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      action: "register",
      hostname: "nexus-notes-public-beta-preview.shilinming9.workers.dev",
    }), {
      headers: { "content-type": "application/json" },
    }));
    const Verifier = worker.TurnstileVerifier as new (secret: string, fetchImpl: typeof fetch, allowedHostnames: readonly string[]) => {
      verify(token: string, ip: string, action: string): Promise<boolean>;
    };
    const verifier = new Verifier("turnstile-secret", fetchImpl as typeof fetch, [
      "nexus-notes-public-beta-preview.shilinming9.workers.dev",
    ]);

    await expect(verifier.verify("browser-token", "203.0.113.1", "register")).resolves.toBe(true);

    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
    const body = init?.body as URLSearchParams;
    expect(body.get("secret")).toBe("turnstile-secret");
    expect(body.get("response")).toBe("browser-token");
    expect(body.get("remoteip")).toBe("203.0.113.1");
  });

  it("rejects a successful token issued for another action", async () => {
    const worker = await loadWorker();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      action: "login",
      hostname: "nexus-notes-public-beta-preview.shilinming9.workers.dev",
    })));
    const Verifier = worker.TurnstileVerifier as new (secret: string, fetchImpl: typeof fetch, allowedHostnames: readonly string[]) => {
      verify(token: string, ip: string, action: string): Promise<boolean>;
    };
    const verifier = new Verifier("turnstile-secret", fetchImpl as typeof fetch, [
      "nexus-notes-public-beta-preview.shilinming9.workers.dev",
    ]);

    await expect(verifier.verify("browser-token", "203.0.113.1", "register")).resolves.toBe(false);
  });

  it("rejects a successful token issued for an unapproved hostname", async () => {
    const worker = await loadWorker();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      action: "register",
      hostname: "attacker.example",
    })));
    const Verifier = worker.TurnstileVerifier as new (secret: string, fetchImpl: typeof fetch, allowedHostnames: readonly string[]) => {
      verify(token: string, ip: string, action: string): Promise<boolean>;
    };
    const verifier = new Verifier("turnstile-secret", fetchImpl as typeof fetch, [
      "nexus-notes-public-beta-preview.shilinming9.workers.dev",
    ]);

    await expect(verifier.verify("browser-token", "203.0.113.1", "register")).resolves.toBe(false);
  });

  it("rejects an oversized token before calling siteverify", async () => {
    const worker = await loadWorker();
    const fetchImpl = vi.fn();
    const Verifier = worker.TurnstileVerifier as new (secret: string, fetchImpl: typeof fetch, allowedHostnames: readonly string[]) => {
      verify(token: string, ip: string, action: string): Promise<boolean>;
    };
    const verifier = new Verifier("turnstile-secret", fetchImpl as typeof fetch, ["beta.test"]);

    await expect(verifier.verify("x".repeat(2049), "203.0.113.1", "register")).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
