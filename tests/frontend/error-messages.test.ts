import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/api/client";
import { getErrorMessage } from "@/lib/errorMessages";
import { getErrorToastCategory, getToastClassName } from "@/lib/toastCategories";

describe("error message mapping", () => {
  it("maps API error codes to product-facing Chinese messages", () => {
    expect(getErrorMessage(new ApiClientError("FORBIDDEN", "workspace is read-only"))).toBe("当前工作区权限不足");
    expect(getErrorMessage(new ApiClientError("EMAIL_NOT_VERIFIED", "email is not verified"))).toBe("邮箱尚未验证，请先输入验证码完成验证");
    expect(getErrorMessage(new ApiClientError("R2_DISABLED", "r2 bucket is not configured"))).toBe("当前账号未开通 R2，暂时无法上传文件");
  });

  it("maps known raw backend messages when no structured code is available", () => {
    expect(getErrorMessage(new Error("folder already exists"))).toBe("文件夹名称已存在");
    expect(getErrorMessage(new Error("unsupported attachment type"))).toBe("仅支持 png/jpg/webp/gif 图片或 PDF");
    expect(getErrorMessage(new Error("not allowed to export"))).toBe("当前账号没有导出权限");
  });

  it("falls back without swallowing unknown errors", () => {
    expect(getErrorMessage("bad", "兜底错误")).toBe("兜底错误");
    expect(getErrorMessage(new Error("custom error"), "兜底错误")).toBe("custom error");
  });

  it("classifies error toasts for permissions, network failures, and missing capabilities", () => {
    expect(getErrorToastCategory(new ApiClientError("FORBIDDEN", "workspace is read-only"))).toBe("permission");
    expect(getErrorToastCategory(new ApiClientError("NETWORK_ERROR", "failed to fetch"))).toBe("network");
    expect(getErrorToastCategory(new ApiClientError("R2_DISABLED", "r2 bucket is not configured"))).toBe("configuration");
    expect(getToastClassName("success")).toContain("nexus-toast-success");
  });
});
