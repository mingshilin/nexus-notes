interface GatewayHandler<TEnv> {
  fetch(request: Request, env: TEnv): Promise<Response> | Response;
}

export interface SecureGatewayOptions<TEnv> {
  allowedOrigins: Iterable<string>;
  handler: GatewayHandler<TEnv> | ((request: Request, env: TEnv) => Promise<Response> | Response);
}

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

function appendVary(headers: Headers, value: string) {
  const current = headers.get("vary");
  const values = new Set((current ? current.split(",") : []).map((item) => item.trim()).filter(Boolean));
  values.add(value);
  headers.set("vary", [...values].join(", "));
}

function applySecurityHeaders(headers: Headers, allowedOrigin?: string) {
  headers.set("content-security-policy", contentSecurityPolicy);
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains; preload");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  if (allowedOrigin) {
    headers.set("access-control-allow-origin", allowedOrigin);
    headers.set("access-control-allow-credentials", "true");
    appendVary(headers, "Origin");
  }
}

function cloneWithHeaders(response: Response, allowedOrigin?: string) {
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers, allowedOrigin);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createSecureGateway<TEnv>({ allowedOrigins, handler }: SecureGatewayOptions<TEnv>) {
  const allowlist = new Set([...allowedOrigins].map((origin) => origin.trim()).filter(Boolean));
  const dispatch = typeof handler === "function" ? handler : handler.fetch.bind(handler);

  return {
    async fetch(request: Request, env: TEnv) {
      const origin = request.headers.get("origin") ?? undefined;
      const allowedOrigin = origin && allowlist.has(origin) ? origin : undefined;
      if (origin && !allowedOrigin) {
        return cloneWithHeaders(new Response(JSON.stringify({
          success: false,
          error: { code: "CORS_ORIGIN_DENIED", message: "Origin is not allowed", retryable: false },
        }), {
          status: 403,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        }));
      }

      if (request.method === "OPTIONS") {
        const headers = new Headers({
          "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "access-control-allow-headers": "Content-Type, Idempotency-Key, X-Workspace-Id",
          "access-control-max-age": "86400",
        });
        applySecurityHeaders(headers, allowedOrigin);
        return new Response(null, { status: 204, headers });
      }

      return cloneWithHeaders(await dispatch(request, env), allowedOrigin);
    },
  };
}
