import { buildSessionCookie, randomToken, sha256, verifyPassword, hashPassword } from "../auth";
import { HttpError, jsonSuccess, parseJson } from "../http";
import {
  createEmailVerificationCode,
  getUserByEmail,
  ensurePersonalWorkspaceForUser,
  insertEmailVerificationToken,
  insertPasswordResetToken,
  insertSession,
  insertUser,
  getEmailVerificationCodeByEmailAndHash,
  getPasswordResetTokenByHash,
  markEmailVerificationCodeUsed,
  markPasswordResetTokenUsed,
  markUserEmailVerified,
  type UserRow,
  consumeEmailVerificationToken,
  updateUserPassword,
} from "../db/queries";
import { sendEmailByResend } from "../mail";

interface RegisterBody {
  email?: string;
  password?: string;
  turnstile_token?: string;
}

interface LoginBody {
  email?: string;
  password?: string;
  turnstile_token?: string;
}

interface VerifyEmailBody {
  token?: string;
}

interface VerifyEmailCodeBody {
  email?: string;
  code?: string;
}

interface ResendVerificationCodeBody {
  email?: string;
}

interface ForgotPasswordBody {
  email?: string;
  turnstile_token?: string;
}

interface ResetPasswordBody {
  token?: string;
  password?: string;
  turnstile_token?: string;
}

async function verifyTurnstile(
  turnstileToken: string | undefined,
  request: Request,
  env: { TURNSTILE_SECRET_KEY?: string },
) {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    throw new HttpError(503, "CONFIG_ERROR", "turnstile secret is not configured");
  }
  if (!turnstileToken) throw new HttpError(400, "BOT_CHECK_FAILED", "turnstile token is required");

  const formData = new URLSearchParams();
  formData.set("secret", secret);
  formData.set("response", turnstileToken);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) formData.set("remoteip", ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });

  const result = (await response.json().catch(() => null)) as { success?: boolean } | null;
  if (!response.ok || !result?.success) {
    throw new HttpError(400, "BOT_CHECK_FAILED", "turnstile verification failed");
  }
}

function sanitizeUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    bio: user.bio,
    avatar_url: user.avatar_url,
    email_verified_at: user.email_verified_at,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

function assertEmail(email: string | undefined) {
  if (!email) throw new HttpError(400, "VALIDATION_ERROR", "email is required");
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new HttpError(400, "VALIDATION_ERROR", "email format is invalid");
  }
  return normalized;
}

function assertPassword(password: string | undefined) {
  if (!password) throw new HttpError(400, "VALIDATION_ERROR", "password is required");
  if (password.length < 8) {
    throw new HttpError(400, "VALIDATION_ERROR", "password length must be >= 8");
  }
  if (password.length > 128) {
    throw new HttpError(400, "VALIDATION_ERROR", "password length must be <= 128");
  }
  return password;
}

function tokenExpiry(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function sessionExpiry(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

function verificationCodeExpiryMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function generateVerificationCode() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(value).padStart(6, "0");
}

async function issueEmailVerificationCode(
  db: D1Database,
  user: UserRow,
  env: {
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    APP_NAME?: string;
  },
) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new HttpError(503, "CONFIG_ERROR", "email verification service is not configured");
  }
  const code = generateVerificationCode();
  const codeHash = await sha256(`${user.email.toLowerCase()}:${code}`);
  const expiresAt = verificationCodeExpiryMinutes(10);
  await createEmailVerificationCode(db, {
    id: crypto.randomUUID(),
    userId: user.id,
    email: user.email,
    codeHash,
    expiresAt,
  });
  await sendEmailByResend({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: user.email,
    subject: `${env.APP_NAME ?? "Nexus Notes"} 邮箱验证码`,
    html: `
      <p>你的邮箱验证码如下：</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p>
      <p>验证码 10 分钟内有效。</p>
      <p>如果这不是你的操作，请忽略这封邮件。</p>
    `,
  });
  return expiresAt;
}

