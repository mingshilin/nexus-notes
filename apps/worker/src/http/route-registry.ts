import {
  createFailureResponse,
  createSuccessResponse,
  type WorkspaceContext,
} from "@nexus/contracts";
import { hasWorkspaceRole, type WorkspaceRole } from "@nexus/domain";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type RouteAuth = "public" | "session" | "workspace";

interface BodySchema<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | { success: false; error: { flatten(): unknown } };
}

export interface RouteContext<TEnv, TBody = unknown> {
  request: Request;
  env: TEnv;
  requestId: string;
  params: Record<string, string>;
  body: TBody;
  signal: AbortSignal;
  principal?: SessionPrincipal;
  workspace?: WorkspaceContext;
}

export interface SessionPrincipal {
  userId: string;
  sessionId?: string;
}

export interface RouteResult<T> {
  data: T;
  status?: number;
  meta?: Record<string, unknown>;
  headers?: HeadersInit;
}

export interface RouteDefinition<TEnv, TBody = unknown, TData = unknown> {
  method: HttpMethod;
  path: `/api/v2/${string}`;
  auth: RouteAuth;
  minimumRole?: WorkspaceRole;
  timeoutMs?: number;
  rateLimit?: {
    bucket: "ip" | "account" | "workspace";
    limit: number;
    windowSeconds: number;
  };
  quota?: string;
  body?: BodySchema<TBody>;
  handler(context: RouteContext<TEnv, TBody>): RouteResult<TData> | Response | Promise<RouteResult<TData> | Response>;
}

export interface GatewayHookContext<TEnv> {
  request: Request;
  env: TEnv;
  requestId: string;
  body?: unknown;
}

export interface RouteRegistryOptions<TEnv> {
  requestId?: () => string;
  maxBodyBytes?: number;
  authenticate?(context: GatewayHookContext<TEnv>): Promise<SessionPrincipal | null>;
  authorizeWorkspace?(
    principal: SessionPrincipal,
    workspaceId: string,
    context: GatewayHookContext<TEnv>,
  ): Promise<WorkspaceContext | null>;
  enforceRateLimit?(
    policy: NonNullable<RouteDefinition<TEnv>["rateLimit"]>,
    context: GatewayHookContext<TEnv>,
  ): Promise<void>;
  enforceQuota?(
    quota: string,
    context: GatewayHookContext<TEnv> & { principal?: SessionPrincipal; workspace?: WorkspaceContext },
  ): Promise<void>;
}

interface RegisteredRoute<TEnv> {
  definition: RouteDefinition<TEnv, unknown, unknown>;
  segments: string[];
}

function splitPath(path: string) {
  return path.split("/").filter(Boolean);
}

