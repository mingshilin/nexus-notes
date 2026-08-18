import { request } from "@/api/client";
import type {
  AuthUser,
  LoginPayload,
  PendingVerificationAuth,
  RegisterPayload,
  VerifyEmailCodePayload,
} from "@/types/auth";

export function register(payload: RegisterPayload) {
  return request<PendingVerificationAuth>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload: LoginPayload) {
  return request<AuthUser>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function logout() {
  return request<{ ok: boolean }>("/api/auth/logout", {
    method: "POST",
  });
}

export function getCurrentUser() {
  return request<AuthUser>("/api/auth/me", { suppressAuthInvalid: true });
}

export function verifyEmail(token: string) {
  return request<{ verified: boolean }>("/api/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function verifyEmailCode(payload: VerifyEmailCodePayload) {
  return request<AuthUser>("/api/auth/verify-email-code", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resendVerificationCode(email: string) {
  return request<PendingVerificationAuth>("/api/auth/resend-verification-code", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function forgotPassword(email: string) {
  return request<{ ok: boolean }>("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function forgotPasswordWithTurnstile(email: string, turnstile_token: string) {
  return request<{ ok: boolean }>("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email, turnstile_token }),
  });
}

export function resetPassword(token: string, password: string, turnstile_token?: string) {
  return request<{ reset: boolean }>("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password, turnstile_token }),
  });
}
