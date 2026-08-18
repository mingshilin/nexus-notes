import { lazy } from "react";

let markdownPreviewPromise: Promise<{ default: typeof import("./MarkdownPreview").MarkdownPreview }> | null = null;

function loadMarkdownPreview() {
  if (!markdownPreviewPromise) {
    markdownPreviewPromise = import("./MarkdownPreview")
      .then((mod) => ({ default: mod.MarkdownPreview }))
      .catch((error) => {
        markdownPreviewPromise = null;
        throw error;
      });
  }

  return markdownPreviewPromise;
}

export const LazyMarkdownPreview = lazy(loadMarkdownPreview);

export function preloadMarkdownPreview() {
  return loadMarkdownPreview().then(() => undefined);
}
