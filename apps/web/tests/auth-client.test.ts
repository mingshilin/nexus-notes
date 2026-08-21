import { describe, expect, it, vi } from "vitest";

type WebExports = Record<string, unknown>;

async function loadWeb() {
  return (await import("../src/index")) as WebExports;
}

describe("AuthClient", () => {
  it("parses and returns the complete shared auth session", async () => {
    const web = await loadWeb();
    const request = vi.fn(async () => ({
      user: { id: "user-1", email: "user@example.com", displayName: "User" },
      workspaces: [{ id: "workspace-1", name: "Personal", slug: "personal", role: "owner", revision: 1 }],
      active_workspace_id: "workspace-1",
    }));
    const Client = web.AuthClient as new (client: unknown) => {
      session(): Promise<{
        user: { id: string; email: string; displayName: string };
        workspaces: Array<{ id: string; name: string; slug: string; role: string; revision: number }>;
        active_workspace_id: string | null;
      }>;
    };
    const client = new Client({ request });

    await expect(client.session()).resolves.toEqual({
      user: { id: "user-1", email: "user@example.com", displayName: "User" },
      workspaces: [{ id: "workspace-1", name: "Personal", slug: "personal", role: "owner", revision: 1 }],
      active_workspace_id: "workspace-1",
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/auth/session" }));
  });

  it("rejects a session payload that violates the shared contract", async () => {
    const web = await loadWeb();
    const request = vi.fn(async () => ({
      user: { id: "user-1", email: "user@example.com", displayName: "User" },
      workspaces: [],
    }));
    const Client = web.AuthClient as new (client: unknown) => { session(): Promise<unknown> };

    await expect(new Client({ request }).session()).rejects.toThrow();
  });

  it("does not send Turnstile for ordinary login unless a challenge token exists", async () => {
    const web = await loadWeb();
    expect(web.AuthClient).toBeTypeOf("function");
    const request = vi.fn(async () => ({ user: { id: "user-1" } }));
    const Client = web.AuthClient as new (client: unknown) => {
      login(input: Record<string, unknown>): Promise<unknown>;
    };
    const client = new Client({ request });

    await client.login({ email: "user@example.com", password: "long-enough-123" });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/auth/login",
      body: { email: "user@example.com", password: "long-enough-123" },
    }));
  });

  it("sends required Turnstile tokens for registration and password recovery", async () => {
    const web = await loadWeb();
    const request = vi.fn(async () => ({ accepted: true }));
    const Client = web.AuthClient as new (client: unknown) => {
      register(input: Record<string, unknown>): Promise<unknown>;
      verifyEmail(input: Record<string, unknown>): Promise<unknown>;
      resendVerification(input: Record<string, unknown>): Promise<unknown>;
      forgotPassword(input: Record<string, unknown>): Promise<unknown>;
    };
    const client = new Client({ request });

    await client.register({ email: "user@example.com", password: "long-enough-123", displayName: "User", turnstileToken: "challenge" });
    await client.verifyEmail({ email: "user@example.com", code: "123456" });
    await client.resendVerification({ email: "user@example.com", turnstileToken: "challenge-verify" });
    await client.forgotPassword({ email: "user@example.com", turnstileToken: "challenge-2" });

    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      body: expect.objectContaining({ turnstile_token: "challenge" }),
    }));
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      path: "/api/v2/auth/verify-email",
      body: { email: "user@example.com", code: "123456" },
    }));
    expect(request).toHaveBeenNthCalledWith(3, expect.objectContaining({
      path: "/api/v2/auth/resend-verification",
      body: { email: "user@example.com", turnstile_token: "challenge-verify" },
    }));
    expect(request).toHaveBeenNthCalledWith(4, expect.objectContaining({
      body: expect.objectContaining({ turnstile_token: "challenge-2" }),
    }));
  });
});