async function createSessionForUser(db: D1Database, request: Request, userId: string) {
  const sessionToken = randomToken(32);
  const sessionTokenHash = await sha256(sessionToken);
  await insertSession(db, {
    id: crypto.randomUUID(),
    userId,
    tokenHash: sessionTokenHash,
    userAgent: request.headers.get("user-agent"),
    ipAddress: request.headers.get("cf-connecting-ip"),
    expiresAt: sessionExpiry(30),
  });
  return sessionToken;
}

export async function handleRegister(
  db: D1Database,
  request: Request,
  env: {
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    APP_BASE_URL?: string;
    APP_NAME?: string;
    TURNSTILE_SECRET_KEY?: string;
  },
) {
  const body = await parseJson<RegisterBody>(request);
  await verifyTurnstile(body.turnstile_token, request, env);
  const email = assertEmail(body.email);
  const password = assertPassword(body.password);

  const existing = await getUserByEmail(db, email);
  if (existing) {
    if (!existing.email_verified_at) {
      const verificationExpiresAt = await issueEmailVerificationCode(db, existing, env);
      return {
        response: jsonSuccess(
          {
            pending_verification: true as const,
            email: existing.email,
            email_masked: maskEmail(existing.email),
            verification_expires_at: verificationExpiresAt,
          },
          { status: 202 },
        ),
      };
    }
    throw new HttpError(409, "EMAIL_EXISTS", "email already registered");
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  await insertUser(db, { id: userId, email, passwordHash, displayName: email.split("@")[0] });
  await ensurePersonalWorkspaceForUser(db, userId);
  const user = await getUserByEmail(db, email);
  if (!user) throw new HttpError(500, "INTERNAL_ERROR", "failed to create user");
  const verificationExpiresAt = await issueEmailVerificationCode(db, user, env);

  return {
    response: jsonSuccess(
      {
        pending_verification: true as const,
        email: user.email,
        email_masked: maskEmail(user.email),
        verification_expires_at: verificationExpiresAt,
      },
      { status: 202 },
    ),
  };
}

export async function handleLogin(
  db: D1Database,
  request: Request,
  _env: { TURNSTILE_SECRET_KEY?: string },
) {
  const body = await parseJson<LoginBody>(request);
  const email = assertEmail(body.email);
  const password = assertPassword(body.password);

  const user = await getUserByEmail(db, email);
  if (!user) throw new HttpError(401, "INVALID_CREDENTIALS", "invalid credentials");
  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) throw new HttpError(401, "INVALID_CREDENTIALS", "invalid credentials");
  await ensurePersonalWorkspaceForUser(db, user.id);

  const sessionToken = await createSessionForUser(db, request, user.id);

  return {
    response: jsonSuccess(sanitizeUser(user)),
    setCookie: buildSessionCookie(sessionToken, true),
  };
}

export async function handleVerifyEmail(db: D1Database, request: Request) {
  const body = await parseJson<VerifyEmailBody>(request);
  if (!body.token) throw new HttpError(400, "VALIDATION_ERROR", "token is required");
  const tokenHash = await sha256(body.token);
  const token = await consumeEmailVerificationToken(db, tokenHash);
  if (!token) throw new HttpError(400, "INVALID_TOKEN", "invalid verification token");
  if (token.used_at) throw new HttpError(400, "TOKEN_USED", "verification token already used");
  if (new Date(token.expires_at).getTime() <= Date.now()) {
    throw new HttpError(400, "TOKEN_EXPIRED", "verification token expired");
  }
  await markUserEmailVerified(db, token.user_id);
  return jsonSuccess({ verified: true });
}

