import { Surface } from "@nexus/ui";
import { X } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { PageScrollArea } from "./PageScrollArea";
import { type WorkbenchMode } from "./layout-state";
import { useMobileChrome, useWorkbenchMode } from "./use-mobile-layout";

export interface AdaptiveWorkbenchProps {
  mode?: WorkbenchMode;
  navigation: ReactNode;
  mobileNavigation?: ReactNode;
  mobileCreateAction?: ReactNode;
  desktopCreateAction?: ReactNode;
  contextualList?: ReactNode;
  inspector?: ReactNode;
  inspectorOpen: boolean;
  externalModalOpen?: boolean;
  activePane?: "context" | "canvas";
  onActivePaneChange?: (pane: "context" | "canvas") => void;
  onInspectorOpen?: (opener: HTMLElement) => void;
  onInspectorClose: () => void;
  persistentLayer?: ReactNode;
  children: ReactNode;
}

const WorkbenchModalContext = createContext<(open: boolean) => void>(() => undefined);
const WorkbenchModalOpenContext = createContext(false);
const focusableSelector = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function useWorkbenchModalState() {
  return useContext(WorkbenchModalContext);
}

export function useWorkbenchModalOpen() {
  return useContext(WorkbenchModalOpenContext);
}

function Canvas({ children, desktopCreateAction, mobile = false, modalOpen = false }: { children: ReactNode; desktopCreateAction?: ReactNode; mobile?: boolean; modalOpen?: boolean }) {
  return (
    <main className="workbench-canvas" data-testid={mobile ? "task-pane" : undefined} aria-hidden={modalOpen || undefined} inert={modalOpen || undefined}>
      <PageScrollArea scrollOwner={!modalOpen}>
        {!mobile && desktopCreateAction ? <div className="desktop-create-note-bar">{desktopCreateAction}</div> : null}
        {children}
      </PageScrollArea>
    </main>
  );
}

export function AdaptiveWorkbench({
  mode,
  navigation,
  mobileNavigation,
  mobileCreateAction,
  desktopCreateAction,
  contextualList,
  inspector,
  inspectorOpen,
  externalModalOpen = false,
  activePane = "canvas",
  onActivePaneChange,
  onInspectorOpen,
  onInspectorClose,
  persistentLayer,
  children,
}: AdaptiveWorkbenchProps) {
  const detectedMode = useWorkbenchMode();
  const currentMode = mode ?? detectedMode;
  const mobileChrome = useMobileChrome();
  const mobile = currentMode === "mobile";
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [childModalOpen, setChildModalOpen] = useState(false);
  const inspectorModalOpen = inspectorOpen && Boolean(inspector);
  const modalOpen = childModalOpen || inspectorModalOpen || externalModalOpen;
  const mobileChromeVisible = mobile && mobileChrome.visible && !modalOpen;

  useEffect(() => {
    if (inspectorModalOpen) closeButtonRef.current?.focus();
  }, [inspectorModalOpen]);

  useEffect(() => {
    if (!modalOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [modalOpen]);

  return (
    <WorkbenchModalContext.Provider value={setChildModalOpen}>
      <WorkbenchModalOpenContext.Provider value={modalOpen}>
      <Surface variant="window" className="adaptive-workbench" data-mode={currentMode} data-has-context={Boolean(contextualList)} data-mobile-chrome-visible={mobile ? mobileChromeVisible : undefined} data-zoomed={mobile && mobileChrome.zoomed ? "true" : undefined}>
      {!mobile ? (
        <nav className="workbench-rail" aria-label="主导航" aria-hidden={modalOpen || undefined} inert={modalOpen || undefined}>
          {navigation}
        </nav>
      ) : (
        <header className="mobile-toolbar" data-visible={mobileChromeVisible} aria-hidden={!mobileChromeVisible || undefined} inert={!mobileChromeVisible || undefined}>
          <strong>Nexus Notes</strong>
          {inspector && !inspectorOpen ? (
            <button type="button" onClick={(event) => onInspectorOpen?.(event.currentTarget)}>检查器</button>
          ) : null}
        </header>
      )}

      {currentMode === "desktop" && contextualList ? (
        <aside className="workbench-context" aria-label="上下文列表" aria-hidden={modalOpen || undefined} inert={modalOpen || undefined}>
          {contextualList}
        </aside>
      ) : null}

      {currentMode === "tablet" && activePane === "context" && contextualList ? (
        <aside className="workbench-context-drawer" aria-label="上下文列表" data-testid="task-pane" aria-hidden={modalOpen || undefined} inert={modalOpen || undefined}>
          {contextualList}
        </aside>
      ) : null}

      {mobile ? (
        activePane === "context" && contextualList ? (
          <main className="workbench-context-mobile" data-testid="task-pane" data-scroll-owner={modalOpen ? undefined : "page"} aria-hidden={modalOpen || undefined} inert={modalOpen || undefined} style={modalOpen ? undefined : { overflowY: "auto" }}>
            {contextualList}
          </main>
        ) : (
          <Canvas mobile desktopCreateAction={desktopCreateAction} modalOpen={modalOpen}>{children}</Canvas>
        )
      ) : (
        <Canvas desktopCreateAction={desktopCreateAction} modalOpen={modalOpen}>{children}</Canvas>
      )}

      {persistentLayer}

      {inspectorModalOpen ? (
        <div className="inspector-backdrop" onMouseDown={onInspectorClose} onKeyDown={(event) => { if (event.key === "Escape") onInspectorClose(); }}>
          <Surface
            as="aside"
            variant="overlay"
            className="workbench-inspector"
            role="dialog"
            aria-label="检查器"
            aria-modal="true"
            data-scroll-owner="inspector"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector)];
              if (focusable.length === 0) {
                event.preventDefault();
                return;
              }
              const first = focusable[0]!;
              const last = focusable.at(-1)!;
              const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
              const nextIndex = event.shiftKey
                ? activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1
                : activeIndex < 0 || activeIndex === focusable.length - 1 ? 0 : activeIndex + 1;
              event.preventDefault();
              (focusable[nextIndex] ?? first).focus();
            }}
          >
            <button ref={closeButtonRef} className="inspector-close" type="button" aria-label="关闭检查器" onClick={onInspectorClose}>
              <X aria-hidden="true" size={17} />
            </button>
            {inspector}
          </Surface>
        </div>
      ) : null}

      {mobile ? (
        <nav className="mobile-bottom-nav" data-visible={mobileChromeVisible} aria-label="移动端主导航" aria-hidden={modalOpen || undefined} inert={modalOpen || undefined} style={!mobileChromeVisible ? { visibility: "hidden", pointerEvents: "none" } : undefined}>
          {mobileNavigation ?? <>
            <button type="button" onClick={() => onActivePaneChange?.("canvas")}>首页</button>
            <button type="button">搜索</button>
            <button type="button">创建</button>
            <button type="button">通知</button>
            <button type="button">账户</button>
          </>}
        </nav>
      ) : null}
      {mobile && mobileCreateAction ? (
        <div className="mobile-create-note" data-visible={mobileChromeVisible} aria-hidden={!mobileChromeVisible || undefined} inert={!mobileChromeVisible || undefined} style={!mobileChromeVisible ? { visibility: "hidden", pointerEvents: "none" } : undefined}>
          {mobileCreateAction}
        </div>
      ) : null}
      </Surface>
      </WorkbenchModalOpenContext.Provider>
    </WorkbenchModalContext.Provider>
  );
}
