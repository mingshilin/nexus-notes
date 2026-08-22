export type WorkbenchMode = "desktop" | "tablet" | "mobile";

export function resolveWorkbenchMode(width: number): WorkbenchMode {
  if (width < 768) return "mobile";
  if (width < 1280) return "tablet";
  return "desktop";
}

export interface MobileChromeState {
  visible: boolean;
  lastScrollTop: number;
  textFocused: boolean;
  keyboardInset: number;
}

export type MobileChromeEvent =
  | { type: "scroll"; scrollTop: number }
  | { type: "text-focus"; focused: boolean }
  | { type: "keyboard"; inset: number };

export function createMobileChromeState(): MobileChromeState {
  return {
    visible: true,
    lastScrollTop: 0,
    textFocused: false,
    keyboardInset: 0,
  };
}

export function reduceMobileChrome(
  state: MobileChromeState,
  event: MobileChromeEvent,
): MobileChromeState {
  if (event.type === "text-focus") {
    return {
      ...state,
      textFocused: event.focused,
      visible: event.focused ? false : state.keyboardInset === 0,
    };
  }
  if (event.type === "keyboard") {
    return {
      ...state,
      keyboardInset: Math.max(0, event.inset),
      visible: event.inset > 0 ? false : !state.textFocused,
    };
  }
  const scrollTop = Math.max(0, event.scrollTop);
  const delta = scrollTop - state.lastScrollTop;
  let visible = state.visible;
  if (scrollTop <= 8 || delta < -6) visible = true;
  if (delta > 6) visible = false;
  return { ...state, visible, lastScrollTop: scrollTop };
}

export function calculateKeyboardInset(
  layoutHeight: number,
  viewport: Pick<VisualViewport, "height" | "offsetTop">,
) {
  return Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop));
}
