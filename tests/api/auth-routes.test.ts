import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../worker/auth", () => ({
  buildSessionCookie: vi.fn(() => "mn_session=session; Path=/"),
  randomToken: vi.fn(() => "token-123"),
  sha256: vi.fn(async (input: string) => `hashed:${input}`),
  verifyPassword: vi.fn(async () => true),
  hashPassword: vi.fn(async () => "hashed-password"),
}));

vi.mock("../../worker/db/queries", () => ({
  createEmailVerificationCode: vi.fn(),
  consumeEmailVerificationToken: vi.fn(),
  createWorkspace: vi.fn(),
  ensurePersonalWorkspaceForUser: vi.fn(),
  getEmailVerificationCodeByEmailAndHash: vi.fn(),
  getPasswordResetTokenByHash: vi.fn(),
  getUserByEmail: vi.fn(),
  insertEmailVerificationToken: vi.fn(),
  insertPasswordResetToken: vi.fn(),
  insertSession: vi.fn(),
  insertUser: vi.fn(),
  markEmailVerificationCodeUsed: vi.fn(),
  markPasswordResetTokenUsed: vi.fn(),
  markUserEmailVerified: vi.fn(),
  updateUserPassword: vi.fn(),
}));

vi.mock("../../worker/mail", () => ({
  sendEmailByResend: vi.fn(async () => undefined),
}));

import { verifyPassword } from "../../worker/auth";
import { handleLogin, handleRegister, handleResendVerificationCode, handleVerifyEmailCode } from "../../worker/routes/auth";
import {
  createEmailVerificationCode,
  ensurePersonalWorkspaceForUser,
  getEmailVerificationCodeByEmailAndHash,
  getUserByEmail,
  insertUser,
  markEmailVerificationCodeUsed,
  markUserEmailVerified,
} from "../../worker/db/queries";

const baseUser = {
  id: "u1",
  email: "a@test.com",
  password_hash: "hashed-password",
  display_name: "A",
  bio: null,
  avatar_url: null,
  email_verified_at: null,
  created_at: "x",
  updated_at: "x",
};

describe("auth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 })));
  });

  it("register returns pending verification instead of session", async () => {
    vi.mocked(getUserByEmail)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(baseUser);
    vi.mocked(insertUser).mockResolvedValue(undefined);
    vi.mocked(ensurePersonalWorkspaceForUser).mockResolvedValue({ id: "ws1", name: "Personal", owner_user_id: "u1", created_at: "x", updated_at: "x" });
    vi.mocked(createEmailVerificationCode).mockResolvedValue(undefined);

    const request = new Request("https://example.com/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: "a@test.com", password: "password123", turnstile_token: "ok" }),
    });

    const result = await handleRegister({} as D1Database, request, {
      RESEND_API_KEY: "resend",
      EMAIL_FROM: "noreply@example.com",
      APP_NAME: "Notes",
      TURNSTILE_SECRET_KEY: "secret",
    });
    const body = await result.response.json() as { success: boolean; data: { pending_verification: boolean } };

    expect(body.success).toBe(true);
    expect(body.data.pending_verification).toBe(true);
    expect("setCookie" in result).toBe(false);
  });

  it("allows password login for unverified email", async () => {
    vi.mocked(getUserByEmail).mockResolvedValue(baseUser);
    vi.mocked(ensurePersonalWorkspaceForUser).mockResolvedValue({ id: "ws1", name: "Personal", owner_user_id: "u1", created_at: "x", updated_at: "x" });

    const request = new Request("https://example.com/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "a@test.com", password: "password123", turnstile_token: "ok" }),
    });

    const result = await handleLogin({} as D1Database, request, { TURNSTILE_SECRET_KEY: "secret" });
    const body = await result.response.json() as { success: boolean; data: { email_verified_at: string | null } };

    expect(body.success).toBe(true);
    expect(body.data.email_verified_at).toBeNull();
    expect(result.setCookie).toContain("mn_session=");
    expect(ensurePersonalWorkspaceForUser).toHaveBeenCalledWith(expect.anything(), "u1");
  });

  it("does not create workspace side effects for invalid login passwords", async () => {
    vi.mocked(getUserByEmail).mockResolvedValue(baseUser);
    vi.mocked(verifyPassword).mockResolvedValueOnce(false);

    const request = new Request("https://example.com/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "a@test.com", password: "password123" }),
    });

    await expect(handleLogin({} as D1Database, request, {})).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      status: 401,
    });
    expect(ensurePersonalWorkspaceForUser).not.toHaveBeenCalled();
  });

  it("verifies email code and returns session", async () => {
    vi.mocked(getUserByEmail)
      .mockResolvedValueOnce(baseUser)
      .mockResolvedValueOnce({ ...baseUser, email_verified_at: "2026-05-08T00:00:00.000Z" });
    vi.mocked(getEmailVerificationCodeByEmailAndHash).mockResolvedValue({
      id: "code1",
      user_id: "u1",
      email: "a@test.com",
      code_hash: "hashed:a@test.com:123456",
      expires_at: "2999-01-01T00:00:00.000Z",
      used_at: null,
      created_at: "x",
    });
    vi.mocked(markEmailVerificationCodeUsed).mockResolvedValue(undefined);
    vi.mocked(markUserEmailVerified).mockResolvedValue(undefined);

    const request = new Request("https://example.com/api/auth/verify-email-code", {
      method: "POST",
      body: JSON.stringify({ email: "a@test.com", code: "123456" }),
    });

    const result = await handleVerifyEmailCode({} as D1Database, request);
    const body = await result.response.json() as { success: boolean; data: { email_verified_at: string } };

    expect(body.success).toBe(true);
    expect(body.data.email_verified_at).toBeTruthy();
    expect(result.setCookie).toContain("mn_session=");
  });

  it("resends verification code for unverified user", async () => {
    vi.mocked(getUserByEmail).mockResolvedValue(baseUser);
    vi.mocked(createEmailVerificationCode).mockResolvedValue(undefined);

    const request = new Request("https://example.com/api/auth/resend-verification-code", {
      method: "POST",
      body: JSON.stringify({ email: "a@test.com" }),
    });

    const response = await handleResendVerificationCode({} as D1Database, request, {
      RESEND_API_KEY: "resend",
      EMAIL_FROM: "noreply@example.com",
      APP_NAME: "Notes",
    });
    const body = await response.json() as { success: boolean; data: { pending_verification: boolean } };

    expect(body.success).toBe(true);
    expect(body.data.pending_verification).toBe(true);
  });
});
