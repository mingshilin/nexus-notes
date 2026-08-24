import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoteConflictPanel } from "../src/notes/NoteConflictPanel";

describe("NoteConflictPanel", () => {
  it("shows both revisions and exposes explicit local/server recovery actions", () => {
    const onKeepLocal = vi.fn();
    const onUseServer = vi.fn();

    render(
      <NoteConflictPanel
        local={{ title: "本地标题", content: "本地正文" }}
        server={{ title: "服务器标题", content: "服务器正文", revision: 7 }}
        onKeepLocal={onKeepLocal}
        onUseServer={onUseServer}
      />,
    );

    expect(screen.getByRole("region", { name: "笔记冲突恢复" })).toHaveTextContent("本地标题");
    expect(screen.getByRole("region", { name: "笔记冲突恢复" })).toHaveTextContent("服务器正文");
    expect(screen.getByText("服务器版本 · 修订 7")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保留本地版本" }));
    fireEvent.click(screen.getByRole("button", { name: "采用服务器版本" }));

    expect(onKeepLocal).toHaveBeenCalledOnce();
    expect(onUseServer).toHaveBeenCalledOnce();
  });
});