function matchPath(segments: string[], pathname: string) {
  const candidate = splitPath(pathname);
  if (candidate.length !== segments.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < segments.length; index += 1) {
    const expected = segments[index];
    const actual = candidate[index];
    if (expected.startsWith(":")) {
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

function jsonResponse(payload: unknown, status: number, requestId: string, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("x-request-id", requestId);
  return new Response(JSON.stringify(payload), {
    status,
    headers,
  });
}

function rawResponse(response: Response, requestId: string) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", headers.get("cache-control") ?? "no-store");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("x-request-id", requestId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

interface TrustedHttpError extends Error {
  code: string;
  status: number;
  retryable: boolean;
  details?: Record<string, unknown>;
  retryAfterSeconds?: number;
}

class RouteDeadlineError extends Error implements TrustedHttpError {
  readonly code = "DEADLINE_EXCEEDED";
  readonly status = 504;
  readonly retryable = true;

  constructor() {
    super("Request deadline exceeded");
    this.name = "RouteDeadlineError";
  }
}

type JsonBodyResult =
  | { success: true; value: unknown }
  | { success: false; reason: "too_large" | "invalid_json" };

async function readJsonBody(request: Request, maxBodyBytes: number): Promise<JsonBodyResult> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    return { success: false, reason: "too_large" };
  }
  if (!request.body) return { success: false, reason: "invalid_json" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBodyBytes) {
      await reader.cancel();
      return { success: false, reason: "too_large" };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { success: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { success: false, reason: "invalid_json" };
  }
}

function isTrustedHttpError(error: unknown): error is TrustedHttpError {
  if (!(error instanceof Error)) return false;
  const candidate = error as Partial<TrustedHttpError>;
  return typeof candidate.code === "string"
    && typeof candidate.status === "number"
    && candidate.status >= 400
    && candidate.status <= 599
    && typeof candidate.retryable === "boolean";
}

function thrownErrorResponse(error: unknown, requestId: string) {
  if (isTrustedHttpError(error)) {
    const headers = error.retryAfterSeconds
      ? { "retry-after": String(error.retryAfterSeconds) }
      : undefined;
    return jsonResponse(
      createFailureResponse(
        {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.details ? { details: error.details } : {}),
        },
        requestId,
      ),
      error.status,
      requestId,
      headers,
    );
  }
  return jsonResponse(
    createFailureResponse(
      { code: "INTERNAL_ERROR", message: "Unexpected request failure", retryable: true },
      requestId,
    ),
    500,
    requestId,
  );
}

export function createRouteRegistry<TEnv = unknown>(options: RouteRegistryOptions<TEnv> = {}) {
  const routes: RegisteredRoute<TEnv>[] = [];
  const createRequestId = options.requestId ?? (() => crypto.randomUUID());
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;

  return {
    register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>) {
      const duplicate = routes.some(
        (route) => route.definition.method === definition.method && route.definition.path === definition.path,
      );
      if (duplicate) throw new Error(`Duplicate route: ${definition.method} ${definition.path}`);
      routes.push({
        definition: definition as RouteDefinition<TEnv, unknown, unknown>,
        segments: splitPath(definition.path),
      });
    },

    async fetch(request: Request, env: TEnv) {
      const requestId = createRequestId();
      const url = new URL(request.url);
      const pathMatches = routes
        .map((route) => ({ route, params: matchPath(route.segments, url.pathname) }))
        .filter((entry): entry is { route: RegisteredRoute<TEnv>; params: Record<string, string> } => entry.params !== null);
      const matched = pathMatches.find((entry) => entry.route.definition.method === request.method);

      if (!matched) {
        const methodNotAllowed = pathMatches.length > 0;
        const status = methodNotAllowed ? 405 : 404;
        const code = methodNotAllowed ? "METHOD_NOT_ALLOWED" : "NOT_FOUND";
        return jsonResponse(
          createFailureResponse(
            { code, message: methodNotAllowed ? "Method not allowed" : "Route not found", retryable: false },
            requestId,
          ),
          status,
          requestId,
        );
      }

      let body: unknown;
      if (matched.route.definition.body) {
        const input = await readJsonBody(request, maxBodyBytes);
        if (!input.success) {
          const tooLarge = input.reason === "too_large";
          return jsonResponse(
            createFailureResponse(
              {
                code: tooLarge ? "BODY_TOO_LARGE" : "INVALID_JSON",
                message: tooLarge ? "Request body exceeds the allowed size" : "Request body must be valid JSON",
                retryable: false,
              },
              requestId,
            ),
            tooLarge ? 413 : 400,
            requestId,
          );
        }
        body = input.value;
      }

      const hookContext: GatewayHookContext<TEnv> = { request, env, requestId, body };
      let principal: SessionPrincipal | undefined;
      let workspace: WorkspaceContext | undefined;

      if (matched.route.definition.rateLimit && options.enforceRateLimit) {
        try {
          await options.enforceRateLimit(matched.route.definition.rateLimit, hookContext);
        } catch (error) {
          return thrownErrorResponse(error, requestId);
        }
      }

      if (matched.route.definition.auth !== "public") {
        try {
          principal = await options.authenticate?.(hookContext) ?? undefined;
        } catch (error) {
          return thrownErrorResponse(error, requestId);
        }
        if (!principal) {
          return jsonResponse(
            createFailureResponse(
              { code: "UNAUTHENTICATED", message: "Authentication is required", retryable: false },
              requestId,
            ),
            401,
            requestId,
          );
        }
      }

      if (matched.route.definition.auth === "workspace") {
        const workspaceId = request.headers.get("x-workspace-id");
        if (!workspaceId) {
          return jsonResponse(
            createFailureResponse(
              { code: "WORKSPACE_REQUIRED", message: "Workspace context is required", retryable: false },
              requestId,
            ),
            400,
            requestId,
          );
        }
        try {
          workspace = principal
            ? await options.authorizeWorkspace?.(principal, workspaceId, hookContext) ?? undefined
            : undefined;
        } catch (error) {
          return thrownErrorResponse(error, requestId);
        }
        if (!workspace || (matched.route.definition.minimumRole && !hasWorkspaceRole(workspace.role, matched.route.definition.minimumRole))) {
          return jsonResponse(
            createFailureResponse(
              { code: "FORBIDDEN", message: "Workspace permission denied", retryable: false },
              requestId,
            ),
            403,
            requestId,
          );
        }
      }

      if (matched.route.definition.quota && options.enforceQuota) {
        try {
          await options.enforceQuota(matched.route.definition.quota, { ...hookContext, principal, workspace });
        } catch (error) {
          return thrownErrorResponse(error, requestId);
        }
      }

      if (matched.route.definition.body) {
        const parsed = matched.route.definition.body.safeParse(body);
        if (!parsed.success) {
          return jsonResponse(
            createFailureResponse(
              {
                code: "VALIDATION_ERROR",
                message: "Request body failed validation",
                retryable: false,
                details: { fields: parsed.error.flatten() },
              },
              requestId,
            ),
            400,
            requestId,
          );
        }
        body = parsed.data;
      }

      const controller = new AbortController();
      const timeoutMs = matched.route.definition.timeoutMs ?? 15_000;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort(new DOMException("Request deadline exceeded", "TimeoutError"));
            reject(new RouteDeadlineError());
          }, timeoutMs);
        });
        const result = await Promise.race([
          matched.route.definition.handler({
            request,
            env,
            requestId,
            params: matched.params,
            body,
            signal: controller.signal,
            principal,
            workspace,
          }),
          deadline,
        ]);
        if (result instanceof Response) return rawResponse(result, requestId);
        return jsonResponse(
          createSuccessResponse(result.data, requestId, result.meta),
          result.status ?? 200,
          requestId,
          result.headers,
        );
      } catch (error) {
        return thrownErrorResponse(error, requestId);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  };
}
