import type { ApiClient } from "../data/api-client";
import {
  AuthSessionSchema,
  CreateWorkspaceInputSchema,
  WorkspaceMembershipSummarySchema,
  type AuthSession,
  type CreateWorkspaceInput,
  type WorkspaceMembershipSummary,
} from "@nexus/contracts";

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
}

export class AuthClient {
  constructor(private readonly client: Pick<ApiClient, "request">) {}

  session(): Promise<AuthSession> {
    return this.client.request<unknown>({
      path: "/api/v2/auth/session",
      requestClass: "query",
      policy: { timeoutMs: 8_000, retry: 1, dedupeKey: "auth:session" },
      }).then((session) => AuthSessionSchema.parse(session));
  }

  createWorkspace(input: CreateWorkspaceInput, signal?: AbortSignal): Promise<WorkspaceMembershipSummary> {
    return this.client.request<unknown>({
      path: "/api/v2/workspaces",
      method: "POST",
      body: CreateWorkspaceInputSchema.parse(input),
      requestClass: "command",
      policy: { timeoutMs: 10_000, retry: 0, idempotencyKey: crypto.randomUUID(), signal },
    }).then((workspace) => WorkspaceMembershipSummarySchema.parse(workspace));
  }

  login(input: { email: string; password: string; turnstileToken?: string }) {
    return this.client.request<{ user: AuthUser }>({
      path: "/api/v2/auth/login",
      method: "POST",
      body: {
        email: input.email,
        password: input.password,
        ...(input.turnstileToken ? { turnstile_token: input.turnstileToken } : {}),
      },
      requestClass: "command",
      policy: { timeoutMs: 10_000, retry: 0 },
    });
  }

  register(input: { email: string; password: string; displayName: string; turnstileToken: string }) {
    return this.client.request<{ userId: string; email: string; verificationRequired: true }>({
      path: "/api/v2/auth/register",
      method: "POST",
      body: {
        email: input.email,
        password: input.password,
        display_name: input.displayName,
        turnstile_token: input.turnstileToken,
      },
      requestClass: "command",
      policy: { timeoutMs: 12_000, retry: 0 },
    });
  }

  verifyEmail(input: { email: string; code: string }) {
    return this.client.request<{ verified: true }>({
      path: "/api/v2/auth/verify-email",
      method: "POST",
      body: input,
      requestClass: "command",
      policy: { timeoutMs: 8_000, retry: 0 },
    });
  }

  resendVerification(input: { email: string; turnstileToken: string }) {
    return this.client.request<{ accepted: true }>({
      path: "/api/v2/auth/resend-verification",
      method: "POST",
      body: { email: input.email, turnstile_token: input.turnstileToken },
      requestClass: "command",
      policy: { timeoutMs: 10_000, retry: 0 },
    });
  }

  forgotPassword(input: { email: string; turnstileToken: string }) {
    return this.client.request<{ accepted: true }>({
      path: "/api/v2/auth/forgot-password",
      method: "POST",
      body: { email: input.email, turnstile_token: input.turnstileToken },
      requestClass: "command",
      policy: { timeoutMs: 10_000, retry: 0 },
    });
  }

  resetPassword(input: { token: string; password: string }) {
    return this.client.request<{ reset: true }>({
      path: "/api/v2/auth/reset-password",
      method: "POST",
      body: input,
      requestClass: "command",
      policy: { timeoutMs: 10_000, retry: 0 },
    });
  }

  logout() {
    return this.client.request<{ logged_out: true }>({
      path: "/api/v2/auth/logout",
      method: "POST",
      requestClass: "command",
      policy: { timeoutMs: 8_000, retry: 0 },
    });
  }
}
