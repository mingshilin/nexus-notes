import { z } from "zod";
import { CreateWorkspaceInputSchema, type AuthSession } from "@nexus/contracts";
import type { RouteDefinition } from "../http/route-registry";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(128),
  display_name: z.string().trim().max(80).optional(),
  turnstile_token: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
  turnstile_token: z.string().min(1).optional(),
});

const verifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

const resendVerificationSchema = z.object({
  email: z.string().email(),
  turnstile_token: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
  turnstile_token: z.string().min(1),
});

const resetPasswordSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(10).max(128),
});

interface AuthRouteService {
  register(input: {
    email: string;
    password: string;
    displayName?: string;
    turnstileToken: string;
    ip: string;
  }): Promise<unknown>;
  login(input: {
    email: string;
    password: string;
    turnstileToken?: string;
    ip: string;
    userAgent: string;
  }): Promise<{ sessionToken: string; user: unknown }>;
  verifyEmail(input: { email: string; code: string }): Promise<void>;
  resendVerification(input: { email: string; turnstileToken: string; ip: string }): Promise<{ accepted: boolean }>;
  requestPasswordReset(input: {
    email: string;
    turnstileToken: string;
    ip: string;
  }): Promise<{ accepted: boolean }>;
  resetPassword(input: { token: string; password: string }): Promise<void>;
  getSession(userId: string): Promise<AuthSession>;
  createWorkspace?(input: { userId: string; name: string }): Promise<unknown>;
  logout(sessionId: string): Promise<void>;
}

interface AuthRegistry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "0.0.0.0";
}

function sessionCookie(token: string) {
  return `nexus_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`;
}

export const expiredSessionCookie = "nexus_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

export function registerAuthRoutes<TEnv>(
  registry: AuthRegistry<TEnv>,
  createService: (env: TEnv) => AuthRouteService,
) {
  registry.register({
    method: "POST",
    path: "/api/v2/auth/register",
    auth: "public",
    body: registerSchema,
    rateLimit: { bucket: "ip", limit: 5, windowSeconds: 10 * 60 },
    handler: async ({ request, env, body }) => ({
      status: 201,
      data: await createService(env).register({
        email: body.email,
        password: body.password,
        displayName: body.display_name,
        turnstileToken: body.turnstile_token,
        ip: clientIp(request),
      }),
    }),
  });

  registry.register({
    method: "POST",
    path: "/api/v2/auth/login",
    auth: "public",
    body: loginSchema,
    rateLimit: { bucket: "account", limit: 10, windowSeconds: 10 * 60 },
    handler: async ({ request, env, body }) => {
      const result = await createService(env).login({
        email: body.email,
        password: body.password,
        turnstileToken: body.turnstile_token,
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent") ?? "",
      });
      return {
        data: { user: result.user },
        headers: { "set-cookie": sessionCookie(result.sessionToken) },
      };
    },
  });

  registry.register({
    method: "POST",
    path: "/api/v2/auth/verify-email",
    auth: "public",
    body: verifyEmailSchema,
    rateLimit: { bucket: "ip", limit: 10, windowSeconds: 10 * 60 },
    handler: async ({ env, body }) => {
      await createService(env).verifyEmail({ email: body.email, code: body.code });
      return { data: { verified: true } };
    },
  });

  registry.register({
    method: "POST",
    path: "/api/v2/auth/forgot-password",
    auth: "public",
    body: forgotPasswordSchema,
    rateLimit: { bucket: "account", limit: 5, windowSeconds: 30 * 60 },
    handler: async ({ request, env, body }) => ({
      data: await createService(env).requestPasswordReset({
        email: body.email,
        turnstileToken: body.turnstile_token,
        ip: clientIp(request),
      }),
    }),
  });

  registry.register({
    method: "POST",
    path: "/api/v2/auth/resend-verification",
    auth: "public",
    body: resendVerificationSchema,
    rateLimit: { bucket: "account", limit: 5, windowSeconds: 30 * 60 },
    handler: async ({ request, env, body }) => ({
      data: await createService(env).resendVerification({
        email: body.email,
        turnstileToken: body.turnstile_token,
        ip: clientIp(request),
      }),
    }),
  });

  registry.register({
    method: "POST",
    path: "/api/v2/auth/reset-password",
    auth: "public",
    body: resetPasswordSchema,
    rateLimit: { bucket: "ip", limit: 10, windowSeconds: 30 * 60 },
    handler: async ({ env, body }) => {
      await createService(env).resetPassword({ token: body.token, password: body.password });
      return { data: { reset: true } };
    },
  });

  registry.register({
    method: "POST",
    path: "/api/v2/workspaces",
    auth: "session",
    body: CreateWorkspaceInputSchema,
    rateLimit: { bucket: "ip", limit: 10, windowSeconds: 60 * 60 },
    handler: async ({ env, principal, body }) => {
      const service = createService(env);
      if (!service.createWorkspace) throw new Error("Workspace creation is unavailable");
      return {
        status: 201,
        data: await service.createWorkspace({ userId: principal!.userId, name: body.name }),
      };
    },
  });

  registry.register({
    method: "GET",
    path: "/api/v2/auth/session",
    auth: "session",
    handler: async ({ env, principal }) => ({
      data: await createService(env).getSession(principal!.userId),
    }),
  });

  registry.register({
    method: "POST",
    path: "/api/v2/auth/logout",
    auth: "session",
    handler: async ({ env, principal }) => {
      if (principal?.sessionId) await createService(env).logout(principal.sessionId);
      return {
        data: { logged_out: true },
        headers: { "set-cookie": expiredSessionCookie },
      };
    },
  });
}
