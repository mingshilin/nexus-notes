import { toast, type ExternalToast } from "sonner";
import { ApiClientError } from "@/api/client";
import { getErrorMessage } from "@/lib/errorMessages";

export type ToastCategory = "success" | "failure" | "permission" | "network" | "configuration";

export function getErrorToastCategory(error: unknown): Exclude<ToastCategory, "success"> {
  const code = error instanceof ApiClientError ? error.code : "";
  const raw = error instanceof Error ? error.message.toLowerCase() : typeof error === "string" ? error.toLowerCase() : "";

  if (code === "FORBIDDEN" || code === "UNAUTHORIZED" || raw.includes("permission") || raw.includes("read-only")) {
    return "permission";
  }
  if (code === "NETWORK_ERROR" || raw.includes("network") || raw.includes("failed to fetch")) {
    return "network";
  }
  if (
    code === "CONFIG_ERROR" ||
    code === "R2_DISABLED" ||
    code === "UNSUPPORTED" ||
    raw.includes("not configured") ||
    raw.includes("未配置")
  ) {
    return "configuration";
  }
  return "failure";
}

export function getToastClassName(category: ToastCategory) {
  return `nexus-toast nexus-toast-${category}`;
}

export function showSuccessToast(message: string, options?: ExternalToast) {
  toast.success(message, { ...options, className: getToastClassName("success") });
}

export function showErrorToast(error: unknown, fallback = "操作失败", options?: ExternalToast) {
  const category = getErrorToastCategory(error);
  toast.error(getErrorMessage(error, fallback), { ...options, className: getToastClassName(category) });
}
