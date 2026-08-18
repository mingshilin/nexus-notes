import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";

afterEach(() => {
  cleanup();
});

describe("AppShell mobile pane switching", () => {
  it("shows note list when mobile primary pane is list", () => {
    render(
      <AppShell
        topTabs={<div>tabs</div>}
        sidebar={<div>sidebar</div>}
        mobileSidebar={<div>mobile sidebar</div>}
        noteList={<div>note list pane</div>}
        main={<div>main pane</div>}
        rightPanel={<div>right</div>}
        mobilePrimaryPane="list"
        mobileInspectorOpen={false}
        onShowList={() => undefined}
        onShowMain={() => undefined}
        onToggleInspector={() => undefined}
        mobileNavigationVersion={1}
      />,
    );

    expect(screen.getAllByText("note list pane").length).toBeGreaterThan(0);
  });

  it("shows main pane when mobile primary pane is main", () => {
    render(
      <AppShell
        topTabs={<div>tabs</div>}
        sidebar={<div>sidebar</div>}
        mobileSidebar={<div>mobile sidebar</div>}
        noteList={<div>note list pane</div>}
        main={<div>main pane</div>}
        rightPanel={<div>right</div>}
        mobilePrimaryPane="main"
        mobileInspectorOpen={false}
        onShowList={() => undefined}
        onShowMain={() => undefined}
        onToggleInspector={() => undefined}
        mobileNavigationVersion={1}
      />,
    );

    expect(screen.getAllByText("main pane").length).toBeGreaterThan(0);
  });

  it("exposes bottom navigation actions on mobile", () => {
    const onShowList = vi.fn();
    const onShowMain = vi.fn();
    const onToggleInspector = vi.fn();

    render(
      <AppShell
        topTabs={<div>tabs</div>}
        sidebar={<div>sidebar</div>}
        mobileSidebar={<div>mobile sidebar</div>}
        noteList={<div>note list pane</div>}
        main={<div>main pane</div>}
        rightPanel={<div>right</div>}
        mobilePrimaryPane="list"
        mobileInspectorOpen={false}
        onShowList={onShowList}
        onShowMain={onShowMain}
        onToggleInspector={onToggleInspector}
        mobileNavigationVersion={1}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "信息" }));
    fireEvent.click(screen.getByRole("button", { name: "列表" }));

    expect(onShowMain).toHaveBeenCalledTimes(1);
    expect(onToggleInspector).toHaveBeenCalledTimes(1);
    expect(onShowList).toHaveBeenCalledTimes(1);
  });

  it("does not reserve the desktop inspector column when the inspector is closed", () => {
    const { rerender } = render(
      <AppShell
        topTabs={<div>tabs</div>}
        sidebar={<div>sidebar</div>}
        mobileSidebar={<div>mobile sidebar</div>}
        noteList={<div>note list pane</div>}
        main={<div>main pane</div>}
        rightPanel={<div>right inspector</div>}
        mobilePrimaryPane="main"
        mobileInspectorOpen={false}
        onShowList={() => undefined}
        onShowMain={() => undefined}
        onToggleInspector={() => undefined}
        mobileNavigationVersion={1}
      />,
    );

    expect(screen.queryByText("right inspector")).not.toBeInTheDocument();

    rerender(
      <AppShell
        topTabs={<div>tabs</div>}
        sidebar={<div>sidebar</div>}
        mobileSidebar={<div>mobile sidebar</div>}
        noteList={<div>note list pane</div>}
        main={<div>main pane</div>}
        rightPanel={<div>right inspector</div>}
        mobilePrimaryPane="main"
        mobileInspectorOpen
        onShowList={() => undefined}
        onShowMain={() => undefined}
        onToggleInspector={() => undefined}
        mobileNavigationVersion={1}
      />,
    );

    expect(screen.getAllByText("right inspector").length).toBeGreaterThan(0);
  });

  it("marks the editor inspector toggle as pressed when the inspector is open", async () => {
    const { EditorHeader } = await import("@/components/editor/EditorHeader");
    const note = {
      id: "note-1",
      folder_id: null,
      folder: null,
      title: "Note",
      content: "",
      is_favorite: false,
      is_pinned: false,
      is_daily: false,
      daily_date: null,
      created_at: "2026-05-25T00:00:00.000Z",
      updated_at: "2026-05-25T00:00:00.000Z",
      deleted_at: null,
      archived_at: null,
      last_opened_at: null,
      tags: [],
    };

    render(
      <EditorHeader
        note={note}
        editorMode="write"
        saveStatus="idle"
        saveError={null}
        focusMode={false}
        inspectorOpen
        onModeChange={() => undefined}
        onSaveNow={() => undefined}
        onRetrySave={() => undefined}
        onToggleFavorite={() => undefined}
        onTogglePinned={() => undefined}
        onArchiveToggle={() => undefined}
        onDuplicate={() => undefined}
        onCopyInternalLink={() => undefined}
        onFocusModeToggle={() => undefined}
        onOpenHistory={() => undefined}
        onOpenMoveFolder={() => undefined}
        onOpenTemplatePicker={() => undefined}
        onOpenQuickReminder={() => undefined}
        onShare={() => undefined}
        onExportMarkdown={() => undefined}
        onDelete={() => undefined}
        onToggleInspector={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭信息面板" })).toHaveTextContent("关闭信息");
  });

  it("hides mobile chrome while scrolling down and restores it when scrolling up", () => {
    render(
      <AppShell
        topTabs={<div>tabs</div>}
        sidebar={<div>sidebar</div>}
        mobileSidebar={<div>mobile sidebar</div>}
        noteList={<div data-testid="scroll-target">note list pane</div>}
        main={<div>main pane</div>}
        rightPanel={<div>right</div>}
        mobilePrimaryPane="list"
        mobileInspectorOpen={false}
        onShowList={() => undefined}
        onShowMain={() => undefined}
        onToggleInspector={() => undefined}
        mobileNavigationVersion={1}
      />,
    );

    const nav = screen.getByRole("navigation");
    const topToolbar = screen.getByTestId("mobile-top-toolbar");
    const scrollTarget = screen.getAllByTestId("scroll-target").at(-1)!;

    Object.defineProperty(scrollTarget, "scrollTop", { value: 120, configurable: true });
    fireEvent.scroll(scrollTarget);
    expect(nav).toHaveClass("translate-y-full");
    expect(topToolbar).toHaveClass("-translate-y-full");
    expect(topToolbar).toHaveClass("h-0");

    Object.defineProperty(scrollTarget, "scrollTop", { value: 24, configurable: true });
    fireEvent.scroll(scrollTarget);
    expect(nav).not.toHaveClass("translate-y-full");
    expect(topToolbar).not.toHaveClass("-translate-y-full");
    expect(topToolbar).toHaveClass("h-[calc(46px+env(safe-area-inset-top))]");
  });

  it("hides mobile chrome while a text input is focused", () => {
    render(
      <AppShell
        topTabs={<div>tabs</div>}
        sidebar={<div>sidebar</div>}
        mobileSidebar={<div>mobile sidebar</div>}
        noteList={<div>note list pane</div>}
        main={<input aria-label="editor input" />}
        rightPanel={<div>right</div>}
        mobilePrimaryPane="main"
        mobileInspectorOpen={false}
        onShowList={() => undefined}
        onShowMain={() => undefined}
        onToggleInspector={() => undefined}
        mobileNavigationVersion={1}
      />,
    );

    const nav = screen.getByRole("navigation");
    const topToolbar = screen.getByTestId("mobile-top-toolbar");
    const input = screen.getByLabelText("editor input");

    fireEvent.focusIn(input);
    expect(nav).toHaveClass("translate-y-full");
    expect(topToolbar).toHaveClass("-translate-y-full");

    fireEvent.focusOut(input);
    expect(nav).not.toHaveClass("translate-y-full");
    expect(topToolbar).not.toHaveClass("-translate-y-full");
  });
});
