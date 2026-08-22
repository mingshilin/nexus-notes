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
  contextualList?: ReactNode;
  inspector?: ReactNode;
  inspectorOpen: boolean;
  activePane?: "context" | "canvas";
  onActivePaneChange?: (pane: "context" | "canvas") => void;
  onInspectorOpen?: (opener: HTMLElement) => void;
  onInspectorClose: () => void;
  children: ReactNode;
}

const WorkbenchModalContext = createContext<(open: boolean) => void>(() => undefined);
const WorkbenchModalOpenContext = createContext(false);

export function useWorkbenchModalState() {
  return useContext(WorkbenchModalContext);
}

export function useWorkbenchModalOpen() {
  return useContext(WorkbenchModalOpenContext);
}

function Canvas({ children, mobile = false, modalOpen = false }: { children: ReactNode; mobile?: boolean; modalOpen?: boolean }) {
  return (
    <main className="workbench-canvas" data-testid={mobile ? "task-pane" : undefined} aria-hidden={modalOpen || undefined} inert={modalOpen || undefined}>
      <PageScrollArea scrollOwner={!modalOpen}>{children}</PageScrollArea>
    </main>
  );
}

export function AdaptiveWorkbench({
  mode,
  navigation,
  mobileNavigation,
  mobileCreateAction,
  contextualList,
  inspector,
  inspectorOpen,
  activePane = "canvas",
  onActivePaneChange,
  onInspectorOpen,
  onInspectorClose,
  children,
}: AdaptiveWorkbenchProps) {
  const detectedMode = useWorkbenchMode();
  const currentMode = mode ?? detectedMode;
  const mobileChrome = useMobileChrome();
  const mobile = currentMode === "mobile";
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [childModalOpen, setChildModalOpen] = useState(false);
  const inspectorModalOpen = inspectorOpen && Boolean(inspector);
  const modalOpen = childModalOpen || inspectorModalOpen;
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
      <Surface variant="window" className="adaptive-workbench" data-mode={currentMode} data-has-context={Boolean(contextualList)} data-mobile-chrome-visible={mobile ? mobileChromeVisible : undefined}>
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
          <Canvas mobile modalOpen={modalOpen}>{children}</Canvas>
        )
      ) : (
        <Canvas modalOpen={modalOpen}>{children}</Canvas>
      )}

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
