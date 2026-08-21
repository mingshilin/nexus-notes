import { assertPasswordPolicy, normalizeEmail } from "@nexus/domain";
import type { AuthSession, WorkspaceMembershipSummary } from "@nexus/contracts";

export interface AuthUser {
  id: string;
  email: string;
  password_hash: string;
  display_name?: string;
  email_verified_at: string | null;
  status: "active" | "suspended" | "deleted";
}

export interface AuthWorkspaceMembership extends WorkspaceMembershipSummary {
  workspaceType: "personal" | "team";
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUser | null | undefined>;
  getUserById(userId: string): Promise<AuthUser | null | undefined>;
  createPendingUser(input: { email: string; passwordHash: string; displayName: string; now: string }): Promise<{ id: string; email: string }>;
  createEmailCode(input: { userId: string; codeHash: string; purpose: "verify_email"; expiresAt: string; now: string }): Promise<void>;
  verifyEmailCodeAndEnsurePersonalWorkspace(codeHash: string, now: string): Promise<{ userId: string } | null | undefined>;
  ensurePersonalWorkspace(userId: string, now: string): Promise<void>;
  listWorkspaceMemberships(userId: string): Promise<AuthWorkspaceMembership[]>;
  createSession(input: { userId: string; tokenHash: string; expiresAt: string; now: string }): Promise<void>;
  createPasswordReset(input: { userId: string; tokenHash: string; expiresAt: string; now: string }): Promise<void>;
  consumePasswordReset(tokenHash: string, now: string): Promise<{ userId: string } | null | undefined>;
  updatePasswordAndRevokeSessions(userId: string, passwordHash: string, now: string): Promise<void>;
  revokeSession(sessionId: string, now: string): Promise<void>;
}

export interface AuthDependencies {
  repository: AuthRepository;
  turnstile: { verify(token: string, ip: string, action: "register" | "login" | "forgot_password" | "verify_email"): Promise<boolean> };
  risk: {
    requiresLoginChallenge(input: { email: string; ip: string }): Promise<boolean>;
    recordFailure?(input: { email: string; ip: string }): Promise<void>;
    clearFailures?(input: { email: string; ip: string }): Promise<void>;
  };
  email: {
    sendVerification(email: string, code: string): Promise<void> | void;
    sendPasswordReset(email: string, token: string): Promise<void> | void;
  };
  password: { hash(password: string): Promise<string>; verify(password: string, encodedHash: string): Promise<boolean> };
  tokens: {
    createSessionToken(): string;
    createEmailCode(): string;
    createResetToken(): string;
    hash(value: string): Promise<string>;
  };
  clock(): Date;
}

export class AuthServiceError extends Error {
  readonly status: number;
  readonly retryable = false;

  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AuthServiceError";
    this.status = code === "INVALID_CREDENTIALS"
      ? 401
      : code === "EMAIL_EXISTS"
        ? 409
        : code === "EMAIL_NOT_VERIFIED" || code.startsWith("CHALLENGE_")
          ? 403
          : 400;
  }
}

function addMilliseconds(date: Date, milliseconds: number) {
  return new Date(date.getTime() + milliseconds).toISOString();
}

export class AuthService {
  constructor(private readonly dependencies: AuthDependencies) {}

  async register(input: {
    email: string;
    password: string;
    displayName?: string;
    turnstileToken: string;
    ip: string;
  }) {
    const email = normalizeEmail(input.email);
    assertPasswordPolicy(input.password);
    const challengeValid = await this.dependencies.turnstile.verify(input.turnstileToken, input.ip, "register");
    if (!challengeValid) throw new AuthServiceError("CHALLENGE_FAILED", "Human verification failed");
    if (await this.dependencies.repository.findUserByEmail(email)) {
      throw new AuthServiceError("EMAIL_EXISTS", "This email is already registered");
    }

    const now = this.dependencies.clock();
    const passwordHash = await this.dependencies.password.hash(input.password);
    const user = await this.dependencies.repository.createPendingUser({
      email,
      passwordHash,
      displayName: input.displayName?.trim() ?? "",
      now: now.toISOString(),
    });
    const code = this.dependencies.tokens.createEmailCode();
    const codeHash = await this.dependencies.tokens.hash(`verify_email:${email}:${code}`);
    await this.dependencies.repository.createEmailCode({
      userId: user.id,
      codeHash,
      purpose: "verify_email",
      expiresAt: addMilliseconds(now, 15 * 60 * 1000),
      now: now.toISOString(),
    });
    await this.dependencies.email.sendVerification(email, code);
    return { userId: user.id, email, verificationRequired: true };
  }

