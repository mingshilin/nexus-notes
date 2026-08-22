import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

function createDependencies(overrides: Record<string, unknown> = {}) {
  return {
    repository: {
      findUserByEmail: vi.fn(),
      getUserById: vi.fn(),
      createPendingUser: vi.fn(async (input) => ({ id: "user-1", ...input })),
      createEmailCode: vi.fn(),
      verifyEmailCodeAndEnsurePersonalWorkspace: vi.fn(async () => ({ userId: "user-1" })),
      ensurePersonalWorkspace: vi.fn(),
      listWorkspaceMemberships: vi.fn(async () => []),
      createSession: vi.fn(),
      createPasswordReset: vi.fn(),
      consumePasswordReset: vi.fn(),
      updatePasswordAndRevokeSessions: vi.fn(),
    },
    turnstile: { verify: vi.fn(async () => true) },
    risk: { requiresLoginChallenge: vi.fn(async () => false) },
    email: { sendVerification: vi.fn(), sendPasswordReset: vi.fn() },
    password: { hash: vi.fn(async () => "password-hash"), verify: vi.fn(async () => true) },
    tokens: {
      createSessionToken: vi.fn(() => "plain-session-token"),
      createEmailCode: vi.fn(() => "123456"),
      createResetToken: vi.fn(() => "plain-reset-token"),
      hash: vi.fn(async (value: string) => `hash:${value}`),
    },
    clock: () => new Date("2026-08-21T00:00:00.000Z"),
    ...overrides,
  };
}

