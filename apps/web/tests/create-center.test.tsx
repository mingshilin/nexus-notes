import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { CreateCenter } from "../src/create/CreateCenter";

function CreateCenterHarness({ onCreateNote = vi.fn(), onQuickCapture = vi.fn() }: {
  onCreateNote?: () => void;
  onQuickCapture?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <CreateCenter
      open={open}
      onOpenChange={setOpen}
      onCreateNote={onCreateNote}
      onQuickCapture={onQuickCapture}
      onTodayNote={vi.fn()}
      onCreateDatabase={vi.fn()}
    />
  );
}

describe("CreateCenter", () => {
  it("opens from the visible create-content trigger and runs quick capture", () => {
    const onQuickCapture = vi.fn();
    render(<CreateCenterHarness onQuickCapture={onQuickCapture} />);

    fireEvent.click(screen.getByRole("button", { name: "创建内容" }));

    expect(screen.getByRole("dialog", { name: "创建内容" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建笔记" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "快速捕获" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "快速捕获" }));

    expect(onQuickCapture).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "创建内容" })).not.toBeInTheDocument();
  });

  it("explains unavailable actions instead of exposing silent no-op buttons", () => {
    render(<CreateCenterHarness />);
    fireEvent.click(screen.getByRole("button", { name: "创建内容" }));

    const reminder = screen.getByRole("button", { name: "新建提醒，即将开放" });
    const importer = screen.getByRole("button", { name: "导入内容，即将开放" });
    expect(reminder).toBeDisabled();
    expect(importer).toBeDisabled();
    expect(screen.getAllByText("即将开放").length).toBeGreaterThanOrEqual(2);
  });

  it("is visible in the authenticated App and opens the real quick-capture flow", async () => {
    const apiClient = {
      request: vi.fn(async () => ({ items: [], next_cursor: null })),
    };
    render(
      <App
        authClient={{ session: vi.fn(async () => ({
          user: { id: "u1", email: "u@example.test", displayName: "用户" },
          workspaces: [{ id: "ws-1", name: "个人", slug: "personal", role: "owner" as const, revision: 1 }],
          active_workspace_id: "ws-1",
        })) } as any}
        apiClient={apiClient as any}
        turnstileSiteKey="test"
      />,
    );

    expect(await screen.findByRole("heading", { name: "功能地图" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "创建内容" }));
    fireEvent.click(screen.getByRole("button", { name: "快速捕获" }));
    expect(await screen.findByRole("dialog", { name: "快速捕获" })).toBeInTheDocument();
  });
});
