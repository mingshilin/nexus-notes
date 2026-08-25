import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

describe("v2 auth routes", () => {
  it("allows a low-risk login without Turnstile and sets a secure session cookie", async () => {
    const worker = await loadWorker();
    expect(worker.registerAuthRoutes).toBeTypeOf("function");
    const service = {
      login: vi.fn(async () => ({ sessionToken: "plain-session", user: { id: "user-1", email: "user@example.com" } })),
    };
    const registry = (worker.createRouteRegistry as any)({ requestId: () => "req-login" });
    (worker.registerAuthRoutes as any)(registry, () => service);

    const response = await registry.fetch(new Request("https://beta.test/api/v2/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.2", "user-agent": "Test Browser" },
      body: JSON.stringify({ email: "user@example.com", password: "long-enough-123" }),
    }), {});

    expect(response.status).toBe(200);
    expect(service.login).toHaveBeenCalledWith(expect.objectContaining({
      turnstileToken: undefined, ip: "203.0.113.2", userAgent: "Test Browser",
    }));
    expect(response.headers.get("set-cookie")).toMatch(/^nexus_session=plain-session; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=/);
    expect(await response.json()).toMatchObject({ success: true, data: { user: { id: "user-1" } } });
  });

  it("rejects registration without a Turnstile token before calling the service", async () => {
    const worker = await loadWorker();
    const service = { register: vi.fn() };
    const registry = (worker.createRouteRegistry as any)({ requestId: () => "req-register" });
    (worker.registerAuthRoutes as any)(registry, () => service);

    const response = await registry.fetch(new Request("https://beta.test/api/v2/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.com", password: "long-enough-123" }),
    }), {});

    expect(response.status).toBe(400);
    expect(service.register).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("exposes email verification and password recovery without leaking secrets", async () => {
    const worker = await loadWorker();
    const service = {
      verifyEmail: vi.fn(async () => undefined),
      resendVerification: vi.fn(async () => ({ accepted: true })),
      requestPasswordReset: vi.fn(async () => ({ accepted: true })),
      resetPassword: vi.fn(async () => undefined),
    };
    const registry = (worker.createRouteRegistry as any)({ requestId: () => "req-recovery" });
    (worker.registerAuthRoutes as any)(registry, () => service);

    const verify = await registry.fetch(new Request("https://beta.test/api/v2/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.com", code: "123456" }),
    }), {});
    const forgot = await registry.fetch(new Request("https://beta.test/api/v2/auth/forgot-password", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.3" },
      body: JSON.stringify({ email: "missing@example.com", turnstile_token: "challenge" }),
    }), {});
    const resend = await registry.fetch(new Request("https://beta.test/api/v2/auth/resend-verification", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.4" },
      body: JSON.stringify({ email: "user@example.com", turnstile_token: "challenge-verify" }),
    }), {});
    const reset = await registry.fetch(new Request("https://beta.test/api/v2/auth/reset-password", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "reset-token-long-enough", password: "replacement-123" }),
    }), {});

    expect(verify.status).toBe(200);
    expect(service.verifyEmail).toHaveBeenCalledWith({ email: "user@example.com", code: "123456" });
    expect(await resend.json()).toMatchObject({ success: true, data: { accepted: true } });
    expect(service.resendVerification).toHaveBeenCalledWith(expect.objectContaining({
      email: "user@example.com",
      turnstileToken: "challenge-verify",
      ip: "203.0.113.4",
    }));
    expect(await forgot.json()).toMatchObject({ success: true, data: { accepted: true } });
    expect(service.requestPasswordReset).toHaveBeenCalledWith(expect.objectContaining({ ip: "203.0.113.3" }));
    expect(reset.status).toBe(200);
    expect(service.resetPassword).toHaveBeenCalledWith({ token: "reset-token-long-enough", password: "replacement-123" });
  });

  it("returns deterministic workspace summaries with the active workspace and clears logout", async () => {
    const worker = await loadWorker();
    const sessionData = {
      user: { id: "user-1", email: "user@example.com", displayName: "User" },
      workspaces: [
        { id: "personal-1", name: "Personal workspace", slug: "personal-user-1", role: "owner", revision: 1 },
        { id: "team-1", name: "Alpha", slug: "alpha", role: "viewer", revision: 2 },
      ],
      active_workspace_id: "personal-1",
    };
    const service = {
      getSession: vi.fn(async () => sessionData),
      logout: vi.fn(async () => undefined),
    };
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-session",
      authenticate: vi.fn(async () => ({ userId: "user-1", sessionId: "session-1" })),
    });
    (worker.registerAuthRoutes as any)(registry, () => service);

    const session = await registry.fetch(new Request("https://beta.test/api/v2/auth/session"), {});
    const logout = await registry.fetch(new Request("https://beta.test/api/v2/auth/logout", { method: "POST" }), {});

    const sessionBody = await session.json() as { success: boolean; data: unknown };
    expect(sessionBody.success).toBe(true);
    expect(sessionBody.data).toEqual(sessionData);
    expect(service.getSession).toHaveBeenCalledWith("user-1");
    expect(service.logout).toHaveBeenCalledWith("session-1");
    expect(logout.headers.get("set-cookie")).toBe("nexus_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  });

  it("creates a team workspace only for an authenticated session", async () => {
    const worker = await loadWorker();
    const service = {
      createWorkspace: vi.fn(async () => ({
        id: "team-1",
        name: "研究团队",
        slug: "team-team-1",
        role: "owner" as const,
        revision: 1,
      })),
    };
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-workspace-create",
      authenticate: vi.fn(async () => ({ userId: "user-1", sessionId: "session-1" })),
    });
    (worker.registerAuthRoutes as any)(registry, () => service);

    const response = await registry.fetch(new Request("https://beta.test/api/v2/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  研究团队  " }),
    }), {});

    expect(response.status).toBe(201);
    expect(service.createWorkspace).toHaveBeenCalledWith({ userId: "user-1", name: "研究团队" });
    expect(await response.json()).toMatchObject({
      success: true,
      data: { id: "team-1", role: "owner" },
    });
  });
});
