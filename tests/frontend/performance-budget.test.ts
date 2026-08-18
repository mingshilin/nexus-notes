import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(filePath: string) {
  return readFileSync(join(process.cwd(), filePath), "utf8");
}

describe("frontend performance budgets", () => {
  it("keeps heavy markdown and OCR dependencies out of the synchronous app entry", () => {
    const main = source("src/main.tsx");
    const app = source("src/App.tsx");
    const entry = `${main}\n${app}`;

    expect(main.length).toBeLessThan(2400);
    expect(entry).not.toContain("react-markdown");
    expect(entry).not.toContain("remark-gfm");
    expect(entry).not.toContain("tesseract.js");
    expect(entry).not.toContain("pdfjs-dist");
  });

  it("loads Markdown preview and OCR engines only through async boundaries", () => {
    const markdownLoader = source("src/components/editor/markdownPreviewLoader.ts");
    const markdownPreview = source("src/components/editor/MarkdownPreview.tsx");
    const knowledgeCenter = source("src/components/knowledge/KnowledgeCenterPage.tsx");

    expect(markdownLoader).toContain('import("./MarkdownPreview")');
    expect(markdownPreview).toContain("react-markdown");
    expect(markdownPreview).toContain("remark-gfm");
    expect(knowledgeCenter).toContain('await import("@/lib/ocrEngine")');
  });

  it("keeps Vite manual chunks for markdown, OCR, app, UI, and React vendors", () => {
    const viteConfig = source("vite.config.ts");

    expect(viteConfig).toContain("markdown-vendor");
    expect(viteConfig).toContain("ocr-vendor");
    expect(viteConfig).toContain("react-vendor");
    expect(viteConfig).toContain("ui-vendor");
    expect(viteConfig).toContain("app-vendor");
  });
});
