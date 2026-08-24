import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "../src/notes/MarkdownPreview";

describe("MarkdownPreview", () => {
  it("renders common Markdown blocks without interpreting raw HTML", () => {
    render(
      <MarkdownPreview content={'# 计划\n\n- [x] 已完成\n- [ ] 待办\n\n```ts\nconst value = 1;\n```\n\n[文档](https://example.com)\n<script>alert("xss")</script>'} />,
    );

    expect(screen.getByRole("heading", { name: "计划" })).toBeVisible();
    expect(screen.getByText("已完成")).toBeVisible();
    expect(screen.getByText("待办")).toBeVisible();
    expect(screen.getByRole("link", { name: "文档" })).toHaveAttribute("href", "https://example.com");
    expect(screen.getByText('<script>alert("xss")</script>')).toBeVisible();
    expect(screen.getByText("const value = 1;")).toBeVisible();
  });

  it("does not create unsafe links from unsupported protocols", () => {
    render(<MarkdownPreview content="[危险](javascript:alert(1))" />);
    expect(screen.queryByRole("link", { name: "危险" })).not.toBeInTheDocument();
    expect(screen.getByText("危险")).toBeVisible();
  });
});
