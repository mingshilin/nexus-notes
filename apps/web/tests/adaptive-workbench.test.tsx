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
  mobileNavigation?: ReactNode;
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

    expect(container.querySelector(".workbench-rail")).toHaveTextContent("Navigation");
    expect(container.querySelector(".workbench-context")).toHaveTextContent("Notes");
    expect(container.querySelector(".workbench-canvas")).toHaveTextContent("Editor");
    expect(container.querySelector(".workbench-canvas")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("dialog", { name: "检查器" })).toHaveTextContent("Inspector");
    expect(container.querySelectorAll('[data-scroll-owner="inspector"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-scroll-owner]')).toHaveLength(1);

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

  it("keeps the page active when inspectorOpen has no inspector content", async () => {
    const web = await loadWeb();
    const AdaptiveWorkbench = web.AdaptiveWorkbench as ComponentType<WorkbenchProps>;
    const { container } = render(createElement(
      AdaptiveWorkbench,
      {
        mode: "desktop",
        navigation: "Navigation",
        contextualList: "Notes",
        inspector: undefined,
        inspectorOpen: true,
        onInspectorClose: vi.fn(),
      },
      "Editor",
    ));

    expect(screen.queryByRole("dialog", { name: "检查器" })).not.toBeInTheDocument();
    expect(container.querySelector(".workbench-canvas")).not.toHaveAttribute("aria-hidden");
    expect(container.querySelectorAll('[data-scroll-owner="page"]')).toHaveLength(1);
  });

  it("keeps one page scroll owner on the tablet canvas", async () => {
    const web = await loadWeb();
    const AdaptiveWorkbench = web.AdaptiveWorkbench as ComponentType<WorkbenchProps>;
    const { container } = render(createElement(
      AdaptiveWorkbench,
      {
        mode: "tablet",
        navigation: "Navigation",
        contextualList: "Notes",
        inspector: "Inspector",
        inspectorOpen: false,
        onInspectorClose: vi.fn(),
      },
      "Editor",
    ));
    const pageScrollArea = container.querySelector<HTMLElement>(".page-scroll-area");
    expect(pageScrollArea).toHaveStyle({ overflowY: "auto" });
    expect(container.querySelectorAll('[data-scroll-owner="page"]')).toHaveLength(1);
  });

  it("suppresses mobile fixed chrome while a modal is open and restores the opener focus", async () => {
    const web = await loadWeb();
    const AdaptiveWorkbench = web.AdaptiveWorkbench as ComponentType<WorkbenchProps>;
    const close = vi.fn();
    const { rerender } = render(createElement(AdaptiveWorkbench, {
      mode: "mobile",
      navigation: "Navigation",
      mobileNavigation: createElement("button", { type: "button" }, "账户"),
      inspector: "Inspector",
      inspectorOpen: false,
      onInspectorClose: close,
      onInspectorOpen: () => undefined,
    }, createElement("div", null, "Editor")));
    rerender(createElement(AdaptiveWorkbench, {
      mode: "mobile",
      navigation: "Navigation",
      mobileNavigation: createElement("button", { type: "button" }, "账户"),
      inspector: "Inspector",
      inspectorOpen: true,
      onInspectorClose: close,
    }, createElement("div", null, "Editor")));
    const mobileNav = document.querySelector<HTMLElement>('.mobile-bottom-nav[aria-label="移动端主导航"]');
    expect(mobileNav).toHaveAttribute("aria-hidden", "true");
    expect(mobileNav).toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: "关闭检查器" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("contains Tab and Shift+Tab inside the inspector while the background is inert", async () => {
    const web = await loadWeb();
    const AdaptiveWorkbench = web.AdaptiveWorkbench as ComponentType<WorkbenchProps>;
    const close = vi.fn();
    const { container } = render(createElement(AdaptiveWorkbench, {
      mode: "desktop",
      navigation: "Navigation",
      contextualList: "Notes",
      inspector: createElement("button", { type: "button" }, "检查器动作"),
      inspectorOpen: true,
      onInspectorClose: close,
    }, "Editor"));

    const dialog = screen.getByRole("dialog", { name: "检查器" });
    const closeButton = screen.getByRole("button", { name: "关闭检查器" });
    const action = screen.getByRole("button", { name: "检查器动作" });
    expect(document.activeElement).toBe(closeButton);
    expect(document.querySelector(".workbench-canvas")).toHaveAttribute("inert");
    expect(container.querySelector('nav[aria-label="主导航"]')).toHaveAttribute("inert");

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(action);
    expect(dialog).toContainElement(document.activeElement);

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(closeButton);
    expect(dialog).toContainElement(document.activeElement);
  });
});
