import { ApiClientError } from "@/api/client";

const messagesByCode: Record<string, string> = {
  DUPLICATE_FOLDER: "文件夹名称已存在",
  VALIDATION_ERROR: "参数不合法",
  SESSION_EXPIRED: "登录已过期，请重新登录",
  UNAUTHORIZED: "未登录或无权限",
  NOT_FOUND: "目标不存在",
  TOKEN_USED: "重置链接已使用，请重新获取",
  TOKEN_EXPIRED: "重置链接已过期，请重新获取",
  INVALID_TOKEN: "重置链接无效，请重新获取",
  INVALID_CODE: "验证码错误，请重新输入",
  CODE_EXPIRED: "验证码已过期，请重新获取",
  CODE_USED: "验证码已失效，请重新获取",
  INVALID_CREDENTIALS: "账号或密码错误",
  EMAIL_NOT_VERIFIED: "邮箱尚未验证，请先输入验证码完成验证",
  ALREADY_VERIFIED: "邮箱已经完成验证，请直接登录",
  BOT_CHECK_FAILED: "人机验证未通过，请重试",
  R2_DISABLED: "当前账号未开通 R2，暂时无法上传文件",
  FORBIDDEN: "当前工作区权限不足",
  EXPIRED: "邀请链接已过期",
  CONFLICT: "该操作已处理或存在冲突",
  CONFIG_ERROR: "服务配置异常，请稍后重试",
  INTERNAL_ERROR: "服务器异常，请稍后重试",
  HTTP_ERROR: "请求失败",
};

function messageFromRawError(raw: string) {
  if (raw.includes("folder already exists")) return "文件夹名称已存在";
  if (raw.includes("folder name is required")) return "文件夹名称不能为空";
  if (raw.includes("failed to create folder")) return "创建文件夹失败";
  if (raw.includes("failed to update folder")) return "重命名文件夹失败";
  if (raw.includes("folder not found")) return "文件夹不存在";
  if (raw.includes("reset token already used")) return "重置链接已使用，请重新获取";
  if (raw.includes("reset token expired")) return "重置链接已过期，请重新获取";
  if (raw.includes("invalid reset token")) return "重置链接无效，请重新获取";
  if (raw.includes("unexpected end of json input")) return "服务响应异常，请稍后重试";
  if (raw.includes("unexpected server error")) return "服务器异常，请稍后重试";
  if (raw.includes("turnstile secret is not configured")) return "人机验证服务配置异常，请联系管理员";
  if (raw.includes("turnstile token is required")) return "请先完成人机验证";
  if (raw.includes("turnstile verification failed")) return "人机验证未通过，请重试";
  if (raw.includes("r2 bucket is not configured")) return "当前账号未开通 R2，暂时无法上传文件";
  if (raw.includes("avatar must be an image")) return "头像文件必须是图片";
  if (raw.includes("unsupported attachment type")) return "仅支持 png/jpg/webp/gif 图片或 PDF";
  if (raw.includes("attachment size exceeds limit")) return "文件过大，请选择 8MB 以内文件";
  if (raw.includes("workspace is read-only")) return "当前工作区为只读权限，无法修改";
  if (raw.includes("invite expired")) return "邀请链接已过期";
  if (raw.includes("invite email does not match current user")) return "当前登录邮箱与邀请邮箱不一致";
  if (raw.includes("email is not verified")) return "邮箱尚未验证，请先输入验证码完成验证";
  if (raw.includes("network error")) return "网络异常，请稍后重试";
  if (raw.includes("download failed")) return "导出失败，请稍后重试";
  if (raw.includes("export failed")) return "导出失败，请稍后重试";
  if (raw.includes("unsupported export format")) return "导出格式不可用";
  if (raw.includes("not allowed to export")) return "当前账号没有导出权限";
  return null;
}

export function getErrorMessage(error: unknown, fallback = "操作失败") {
  if (error instanceof ApiClientError) {
    if (messagesByCode[error.code]) return messagesByCode[error.code];
    const mapped = messageFromRawError((error.message || "").toLowerCase());
    return mapped ?? error.message ?? fallback;
  }

  if (error instanceof Error && error.message) {
    const mapped = messageFromRawError(error.message.toLowerCase());
    return mapped ?? error.message;
  }

  return fallback;
}
