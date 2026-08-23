import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Tag } from "@nexus/contracts";
import { NoteTagPanel } from "../src/notes/NoteTagPanel";

function tag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: "tag-research",
    workspace_id: "ws-1",
    name: "研究",
    color: "",
    revision: 1,
    created_at: "2026-08-23T00:00:00.000Z",
    updated_at: "2026-08-23T00:00:00.000Z",
    ...overrides,
  };
}

describe("NoteTagPanel", () => {
  it("toggles an existing tag and reports the complete selection", () => {
    const onChange = vi.fn();
    render(<NoteTagPanel tags={[tag(), tag({ id: "tag-ideas", name: "想法" })]} selectedTagIds={["tag-research"]} onChange={onChange} />);

    expect(screen.getByRole("checkbox", { name: "标签：研究" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "标签：想法" }));
    expect(onChange).toHaveBeenCalledWith(["tag-research", "tag-ideas"]);
  });

  it("creates a tag, selects it, and exposes a recoverable save error", async () => {
    const onChange = vi.fn();
    const onCreateTag = vi.fn(async () => tag({ id: "tag-new", name: "新分类" }));
    render(
      <NoteTagPanel
        tags={[tag()]}
        selectedTagIds={[]}
        onChange={onChange}
        onCreateTag={onCreateTag}
        error="标签保存失败，请重试。"
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "新建标签" }), { target: { value: "新分类" } });
    fireEvent.click(screen.getByRole("button", { name: "创建标签" }));

    await waitFor(() => expect(onCreateTag).toHaveBeenCalledWith("新分类"));
    expect(onChange).toHaveBeenCalledWith(["tag-new"]);
    expect(screen.getByRole("alert")).toHaveTextContent("标签保存失败，请重试。");
  });
});
