import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

function createDependencies(overrides: Record<string, unknown> = {}) {
  return {
    repository: {
      findUserByEmail: vi.fn(),
      createPendingUser: vi.fn(async (input) => ({ id: "user-1", ...input })),
      createEmailCode: vi.fn(),
      consumeEmailCode: vi.fn(),
      markEmailVerified: vi.fn(),
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

  it("atomically verifies email codes", async () => {
    const worker = await loadWorker();
    const dependencies = createDependencies();
    dependencies.repository.consumeEmailCode.mockResolvedValue({ userId: "user-1" });
    const AuthService = worker.AuthService as new (dependencies: Record<string, unknown>) => {
      verifyEmail(input: Record<string, unknown>): Promise<void>;
    };
    const service = new AuthService(dependencies);

    await service.verifyEmail({ email: " User@Example.com ", code: "123456" });

    expect(dependencies.repository.consumeEmailCode).toHaveBeenCalledWith(
      "hash:verify_email:user@example.com:123456",
      "2026-08-21T00:00:00.000Z",
    );
    expect(dependencies.repository.markEmailVerified).toHaveBeenCalledWith("user-1", "2026-08-21T00:00:00.000Z");
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
