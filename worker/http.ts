export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResponse<T> =
  | { success: true; data: T; meta?: Record<string, unknown> }
  | { success: false; error: ApiErrorBody };

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://challenges.cloudflare.com https://*.challenges.cloudflare.com",
  "font-src 'self' data:",
  "frame-src https://challenges.cloudflare.com https://*.challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function jsonSuccess<T>(
  data: T,
  init: ResponseInit = {},
  meta?: Record<string, unknown>,
) {
  const body: ApiResponse<T> = meta ? { success: true, data, meta } : { success: true, data };
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

export function jsonError(error: ApiErrorBody, status = 400) {
  const body: ApiResponse<never> = { success: false, error };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function okMessage(id: string) {
  return jsonSuccess({ id });
}

export async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "请求体不是合法 JSON");
  }
}

export function assertString(
  value: unknown,
  field: string,
  options?: { min?: number; max?: number; allowEmpty?: boolean },
) {
  if (typeof value !== "string") {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 必须是字符串`);
  }
  const normalized = value.trim();
  if (!options?.allowEmpty && normalized.length === 0) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 不能为空`);
  }
  if (options?.min && normalized.length < options.min) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 长度不能小于 ${options.min}`);
  }
  if (options?.max && normalized.length > options.max) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 长度不能大于 ${options.max}`);
  }
  return value;
}

export function assertBooleanOrUndefined(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 必须是布尔值`);
  }
  return value;
}

export function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${field} 必须是数组`);
  }
  const normalized = value.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new HttpError(400, "VALIDATION_ERROR", `${field} 包含非法值`);
    }
    return item;
  });
  return normalized;
}

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function securityHeaders() {
  return {
    "Content-Security-Policy": contentSecurityPolicy,
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "X-Frame-Options": "DENY",
  };
}
