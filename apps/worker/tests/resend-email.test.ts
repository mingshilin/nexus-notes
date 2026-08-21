import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

describe("ResendEmailSender", () => {
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
});
