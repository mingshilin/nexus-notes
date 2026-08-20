import {
  createFailureResponse,
  createSuccessResponse,
  type WorkspaceContext,
} from "@nexus/contracts";

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
  workspace?: WorkspaceContext;
}

export interface RouteResult<T> {
  data: T;
  status?: number;
  meta?: Record<string, unknown>;
}

export interface RouteDefinition<TEnv, TBody = unknown, TData = unknown> {
  method: HttpMethod;
  path: `/api/v2/${string}`;
  auth: RouteAuth;
  timeoutMs?: number;
  rateLimit?: {
    bucket: "ip" | "account" | "workspace";
    limit: number;
    windowSeconds: number;
  };
  quota?: string;
  body?: BodySchema<TBody>;
  handler(context: RouteContext<TEnv, TBody>): RouteResult<TData> | Promise<RouteResult<TData>>;
}

export interface RouteRegistryOptions {
  requestId?: () => string;
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

function jsonResponse(payload: unknown, status: number, requestId: string) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "x-request-id": requestId,
    },
  });
}

export function createRouteRegistry<TEnv = unknown>(options: RouteRegistryOptions = {}) {
  const routes: RegisteredRoute<TEnv>[] = [];
  const createRequestId = options.requestId ?? (() => crypto.randomUUID());

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
        let input: unknown;
        try {
          input = await request.json();
        } catch {
          return jsonResponse(
            createFailureResponse(
              { code: "INVALID_JSON", message: "Request body must be valid JSON", retryable: false },
              requestId,
            ),
            400,
            requestId,
          );
        }
        const parsed = matched.route.definition.body.safeParse(input);
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

      try {
        const result = await matched.route.definition.handler({
          request,
          env,
          requestId,
          params: matched.params,
          body,
        });
        return jsonResponse(
          createSuccessResponse(result.data, requestId, result.meta),
          result.status ?? 200,
          requestId,
        );
      } catch {
        return jsonResponse(
          createFailureResponse(
            { code: "INTERNAL_ERROR", message: "Unexpected request failure", retryable: true },
            requestId,
          ),
          500,
          requestId,
        );
      }
    },
  };
}
