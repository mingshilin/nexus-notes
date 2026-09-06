import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("mobile zoom editor clearance", () => {
  it("bounds the note body above fixed navigation only while zoomed", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(css).toMatch(
      /\.adaptive-workbench\[data-mode="mobile"\]\[data-zoomed="true"\] \.note-editor-copy \.note-editor-surface-body > textarea\s*\{[^}]*min-height:\s*min\(42dvh, 360px\)/u,
    );
    expect(css).toContain('.adaptive-workbench[data-mode="mobile"][data-zoomed="true"]');
  });
});
