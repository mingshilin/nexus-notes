import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

describe("ResendEmailSender", () => {
  it("preserves the fetch receiver when sending through an unbound fetch method", async () => {
    const worker = (await import("../src/index")) as WorkerExports;
    const owner = {
      fetch(this: typeof globalThis) {
        if (this !== globalThis) throw new TypeError("Illegal invocation");
        return Promise.resolve(new Response(null, { status: 202 }));
      },
    };
    const Sender = worker.ResendEmailSender as new (...args: any[]) => {
      sendVerification(email: string, code: string): Promise<void>;
    };
    const sender = new Sender(
      "resend-key",
      "Nexus Notes <noreply@example.com>",
      "https://beta.example.com",
      owner.fetch,
    );

    await expect(sender.sendVerification("user@example.com", "123456")).resolves.toBeUndefined();
  });

  it("generates a reset URL that the web bootstrap can consume", async () => {
    const worker = (await import("../src/index")) as WorkerExports;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const Sender = worker.ResendEmailSender as new (...args: any[]) => {
      sendPasswordReset(email: string, token: string): Promise<void>;
    };
    const sender = new Sender(
      "resend-key",
      "Nexus Notes <noreply@example.com>",
      "https://beta.example.com",
      fetchImpl,
    );

    await sender.sendPasswordReset("user@example.com", "plain-reset-token");

    const body = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string) as { text: string };
    expect(body.text).toContain("https://beta.example.com/reset-password?reset_token=plain-reset-token");
    expect(body.text).not.toContain("?token=");
  });

  it("emits only the provider status when delivery is rejected", async () => {
    const worker = (await import("../src/index")) as WorkerExports;
    const logs: string[] = [];
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }));
    const Sender = worker.ResendEmailSender as new (...args: any[]) => {
      sendVerification(email: string, code: string): Promise<void>;
    };
    const sender = new Sender(
      "resend-secret-that-must-not-be-logged",
      "Nexus Notes <noreply@example.com>",
      "https://beta.example.com",
      fetchImpl,
      { log: (message: string) => logs.push(message) },
    );

    await expect(sender.sendVerification("private@example.com", "654321")).rejects.toThrow("403");
    expect(JSON.parse(logs[0]!)).toEqual({
      type: "email.delivery",
      provider: "resend",
      status: 403,
      outcome: "failure",
    });
    expect(logs[0]).not.toContain("resend-secret-that-must-not-be-logged");
    expect(logs[0]).not.toContain("private@example.com");
    expect(logs[0]).not.toContain("654321");
  });
});
