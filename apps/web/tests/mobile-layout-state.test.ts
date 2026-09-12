import { describe, expect, it } from "vitest";

type WebExports = Record<string, unknown>;

async function loadWeb() {
  return (await import("../src/index")) as WebExports;
}

describe("mobile layout state", () => {
  it("hides chrome on downward scroll or text entry and restores it safely", async () => {
    const web = await loadWeb();
    expect(web.createMobileChromeState).toBeTypeOf("function");
    expect(web.reduceMobileChrome).toBeTypeOf("function");
    const createState = web.createMobileChromeState as () => unknown;
    const reduce = web.reduceMobileChrome as (state: unknown, event: unknown) => { visible: boolean };

    let state = createState();
    expect((state as { visible: boolean }).visible).toBe(true);
    state = reduce(state, { type: "scroll", scrollTop: 40 });
    expect(state.visible).toBe(false);
    state = reduce(state, { type: "scroll", scrollTop: 20 });
    expect(state.visible).toBe(true);
    state = reduce(state, { type: "text-focus", focused: true });
    expect(state.visible).toBe(false);
    state = reduce(state, { type: "text-focus", focused: false });
    expect(state.visible).toBe(true);
    state = reduce(state, { type: "text-focus", focused: true });
    state = reduce(state, { type: "viewport-scale", scale: 2 });
    expect(state.visible).toBe(true);
    expect((state as { zoomed: boolean }).zoomed).toBe(true);
    state = reduce(state, { type: "viewport-scale", scale: 1 });
    expect(state.visible).toBe(false);
    expect((state as { zoomed: boolean }).zoomed).toBe(false);
  });

  it("calculates keyboard-safe visual viewport inset", async () => {
    const web = await loadWeb();
    expect(web.calculateKeyboardInset).toBeTypeOf("function");
    const calculateKeyboardInset = web.calculateKeyboardInset as (
      layoutHeight: number,
      viewport: { height: number; offsetTop: number },
    ) => number;

    expect(calculateKeyboardInset(844, { height: 844, offsetTop: 0 })).toBe(0);
    expect(calculateKeyboardInset(844, { height: 524, offsetTop: 0 })).toBe(320);
    expect(calculateKeyboardInset(844, { height: 524, offsetTop: 20 })).toBe(300);
    expect(calculateKeyboardInset(844, { height: 422, offsetTop: 0, scale: 2 })).toBe(0);
  });

  it("keeps navigation visible for a shrunken viewport until text entry is focused", async () => {
    const web = await loadWeb();
    const createState = web.createMobileChromeState as () => unknown;
    const reduce = web.reduceMobileChrome as (state: unknown, event: unknown) => { visible: boolean };

    let state = createState();
    state = reduce(state, { type: "keyboard", inset: 344 });
    expect(state.visible).toBe(true);
    state = reduce(state, { type: "text-focus", focused: true });
    expect(state.visible).toBe(false);
    state = reduce(state, { type: "keyboard", inset: 344 });
    expect(state.visible).toBe(false);
  });
});
