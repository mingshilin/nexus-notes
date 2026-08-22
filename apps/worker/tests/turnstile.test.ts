import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

describe("TurnstileVerifier", () => {
  it("preserves the fetch receiver when the verifier receives an unbound fetch method", async () => {
    const worker = await loadWorker();
    const owner = {
      fetch(this: typeof globalThis) {
        if (this !== globalThis) throw new TypeError("Illegal invocation");
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          action: "register",
          hostname: "beta.test",
        })));
      },
    };
    const Verifier = worker.TurnstileVerifier as new (
      secret: string,
      fetchImpl: typeof fetch,
      allowedHostnames: readonly string[],
    ) => { verify(token: string, ip: string, action: string): Promise<boolean> };
    const verifier = new Verifier("turnstile-secret", owner.fetch as typeof fetch, ["beta.test"]);

    await expect(verifier.verify("browser-token", "203.0.113.1", "register")).resolves.toBe(true);
  });

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

  it("emits redacted Siteverify diagnostics without token or secret", async () => {
    const worker = await loadWorker();
    const logs: string[] = [];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: false,
      action: "register",
      hostname: "nexus-notes-public-beta-preview.shilinming9.workers.dev",
      "error-codes": ["invalid-input-secret"],
    })));
    const Verifier = worker.TurnstileVerifier as new (
      secret: string,
      fetchImpl: typeof fetch,
      allowedHostnames: readonly string[],
      logger: { log(message: string): void },
    ) => { verify(token: string, ip: string, action: string): Promise<boolean> };
    const verifier = new Verifier(
      "secret-that-must-not-be-logged",
      fetchImpl as typeof fetch,
      ["nexus-notes-public-beta-preview.shilinming9.workers.dev"],
      { log: (message) => logs.push(message) },
    );

    await expect(verifier.verify("browser-token-that-must-not-be-logged", "203.0.113.1", "register"))
      .resolves.toBe(false);

    expect(JSON.parse(logs[0]!)).toMatchObject({
      type: "turnstile.verify",
      success: false,
      action: "register",
      hostname: "nexus-notes-public-beta-preview.shilinming9.workers.dev",
      error_codes: ["invalid-input-secret"],
    });
    expect(logs[0]).not.toContain("secret-that-must-not-be-logged");
    expect(logs[0]).not.toContain("browser-token-that-must-not-be-logged");
  });

  it("classifies Siteverify network and response parsing failures separately", async () => {
    const worker = await loadWorker();
    const Verifier = worker.TurnstileVerifier as new (
      secret: string,
      fetchImpl: typeof fetch,
      allowedHostnames: readonly string[],
      logger: { log(message: string): void },
    ) => { verify(token: string, ip: string, action: string): Promise<boolean> };

    for (const [fetchImpl, failure] of [
      [vi.fn(async () => { throw new TypeError("fetch failed: endpoint=siteverify"); }), "network_error"],
      [vi.fn(async () => new Response("not-json")), "response_parse_error"],
    ] as const) {
      const logs: string[] = [];
      const verifier = new Verifier("secret", fetchImpl as typeof fetch, ["beta.test"], {
        log: (message) => logs.push(message),
      });

      await expect(verifier.verify("token", "203.0.113.1", "register")).resolves.toBe(false);
      expect(JSON.parse(logs[0]!)).toMatchObject({
        type: "turnstile.verify",
        failure,
        ...(failure === "network_error"
          ? { error_name: "TypeError", error_message: "fetch failed: endpoint=siteverify" }
          : {}),
      });
    }
  });
});
