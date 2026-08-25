import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("permanent note delete styling", () => {
  it("uses destructive controls without allowing the generic account action rule to override them", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(css).toMatch(/\.note-lifecycle-action\.note-lifecycle-danger\s*\{[^}]*color:\s*hsl\(var\(--destructive\)\)/);
    expect(css).toMatch(/\.account-actions button\.account-danger-button\s*\{[^}]*background:\s*hsl\(var\(--destructive\)\)/);
    expect(css.indexOf(".account-actions button.account-danger-button")).toBeGreaterThan(css.indexOf(".account-actions button:last-child"));
  });

  it("keeps the 390px dialog within safe areas and makes tall content scrollable", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const mobileRules = css.slice(css.indexOf("@media (max-width: 767px)"));

    expect(mobileRules).toMatch(/\.account-dialog-backdrop\s*\{[^}]*env\(safe-area-inset-top\)/);
    expect(mobileRules).toMatch(/\.account-dialog-backdrop\s*\{[^}]*env\(safe-area-inset-bottom\)/);
    expect(mobileRules).toMatch(/\.account-dialog-backdrop\s*\{[^}]*overflow-y:\s*auto/);
    expect(mobileRules).toMatch(/\.account-confirm-dialog\s*\{[^}]*max-height:\s*calc\(100dvh/);
    expect(mobileRules).toMatch(/\.account-confirm-dialog\s*\{[^}]*overflow-y:\s*auto/);
  });
});