describe("AuthService", () => {
  it("requires Turnstile for registration and stores only a hashed email code", async () => {
    const worker = await loadWorker();
    expect(worker.AuthService).toBeTypeOf("function");
    const dependencies = createDependencies();
    const AuthService = worker.AuthService as new (dependencies: Record<string, unknown>) => {
      register(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
    const service = new AuthService(dependencies);

    await service.register({ email: " User@Example.com ", password: "long-enough-123", displayName: "User", turnstileToken: "challenge", ip: "203.0.113.1" });

    expect(dependencies.turnstile.verify).toHaveBeenCalledWith("challenge", "203.0.113.1", "register");
    expect(dependencies.repository.createPendingUser).toHaveBeenCalledWith(expect.objectContaining({ email: "user@example.com", passwordHash: "password-hash" }));
    expect(dependencies.repository.createEmailCode).toHaveBeenCalledWith(expect.objectContaining({
      codeHash: "hash:verify_email:user@example.com:123456",
      purpose: "verify_email",
    }));
    expect(dependencies.email.sendVerification).toHaveBeenCalledWith("user@example.com", "123456");
  });

  it("reports only the failed registration stage when a dependency throws", async () => {
    const worker = await loadWorker();
    const logs: string[] = [];
    const dependencies = createDependencies({
      logger: { log: (message: string) => logs.push(message) },
      password: { hash: vi.fn(async () => { throw new TypeError("crypto unavailable"); }), verify: vi.fn(async () => true) },
    });
    const AuthService = worker.AuthService as new (dependencies: Record<string, unknown>) => {
      register(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    };

    await expect(new AuthService(dependencies).register({
      email: "private@example.com",
      password: "password-that-must-not-be-logged",
      displayName: "Private",
      turnstileToken: "token-that-must-not-be-logged",
      ip: "203.0.113.1",
    })).rejects.toThrow("crypto unavailable");

    expect(JSON.parse(logs[0]!)).toMatchObject({
      type: "auth.stage_failure",
      flow: "register",
      stage: "password_hash",
      error_name: "TypeError",
    });
    expect(logs[0]).not.toContain("private@example.com");
    expect(logs[0]).not.toContain("password-that-must-not-be-logged");
    expect(logs[0]).not.toContain("token-that-must-not-be-logged");
  });

  it("does not require Turnstile for a low-risk normal login and stores only the session hash", async () => {
    const worker = await loadWorker();
    const dependencies = createDependencies();
    dependencies.repository.findUserByEmail.mockResolvedValue({ id: "user-1", email: "user@example.com", password_hash: "stored", email_verified_at: "2026-08-20T00:00:00.000Z", status: "active" });
    const AuthService = worker.AuthService as new (dependencies: Record<string, unknown>) => {
      login(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
    const service = new AuthService(dependencies);

    const result = await service.login({ email: "user@example.com", password: "long-enough-123", ip: "203.0.113.2" });

    expect(dependencies.risk.requiresLoginChallenge).toHaveBeenCalled();
    expect(dependencies.turnstile.verify).not.toHaveBeenCalled();
    expect(dependencies.repository.createSession).toHaveBeenCalledWith(expect.objectContaining({ tokenHash: "hash:plain-session-token", userId: "user-1" }));
    expect(result).toMatchObject({ sessionToken: "plain-session-token", user: { id: "user-1", email: "user@example.com" } });
  });

  it("atomically consumes password reset and revokes all old sessions", async () => {
    const worker = await loadWorker();
    const dependencies = createDependencies();
    dependencies.repository.consumePasswordReset.mockResolvedValue({ userId: "user-1" });
    const AuthService = worker.AuthService as new (dependencies: Record<string, unknown>) => {
      resetPassword(input: Record<string, unknown>): Promise<void>;
    };
    const service = new AuthService(dependencies);

    await service.resetPassword({ token: "reset-token", password: "replacement-123" });

    expect(dependencies.repository.consumePasswordReset).toHaveBeenCalledWith("hash:reset-token", "2026-08-21T00:00:00.000Z");
    expect(dependencies.repository.updatePasswordAndRevokeSessions).toHaveBeenCalledWith("user-1", "password-hash", "2026-08-21T00:00:00.000Z");
  });

  it("atomically verifies email and ensures the personal workspace", async () => {
    const worker = await loadWorker();
    const dependencies = createDependencies();
    const AuthService = worker.AuthService as new (dependencies: Record<string, unknown>) => {
      verifyEmail(input: Record<string, unknown>): Promise<void>;
    };
    const service = new AuthService(dependencies);

    await service.verifyEmail({ email: " User@Example.com ", code: "123456" });

    expect(dependencies.repository.verifyEmailCodeAndEnsurePersonalWorkspace).toHaveBeenCalledWith(
      "hash:verify_email:user@example.com:123456",
      "2026-08-21T00:00:00.000Z",
    );
  });

  it("reconciles an old active user and selects the personal workspace for the session", async () => {
    const worker = await loadWorker();
    const dependencies = createDependencies();
    dependencies.repository.getUserById.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      display_name: "User",
      email_verified_at: "2026-08-20T00:00:00.000Z",
      status: "active",
    });
    dependencies.repository.listWorkspaceMemberships.mockResolvedValue([
      { id: "personal-1", name: "Personal workspace", slug: "personal-user-1", role: "owner", revision: 1, workspaceType: "personal" },
      { id: "team-1", name: "Alpha", slug: "alpha", role: "editor", revision: 2, workspaceType: "team" },
    ]);
    const AuthService = worker.AuthService as new (dependencies: Record<string, unknown>) => {
      getSession(userId: string): Promise<Record<string, unknown>>;
    };

    await expect(new AuthService(dependencies).getSession("user-1")).resolves.toEqual({
      user: { id: "user-1", email: "user@example.com", displayName: "User" },
      workspaces: [
        { id: "personal-1", name: "Personal workspace", slug: "personal-user-1", role: "owner", revision: 1 },
        { id: "team-1", name: "Alpha", slug: "alpha", role: "editor", revision: 2 },
      ],
      active_workspace_id: "personal-1",
    });
    expect(dependencies.repository.ensurePersonalWorkspace).toHaveBeenCalledWith(
      "user-1",
      "2026-08-21T00:00:00.000Z",
    );
  });

  it("falls back to the first authorized workspace when no personal membership is returned", async () => {
    const worker = await loadWorker();
    const dependencies = createDependencies();
    dependencies.repository.getUserById.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      display_name: "User",
      email_verified_at: "2026-08-20T00:00:00.000Z",
      status: "active",
    });
    dependencies.repository.listWorkspaceMemberships.mockResolvedValue([
      { id: "team-1", name: "Alpha", slug: "alpha", role: "viewer", revision: 1, workspaceType: "team" },
      { id: "team-2", name: "Zulu", slug: "zulu", role: "editor", revision: 3, workspaceType: "team" },
    ]);
    const AuthService = worker.AuthService as new (dependencies: Record<string, unknown>) => {
      getSession(userId: string): Promise<{ active_workspace_id: string | null }>;
    };

    await expect(new AuthService(dependencies).getSession("user-1")).resolves.toMatchObject({
      active_workspace_id: "team-1",
    });
  });

  it("requires Turnstile for password reset requests without exposing unknown emails", async () => {
    const worker = await loadWorker();
    const dependencies = createDependencies();
    dependencies.repository.findUserByEmail.mockResolvedValue(null);
    const AuthService = worker.AuthService as new (dependencies: Record<string, unknown>) => {
      requestPasswordReset(input: Record<string, unknown>): Promise<{ accepted: boolean }>;
    };
    const service = new AuthService(dependencies);

    await expect(service.requestPasswordReset({ email: "missing@example.com", turnstileToken: "challenge", ip: "203.0.113.3" })).resolves.toEqual({ accepted: true });

    expect(dependencies.turnstile.verify).toHaveBeenCalledWith("challenge", "203.0.113.3", "forgot_password");
    expect(dependencies.repository.createPasswordReset).not.toHaveBeenCalled();
    expect(dependencies.email.sendPasswordReset).not.toHaveBeenCalled();
  });

  it("resends namespaced verification codes only for active unverified accounts", async () => {
    const worker = await loadWorker();
    const dependencies = createDependencies();
    dependencies.repository.findUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      email_verified_at: null,
      status: "active",
    });
    const AuthService = worker.AuthService as new (dependencies: Record<string, unknown>) => {
      resendVerification(input: Record<string, unknown>): Promise<{ accepted: boolean }>;
    };
    const service = new AuthService(dependencies);

    await expect(service.resendVerification({
      email: " User@Example.com ",
      turnstileToken: "challenge",
      ip: "203.0.113.4",
    })).resolves.toEqual({ accepted: true });

    expect(dependencies.turnstile.verify).toHaveBeenCalledWith("challenge", "203.0.113.4", "verify_email");
    expect(dependencies.repository.createEmailCode).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      codeHash: "hash:verify_email:user@example.com:123456",
    }));
    expect(dependencies.email.sendVerification).toHaveBeenCalledWith("user@example.com", "123456");
  });
});
