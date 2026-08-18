import type { ApiResponse } from "@/types/api";

export const AUTH_INVALID_EVENT = "nexus-notes:auth-invalid";

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.details = details;
  }
}

interface ApiRequestInit extends RequestInit {
  suppressAuthInvalid?: boolean;
}

async function parseJson<T>(response: Response): Promise<ApiResponse<T>> {
  try {
    return (await response.json()) as ApiResponse<T>;
  } catch {
    const text = await response.text().catch(() => "");
    const message = response.ok
      ? "服务返回格式异常，请刷新后重试。"
      : `请求失败（${response.status}）。`;
    return {
      success: false,
      error: {
        code: "INVALID_RESPONSE",
        message: text.trim() ? message : "服务暂时不可用，请稍后重试。",
      },
    } as ApiResponse<T>;
  }
}

function emitAuthInvalid(code: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_INVALID_EVENT, { detail: { code } }));
}

function getBaseHeaders(headers?: HeadersInit) {
  return {
    "Content-Type": "application/json",
    ...(headers ?? {}),
  };
}

export async function request<T>(path: string, options?: ApiRequestInit): Promise<T> {
  const { suppressAuthInvalid = false, ...fetchOptions } = options ?? {};
  const response = await fetch(path, {
    headers: getBaseHeaders(fetchOptions.headers),
    ...fetchOptions,
  });

  const json = await parseJson<T>(response);
  if (!response.ok || !json.success) {
    if (response.status === 401 && !suppressAuthInvalid) {
      emitAuthInvalid(json.success ? "UNAUTHORIZED" : json.error.code);
    }
    if (json.success) {
      throw new ApiClientError("HTTP_ERROR", "请求失败");
    }
    throw new ApiClientError(json.error.code, json.error.message, json.error.details);
  }

  return json.data;
}

export async function requestWithMeta<T>(
  path: string,
  options?: ApiRequestInit,
): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const { suppressAuthInvalid = false, ...fetchOptions } = options ?? {};
  const response = await fetch(path, {
    headers: getBaseHeaders(fetchOptions.headers),
    ...fetchOptions,
  });

  const json = await parseJson<T>(response);
  if (!response.ok || !json.success) {
    if (response.status === 401 && !suppressAuthInvalid) {
      emitAuthInvalid(json.success ? "UNAUTHORIZED" : json.error.code);
    }
    if (json.success) {
      throw new ApiClientError("HTTP_ERROR", "请求失败");
    }
    throw new ApiClientError(json.error.code, json.error.message, json.error.details);
  }

  return { data: json.data, meta: json.meta };
}
