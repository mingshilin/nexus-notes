export type CollaborationCommentTarget = { type: "note" | "database_record"; id: string; label: string };
export type CollaborationShareTarget = { type: "note" | "database_view"; id: string; label: string };

export interface NotificationTarget {
  targetType: "note" | "database_record";
  targetId: string;
  commentId: string | null;
  databaseId?: string;
}

function errorDetails(error: unknown) {
  return error && typeof error === "object" ? error as { status?: number; code?: string; name?: string } : {};
}

export function collaborationErrorMessage(error: unknown) {
  const { status, code, name } = errorDetails(error);
  if (status === 403 || code === "FORBIDDEN") return "权限不足，无法完成此操作。";
  if (status === 409 || code === "REVISION_CONFLICT" || code === "CONFLICT") return "数据已发生冲突，请刷新后重试。";
  if (status === 429 || code === "RATE_LIMITED") return "操作过于频繁，请稍后重试。";
  if (code === "NETWORK_ERROR" || name === "TypeError") return "网络连接异常，请检查连接后重试。";
  return "协作服务暂时不可用，请稍后重试。";
}
