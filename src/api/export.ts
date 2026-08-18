import { ApiClientError } from "@/api/client";

export type NoteExportFormat = "md" | "txt" | "html" | "csv" | "pdf" | "docx";
export type AllExportFormat = "json" | "zip" | "csv" | "pdf" | "docx" | "html" | "txt";

async function parseDownloadError(response: Response): Promise<never> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as {
        success?: boolean;
        error?: { code?: string; message?: string; details?: unknown };
      };
      const code = payload.error?.code ?? "HTTP_ERROR";
      const message = payload.error?.message ?? `导出失败（${response.status}）`;
      throw new ApiClientError(code, message, payload.error?.details);
    } catch {
      // ignore and use fallback below
    }
  }
  if (response.status === 401) throw new ApiClientError("UNAUTHORIZED", "登录状态失效，请重新登录");
  if (response.status === 403) throw new ApiClientError("FORBIDDEN", "当前账号没有导出权限");
  if (response.status === 404) throw new ApiClientError("NOT_FOUND", "导出对象不存在");
  if (response.status === 400) throw new ApiClientError("VALIDATION_ERROR", "导出格式不可用");
  throw new ApiClientError("HTTP_ERROR", `导出失败（${response.status}）`);
}

function triggerNativeDownload(path: string, fallbackName: string) {
  if (typeof document === "undefined") {
    throw new ApiClientError("UNSUPPORTED", "当前环境不支持导出");
  }
  const anchor = document.createElement("a");
  anchor.href = path;
  anchor.download = fallbackName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  window.setTimeout(() => anchor.remove(), 0);
}

async function download(path: string, fallbackName: string) {
  let response: Response;
  try {
    response = await fetch(path, {
      headers: {
        accept: "application/octet-stream,application/json;q=0.9,*/*;q=0.8",
      },
    });
  } catch {
    throw new ApiClientError("NETWORK_ERROR", "网络异常，导出失败");
  }

  if (!response.ok) await parseDownloadError(response);

  triggerNativeDownload(path, fallbackName);
}

export function downloadNote(noteId: string, format: NoteExportFormat) {
  return download(`/api/export/note/${noteId}.${format}`, `note-${noteId}.${format}`);
}

export function downloadAll(format: AllExportFormat) {
  return download(`/api/export/all.${format}`, `nexus-notes-export.${format}`);
}

export function downloadNoteMarkdown(noteId: string) {
  return downloadNote(noteId, "md");
}