export async function handleVerifyEmailCode(db: D1Database, request: Request) {
  const body = await parseJson<VerifyEmailCodeBody>(request);
  const email = assertEmail(body.email);
  const code = (body.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    throw new HttpError(400, "VALIDATION_ERROR", "verification code must be 6 digits");
  }
  const user = await getUserByEmail(db, email);
  if (!user) throw new HttpError(404, "NOT_FOUND", "user not found");
  const codeHash = await sha256(`${email}:${code}`);
  const verificationCode = await getEmailVerificationCodeByEmailAndHash(db, email, codeHash);
  if (!verificationCode) throw new HttpError(400, "INVALID_CODE", "verification code is invalid");
  if (verificationCode.used_at) throw new HttpError(400, "CODE_USED", "verification code already used");
  if (new Date(verificationCode.expires_at).getTime() <= Date.now()) {
    throw new HttpError(400, "CODE_EXPIRED", "verification code expired");
  }
  await markEmailVerificationCodeUsed(db, verificationCode.id);
  await markUserEmailVerified(db, user.id);
  const sessionToken = await createSessionForUser(db, request, user.id);
  const updatedUser = await getUserByEmail(db, email);
  if (!updatedUser) throw new HttpError(500, "INTERNAL_ERROR", "failed to verify user");
  return {
    response: jsonSuccess(sanitizeUser(updatedUser)),
    setCookie: buildSessionCookie(sessionToken, true),
  };
}

export async function handleResendVerificationCode(
  db: D1Database,
  request: Request,
  env: {
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    APP_NAME?: string;
  },
) {
  const body = await parseJson<ResendVerificationCodeBody>(request);
  const email = assertEmail(body.email);
  const user = await getUserByEmail(db, email);
  if (!user) throw new HttpError(404, "NOT_FOUND", "user not found");
  if (user.email_verified_at) throw new HttpError(409, "ALREADY_VERIFIED", "email already verified");
  const verificationExpiresAt = await issueEmailVerificationCode(db, user, env);
  return jsonSuccess({
    pending_verification: true as const,
    email: user.email,
    email_masked: maskEmail(user.email),
    verification_expires_at: verificationExpiresAt,
  });
}

export async function handleForgotPassword(
  db: D1Database,
  request: Request,
  env: {
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    APP_BASE_URL?: string;
    APP_NAME?: string;
    TURNSTILE_SECRET_KEY?: string;
  },
) {
  const body = await parseJson<ForgotPasswordBody>(request);
  await verifyTurnstile(body.turnstile_token, request, env);
  const email = assertEmail(body.email);
  const user = await getUserByEmail(db, email);

  if (user && env.RESEND_API_KEY && env.EMAIL_FROM && env.APP_BASE_URL) {
    const token = randomToken(32);
    const tokenHash = await sha256(token);
    await insertPasswordResetToken(db, {
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt: tokenExpiry(2),
    });
    const baseUrl = env.APP_BASE_URL.replace(/\/$/, "");
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const fallbackResetUrl = `${baseUrl}/?mode=reset-password&token=${encodeURIComponent(token)}`;
    await sendEmailByResend({
      apiKey: env.RESEND_API_KEY,
      from: env.EMAIL_FROM,
      to: user.email,
      subject: `重置你的 ${env.APP_NAME ?? "Nexus Notes"} 密码`,
      html: `
        <p>点击下面的链接重置密码：</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>如果第一个链接打开的是登录页，请使用下面这个备用链接：</p>
        <p><a href="${fallbackResetUrl}">${fallbackResetUrl}</a></p>
        <p>或者把下面的 Token 手动粘贴到重置页面：</p>
        <p><code>${token}</code></p>
      `,
    });
  }

  return jsonSuccess({ ok: true });
}

export async function handleResetPassword(
  db: D1Database,
  request: Request,
  env: { TURNSTILE_SECRET_KEY?: string },
) {
  const body = await parseJson<ResetPasswordBody>(request);
  await verifyTurnstile(body.turnstile_token, request, env);
  const password = assertPassword(body.password);
  if (!body.token) throw new HttpError(400, "VALIDATION_ERROR", "token is required");

  const tokenHash = await sha256(body.token);
  const token = await getPasswordResetTokenByHash(db, tokenHash);
  if (!token) throw new HttpError(400, "INVALID_TOKEN", "invalid reset token");
  if (token.used_at) throw new HttpError(400, "TOKEN_USED", "reset token already used");
  if (new Date(token.expires_at).getTime() <= Date.now()) {
    throw new HttpError(400, "TOKEN_EXPIRED", "reset token expired");
  }

  const passwordHash = await hashPassword(password);
  await updateUserPassword(db, token.user_id, passwordHash);
  await markPasswordResetTokenUsed(db, token.id);
  return jsonSuccess({ reset: true });
}
