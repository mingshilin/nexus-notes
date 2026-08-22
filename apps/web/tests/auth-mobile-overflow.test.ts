import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("mobile authentication overflow", () => {
  it("keeps the auth page viewport-bound and vertically scrollable when the keyboard reduces height", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const mobileRules = css.slice(css.indexOf("@media (max-width: 767px)"));

    expect(mobileRules).toMatch(/\.auth-page\s*\{\s*height:\s*100dvh/);
    expect(mobileRules).toMatch(/\.auth-page\s*\{[^}]*min-height:\s*0/);
    expect(mobileRules).toMatch(/\.auth-page\s*\{[^}]*overflow-y:\s*auto/);
  });

  it("keeps account tabs contained, forms one-column, content wrapped, and CSS valid at 390px and 200% zoom", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(css).not.toMatch(/100vw/);
    expect(css).not.toMatch(/min\(100%\s*-\s*\d+px/);
    expect(css).toMatch(/\.account-tabs[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.account-tabs[^}]*max-width:\s*100%/);
    expect(css).toMatch(/\.account-form-grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.account-form-grid, \.account-invite-form, \.account-metric-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.account-panel[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.mobile-bottom-nav[^}]*env\(safe-area-inset-bottom\)/);
    expect(css).toMatch(/\.mobile-create-note[^}]*var\(--keyboard-inset/);
    expect(css).toMatch(/visibility:\s*hidden/);
    expect(css).toMatch(/button, input, select\s*\{\s*min-height:\s*40px/);
  });
});
