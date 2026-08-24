import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette, type CommandAction } from "../src/commands/CommandPalette";

const actions: CommandAction[] = [
  { id: "note", label: "新建笔记", description: "开始一篇新的笔记", keywords: ["new", "note"], onSelect: vi.fn() },
  { id: "account", label: "个人资料与设置", description: "修改个人信息和安全设置", keywords: ["profile"], onSelect: vi.fn() },
];

describe("CommandPalette", () => {
  it("filters actions and executes the highlighted action with Enter", () => {
    render(<CommandPalette open query="profile" actions={actions} onQueryChange={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByRole("option", { name: /新建笔记/ })).not.toBeInTheDocument();
    const account = screen.getByRole("option", { name: /个人资料与设置/ });
    expect(account).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "搜索命令" }), { key: "Enter" });
    expect(actions[1]!.onSelect).toHaveBeenCalledTimes(1);
  });

  it("moves selection with arrows and closes on Escape", () => {
    const onClose = vi.fn();
    render(<CommandPalette open query="" actions={actions} onQueryChange={vi.fn()} onClose={onClose} />);
    const input = screen.getByRole("searchbox", { name: "搜索命令" });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /个人资料与设置/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
