import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NoteEditorSurface } from "../src/notes/NoteEditorSurface";

function Harness({ initial = "" }: { initial?: string }) {
  const [content, setContent] = useState(initial);
  return (
    <NoteEditorSurface
      value={content}
      onChange={setContent}
      ariaLabel="笔记内容"
    />
  );
}

describe("NoteEditorSurface", () => {
  it("inserts markdown blocks from the editor toolbar at the caret", () => {
    render(<Harness />);
    const editor = screen.getByRole("textbox", { name: "笔记内容" });

    fireEvent.click(screen.getByRole("button", { name: "标题 1" }));
    expect(editor).toHaveValue("# ");

    fireEvent.click(screen.getByRole("button", { name: "任务清单" }));
    expect(editor).toHaveValue("# - [ ] ");
  });

  it("opens slash commands and replaces the command text with a selected block", () => {
    render(<Harness />);
    const editor = screen.getByRole("textbox", { name: "笔记内容" });

    fireEvent.change(editor, { target: { value: "/hea" } });
    expect(screen.getByRole("listbox", { name: "斜杠命令" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /标题 1/u })).toBeInTheDocument();
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(editor).toHaveValue("# ");
    expect(screen.queryByRole("listbox", { name: "斜杠命令" })).not.toBeInTheDocument();
  });

  it("keeps the editor and block actions read-only together", () => {
    render(<NoteEditorSurface value="Body" onChange={() => undefined} readOnly ariaLabel="笔记内容" />);

    expect(screen.getByRole("textbox", { name: "笔记内容" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "标题 1" })).toBeDisabled();
  });

  it("delegates a selected file through an editor attachment control", () => {
    const onUploadAttachment = vi.fn();
    render(<NoteEditorSurface value="Body" onChange={() => undefined} ariaLabel="笔记内容" onUploadAttachment={onUploadAttachment} />);
    const file = new File([new Uint8Array([137, 80, 78, 71])], "diagram.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("插入附件"), { target: { files: [file] } });

    expect(onUploadAttachment).toHaveBeenCalledWith(file);
  });
});