  async login(input: {
    email: string;
    password: string;
    ip: string;
    turnstileToken?: string;
  }) {
    const email = normalizeEmail(input.email);
    const user = await this.dependencies.repository.findUserByEmail(email);
    const passwordValid = user
      ? await this.dependencies.password.verify(input.password, user.password_hash)
      : false;
    if (!user || !passwordValid || user.status !== "active") {
      await this.dependencies.risk.recordFailure?.({ email, ip: input.ip });
      throw new AuthServiceError("INVALID_CREDENTIALS", "Email or password is incorrect");
    }
    if (!user.email_verified_at) throw new AuthServiceError("EMAIL_NOT_VERIFIED", "Email verification is required");

    const challengeRequired = await this.dependencies.risk.requiresLoginChallenge({ email, ip: input.ip });
    if (challengeRequired) {
      if (!input.turnstileToken) throw new AuthServiceError("CHALLENGE_REQUIRED", "Human verification is required");
      const valid = await this.dependencies.turnstile.verify(input.turnstileToken, input.ip, "login");
      if (!valid) throw new AuthServiceError("CHALLENGE_FAILED", "Human verification failed");
    }

    await this.dependencies.risk.clearFailures?.({ email, ip: input.ip });

    const now = this.dependencies.clock();
    const sessionToken = this.dependencies.tokens.createSessionToken();
    const tokenHash = await this.dependencies.tokens.hash(sessionToken);
    await this.dependencies.repository.createSession({
      userId: user.id,
      tokenHash,
      expiresAt: addMilliseconds(now, 30 * 24 * 60 * 60 * 1000),
      now: now.toISOString(),
    });
    return {
      sessionToken,
      user: { id: user.id, email: user.email, displayName: user.display_name ?? "" },
    };
  }

  async resetPassword(input: { token: string; password: string }) {
    assertPasswordPolicy(input.password);
    const now = this.dependencies.clock().toISOString();
    const tokenHash = await this.dependencies.tokens.hash(input.token);
    const reset = await this.dependencies.repository.consumePasswordReset(tokenHash, now);
    if (!reset) throw new AuthServiceError("RESET_TOKEN_INVALID", "Reset token is invalid or expired");
    const passwordHash = await this.dependencies.password.hash(input.password);
    await this.dependencies.repository.updatePasswordAndRevokeSessions(reset.userId, passwordHash, now);
  }

  async verifyEmail(input: { email: string; code: string }) {
    const now = this.dependencies.clock().toISOString();
    const email = normalizeEmail(input.email);
    const codeHash = await this.dependencies.tokens.hash(`verify_email:${email}:${input.code}`);
    const verification = await this.dependencies.repository.verifyEmailCodeAndEnsurePersonalWorkspace(codeHash, now);
    if (!verification) throw new AuthServiceError("EMAIL_CODE_INVALID", "Email verification code is invalid or expired");
  }

  async resendVerification(input: { email: string; turnstileToken: string; ip: string }) {
    const email = normalizeEmail(input.email);
    const challengeValid = await this.dependencies.turnstile.verify(
      input.turnstileToken,
      input.ip,
      "verify_email",
    );
    if (!challengeValid) throw new AuthServiceError("CHALLENGE_FAILED", "Human verification failed");

    const user = await this.dependencies.repository.findUserByEmail(email);
    if (!user || user.status !== "active" || user.email_verified_at) return { accepted: true };

    const now = this.dependencies.clock();
    const code = this.dependencies.tokens.createEmailCode();
    const codeHash = await this.dependencies.tokens.hash(`verify_email:${email}:${code}`);
    await this.dependencies.repository.createEmailCode({
      userId: user.id,
      codeHash,
      purpose: "verify_email",
      expiresAt: addMilliseconds(now, 15 * 60 * 1000),
      now: now.toISOString(),
    });
    await this.dependencies.email.sendVerification(email, code);
    return { accepted: true };
  }

  async requestPasswordReset(input: {
    email: string;
    turnstileToken: string;
    ip: string;
  }) {
    const email = normalizeEmail(input.email);
    const challengeValid = await this.dependencies.turnstile.verify(
      input.turnstileToken,
      input.ip,
      "forgot_password",
    );
    if (!challengeValid) throw new AuthServiceError("CHALLENGE_FAILED", "Human verification failed");

    const user = await this.dependencies.repository.findUserByEmail(email);
    if (!user || user.status !== "active") return { accepted: true };

    const now = this.dependencies.clock();
    const token = this.dependencies.tokens.createResetToken();
    const tokenHash = await this.dependencies.tokens.hash(token);
    await this.dependencies.repository.createPasswordReset({
      userId: user.id,
      tokenHash,
      expiresAt: addMilliseconds(now, 30 * 60 * 1000),
      now: now.toISOString(),
    });
    await this.dependencies.email.sendPasswordReset(email, token);
    return { accepted: true };
  }

  async getSession(userId: string): Promise<AuthSession> {
    const user = await this.dependencies.repository.getUserById(userId);
    if (!user || user.status !== "active") {
      throw new AuthServiceError("SESSION_INVALID", "Session user is unavailable");
    }

    await this.dependencies.repository.ensurePersonalWorkspace(
      userId,
      this.dependencies.clock().toISOString(),
    );
    const memberships = await this.dependencies.repository.listWorkspaceMemberships(userId);
    const workspaces = memberships.map(({ workspaceType: _workspaceType, ...workspace }) => workspace);
    const activeWorkspace = memberships.find((workspace) => workspace.workspaceType === "personal")
      ?? memberships[0];
    return {
      user: { id: user.id, email: user.email, displayName: user.display_name ?? "" },
      workspaces,
      active_workspace_id: activeWorkspace?.id ?? null,
    };
  }

  async logout(sessionId: string) {
    await this.dependencies.repository.revokeSession(sessionId, this.dependencies.clock().toISOString());
  }
}
