import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { describe, expect, it } from "vitest";

type UiExports = Record<string, unknown>;

async function loadUi() {
  return (await import("../src/index")) as UiExports;
}

describe("Nexus design system", () => {
  it("provides semantic glass surface primitives", async () => {
    const ui = await loadUi();
    expect(ui.Surface).toBeTypeOf("function");
    const Surface = ui.Surface as ComponentType<{
      as?: "section";
      variant: "panel";
      children: string;
    }>;

    render(createElement(Surface, { as: "section", variant: "panel" }, "Inspector"));

    expect(screen.getByText("Inspector")).toHaveAttribute("data-surface", "panel");
  });

  it("preserves the established blue accent and surface hierarchy", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../src/tokens.css"), "utf8");

    expect(css).toContain("--nexus-accent: #007aff");
    expect(css).toContain("--surface-sidebar: rgba(255, 255, 255, 0.42)");
    expect(css).toContain("--surface-list: rgba(255, 255, 255, 0.92)");
    expect(css).toContain("--surface-editor: rgba(255, 255, 255, 0.96)");
    expect(css).toContain("--radius-window: 28px");
  });
});
