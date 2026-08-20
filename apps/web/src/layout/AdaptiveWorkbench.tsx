import { Surface } from "@nexus/ui";
import { X } from "lucide-react";
import { type ReactNode } from "react";
import { PageScrollArea } from "./PageScrollArea";
import { type WorkbenchMode } from "./layout-state";
import { useMobileChrome, useWorkbenchMode } from "./use-mobile-layout";

export interface AdaptiveWorkbenchProps {
  mode?: WorkbenchMode;
  navigation: ReactNode;
  contextualList?: ReactNode;
  inspector?: ReactNode;
  inspectorOpen: boolean;
  activePane?: "context" | "canvas";
  onActivePaneChange?: (pane: "context" | "canvas") => void;
  onInspectorOpen?: () => void;
  onInspectorClose: () => void;
  children: ReactNode;
}

function Canvas({ children, mobile = false }: { children: ReactNode; mobile?: boolean }) {
  return (
    <main className="workbench-canvas" data-testid={mobile ? "task-pane" : undefined}>
      <PageScrollArea>{children}</PageScrollArea>
    </main>
  );
}

export function AdaptiveWorkbench({
  mode,
  navigation,
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

  return (
    <Surface variant="window" className="adaptive-workbench" data-mode={currentMode}>
      {!mobile ? (
        <nav className="workbench-rail" aria-label="主导航">
          {navigation}
        </nav>
      ) : (
        <header className="mobile-toolbar" data-visible={mobileChrome.visible}>
          <strong>Nexus Notes</strong>
          {inspector && !inspectorOpen ? (
            <button type="button" onClick={onInspectorOpen}>检查器</button>
          ) : null}
        </header>
      )}

      {currentMode === "desktop" && contextualList ? (
        <aside className="workbench-context" aria-label="上下文列表">
          {contextualList}
        </aside>
      ) : null}

      {currentMode === "tablet" && activePane === "context" && contextualList ? (
        <aside className="workbench-context-drawer" aria-label="上下文列表" data-testid="task-pane">
          {contextualList}
        </aside>
      ) : null}

      {mobile ? (
        activePane === "context" && contextualList ? (
          <main className="workbench-context-mobile" data-testid="task-pane" data-scroll-owner="page">
            {contextualList}
          </main>
        ) : (
          <Canvas mobile>{children}</Canvas>
        )
      ) : (
        <Canvas>{children}</Canvas>
      )}

      {inspectorOpen && inspector ? (
        <div className="inspector-backdrop" onMouseDown={onInspectorClose}>
          <Surface
            as="aside"
            variant="overlay"
            className="workbench-inspector"
            role="dialog"
            aria-label="检查器"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="inspector-close" type="button" aria-label="关闭检查器" onClick={onInspectorClose}>
              <X aria-hidden="true" size={17} />
            </button>
            {inspector}
          </Surface>
        </div>
      ) : null}

      {mobile ? (
        <nav className="mobile-bottom-nav" data-visible={mobileChrome.visible} aria-label="移动端主导航">
          <button type="button" onClick={() => onActivePaneChange?.("canvas")}>首页</button>
          <button type="button">搜索</button>
          <button type="button">创建</button>
          <button type="button">通知</button>
          <button type="button">账户</button>
        </nav>
      ) : null}
    </Surface>
  );
}
