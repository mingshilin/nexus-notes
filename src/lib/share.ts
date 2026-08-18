export function buildAppBaseUrl() {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildNoteDeepLink(noteId: string) {
  if (typeof window === "undefined") return `?note=${encodeURIComponent(noteId)}`;
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("note", noteId);
  return url.toString();
}

export function buildPublicShareLink(token: string) {
  if (typeof window === "undefined") return `?share=${encodeURIComponent(token)}`;
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("share", token);
  return url.toString();
}

export async function copyTextToClipboard(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    throw new Error("当前浏览器不支持复制");
  }
  await navigator.clipboard.writeText(value);
}
