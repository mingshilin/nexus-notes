import type React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let resolvePreviewImport: ((value: { default: React.ComponentType<object> }) => void) | null = null;

vi.mock("@/components/editor/markdownPreviewLoader", async () => {
  const React = await import("react");

  return {
    preloadMarkdownPreview: vi.fn(),
    LazyMarkdownPreview: React.lazy(
      () =>
        new Promise<{ default: React.ComponentType<object> }>((resolve) => {
          resolvePreviewImport = resolve;
        }),
    ),
  };
});

import { NoteEditor } from "@/components/editor/NoteEditor";

afterEach(() => {
  resolvePreviewImport?.({ default: () => null });
  resolvePreviewImport = null;
  cleanup();
});

describe("NoteEditor preview loading", () => {
  it("shows a lightweight fallback while the markdown preview chunk is loading", () => {
    render(
      <NoteEditor
        title="Preview title"
        content="# Hello"
        editorMode="preview"
        onTitleChange={vi.fn()}
        onContentChange={vi.fn()}
        onOpenWikiLink={vi.fn()}
      />,
    );

    expect(screen.getByText("正在加载预览...")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("开始写作，输入 / 唤起命令...")).not.toBeInTheDocument();
  });

  it("uploads pdf attachments as markdown links instead of images", async () => {
    const onContentChange = vi.fn();
    const onUploadAttachment = vi.fn().mockResolvedValue("/api/attachments/pdf-1/file");
    const { container } = render(
      <NoteEditor
        title="Attachment title"
        content=""
        editorMode="write"
        onTitleChange={vi.fn()}
        onContentChange={onContentChange}
        onOpenWikiLink={vi.fn()}
        onUploadAttachment={onUploadAttachment}
      />,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["%PDF-1.7"], "guide.pdf", { type: "application/pdf" });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledWith(file));
    expect(onContentChange).toHaveBeenCalledWith("[guide](/api/attachments/pdf-1/file)");
  });

  it("reveals attachment upload from the mobile editor surface on focus", () => {
    render(
      <NoteEditor
        title="Mobile attachment"
        content=""
        editorMode="write"
        onTitleChange={vi.fn()}
        onContentChange={vi.fn()}
        onOpenWikiLink={vi.fn()}
        onUploadAttachment={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "移动端上传附件" })).not.toBeInTheDocument();

    const [, body] = screen.getAllByRole("textbox");
    fireEvent.focus(body);

    expect(screen.getByRole("button", { name: "移动端上传附件" })).toBeInTheDocument();
  });
});
