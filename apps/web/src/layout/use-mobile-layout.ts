import { useEffect, useReducer } from "react";
import {
  calculateKeyboardInset,
  createMobileChromeState,
  reduceMobileChrome,
  resolveWorkbenchMode,
  type WorkbenchMode,
} from "./layout-state";

function readScrollTop(target: EventTarget | null) {
  if (target instanceof HTMLElement) return target.scrollTop;
  return window.scrollY || document.documentElement.scrollTop || 0;
}

function isTextEntry(target: EventTarget | null) {
  return target instanceof HTMLElement
    && target.matches("input, textarea, select, [contenteditable='true']");
}

export function useWorkbenchMode(): WorkbenchMode {
  const [mode, dispatch] = useReducer(
    (_: WorkbenchMode, width: number) => resolveWorkbenchMode(width),
    typeof window === "undefined" ? "desktop" : resolveWorkbenchMode(window.innerWidth),
  );

  useEffect(() => {
    const update = () => dispatch(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return mode;
}

export function useMobileChrome() {
  const [state, dispatch] = useReducer(reduceMobileChrome, undefined, createMobileChromeState);

  useEffect(() => {
    const onScroll = (event: Event) => {
      dispatch({ type: "scroll", scrollTop: readScrollTop(event.target) });
    };
    const onFocusIn = (event: FocusEvent) => {
      if (isTextEntry(event.target)) dispatch({ type: "text-focus", focused: true });
    };
    const onFocusOut = (event: FocusEvent) => {
      if (isTextEntry(event.target)) dispatch({ type: "text-focus", focused: false });
    };
    const updateViewport = () => {
      const viewport = window.visualViewport;
      const inset = viewport ? calculateKeyboardInset(window.innerHeight, viewport) : 0;
      document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
      dispatch({ type: "keyboard", inset });
    };

    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);
    updateViewport();

    return () => {
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("scroll", updateViewport);
    };
  }, []);

  return state;
}
