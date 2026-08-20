import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ComponentType, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

type WebExports = Record<string, unknown>;

async function loadWeb() {
  return (await import("../src/index")) as WebExports;
}

interface WorkbenchProps {
  mode: "desktop" | "tablet" | "mobile";
  navigation: ReactNode;
  contextualList: ReactNode;
  inspector: ReactNode;
  inspectorOpen: boolean;
  activePane?: "context" | "canvas";
  onInspectorClose: () => void;
  children: ReactNode;
}

describe("adaptive workbench", () => {
  it("uses the locked responsive breakpoints", async () => {
    const web = await loadWeb();
    expect(web.resolveWorkbenchMode).toBeTypeOf("function");
    const resolveWorkbenchMode = web.resolveWorkbenchMode as (width: number) => string;

    expect(resolveWorkbenchMode(390)).toBe("mobile");
    expect(resolveWorkbenchMode(767)).toBe("mobile");
    expect(resolveWorkbenchMode(768)).toBe("tablet");
    expect(resolveWorkbenchMode(1279)).toBe("tablet");
    expect(resolveWorkbenchMode(1280)).toBe("desktop");
  });

  it("shows rail, contextual list, canvas and overlay inspector on desktop", async () => {
    const web = await loadWeb();
    expect(web.AdaptiveWorkbench).toBeTypeOf("function");
    const AdaptiveWorkbench = web.AdaptiveWorkbench as ComponentType<WorkbenchProps>;
    const close = vi.fn();

    const { container } = render(
      createElement(
        AdaptiveWorkbench,
        {
          mode: "desktop",
          navigation: "Navigation",
          contextualList: "Notes",
          inspector: "Inspector",
          inspectorOpen: true,
          onInspectorClose: close,
        },
        "Editor",
      ),
    );

    expect(screen.getByRole("navigation", { name: "主导航" })).toHaveTextContent("Navigation");
    expect(screen.getByRole("complementary", { name: "上下文列表" })).toHaveTextContent("Notes");
    expect(screen.getByRole("main")).toHaveTextContent("Editor");
    expect(screen.getByRole("dialog", { name: "检查器" })).toHaveTextContent("Inspector");
    expect(container.querySelectorAll('[data-scroll-owner="page"]')).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "关闭检查器" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("renders exactly one task pane on mobile", async () => {
    const web = await loadWeb();
    const AdaptiveWorkbench = web.AdaptiveWorkbench as ComponentType<WorkbenchProps>;
    const { container, rerender } = render(
      createElement(
        AdaptiveWorkbench,
        {
          mode: "mobile",
          activePane: "canvas",
          navigation: "Navigation",
          contextualList: "Notes",
          inspector: "Inspector",
          inspectorOpen: false,
          onInspectorClose: vi.fn(),
        },
        "Editor",
      ),
    );

    expect(screen.getAllByTestId("task-pane")).toHaveLength(1);
    expect(screen.getByTestId("task-pane")).toHaveTextContent("Editor");
    expect(screen.getByRole("navigation", { name: "移动端主导航" })).toBeVisible();

    rerender(
      createElement(
        AdaptiveWorkbench,
        {
          mode: "mobile",
          activePane: "context",
          navigation: "Navigation",
          contextualList: "Notes",
          inspector: "Inspector",
          inspectorOpen: false,
          onInspectorClose: vi.fn(),
        },
        "Editor",
      ),
    );
    expect(screen.getAllByTestId("task-pane")).toHaveLength(1);
    expect(screen.getByTestId("task-pane")).toHaveTextContent("Notes");
    expect(container.querySelectorAll('[data-scroll-owner="page"]')).toHaveLength(1);
  });
});
