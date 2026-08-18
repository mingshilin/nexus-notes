import { ArrowLeft, FileText, List, Menu, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/branding/BrandMark";
import { BRAND_NAME } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MobilePrimaryPane } from "@/store/useAppStore";

interface AppShellProps {
  topTabs: ReactNode;
  sidebar: ReactNode | null;
  mobileSidebar?: ReactNode | null;
  noteList: ReactNode | null;
  main: ReactNode;
  rightPanel: ReactNode | null;
  mobilePrimaryPane: MobilePrimaryPane;
  mobileInspectorOpen: boolean;
  onShowList: () => void;
  onShowMain: () => void;
  onToggleInspector: () => void;
  mobileNavigationVersion?: number;
}

export function AppShell({
  topTabs,
  sidebar,
  mobileSidebar,
  noteList,
  main,
  rightPanel,
  mobilePrimaryPane,
  mobileInspectorOpen,
  onShowList,
  onShowMain,
  onToggleInspector,
  mobileNavigationVersion = 0,
}: AppShellProps) {
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);
  const [mobileNavHidden, setMobileNavHidden] = useState(false);
  const [mobileInputFocused, setMobileInputFocused] = useState(false);
  const lastScrollTopRef = useRef(0);
  const navRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showMobileList = Boolean(noteList) && mobilePrimaryPane === "list";
  const showMobileMain = !noteList || mobilePrimaryPane === "main";
  const mobileChromeHidden = mobileNavHidden || mobileInputFocused;
  const mobileTitle = showMobileMain ? "编辑" : "笔记";

  useEffect(() => {
    setSidebarDrawerOpen(false);
  }, [mobileNavigationVersion]);

  useEffect(() => {
    return () => {
      if (navRestoreTimerRef.current) {
        clearTimeout(navRestoreTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const clearRestoreTimer = () => {
      if (navRestoreTimerRef.current) {
        clearTimeout(navRestoreTimerRef.current);
        navRestoreTimerRef.current = null;
      }
    };

    const scheduleRestore = () => {
      clearRestoreTimer();
      navRestoreTimerRef.current = setTimeout(() => {
        setMobileNavHidden(false);
      }, 900);
    };

    const readScrollTop = (target: EventTarget | null) => {
      if (target instanceof HTMLElement) return target.scrollTop;
      return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    };

    const handleScroll = (event: Event) => {
      const currentTop = Math.max(0, readScrollTop(event.target));
      const previousTop = lastScrollTopRef.current;
      const delta = currentTop - previousTop;
      lastScrollTopRef.current = currentTop;

      if (currentTop <= 8 || delta < -6) {
        clearRestoreTimer();
        setMobileNavHidden(false);
        return;
      }

      if (delta > 6) {
        setMobileNavHidden(true);
        scheduleRestore();
      }
    };

    const isTextEntryTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return target.matches("input, textarea, select, [contenteditable='true']");
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (isTextEntryTarget(event.target)) {
        clearRestoreTimer();
        setMobileInputFocused(true);
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (isTextEntryTarget(event.target)) {
        setMobileInputFocused(false);
      }
    };

    document.addEventListener("scroll", handleScroll, true);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);

    return () => {
      clearRestoreTimer();
      document.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  useEffect(() => {
    lastScrollTopRef.current = 0;
    setMobileNavHidden(false);
  }, [mobileNavigationVersion, mobilePrimaryPane]);

  return (
    <div className="flex min-h-[100dvh] w-full items-stretch justify-center overflow-x-hidden md:min-h-screen md:p-5">
      <div className="mac-window relative flex h-[100dvh] w-full max-w-[1540px] flex-col overflow-hidden rounded-none md:h-[min(95vh,980px)] md:rounded-[28px]">
        <div className="hidden xl:block">{topTabs}</div>
        <div
          data-testid="mobile-top-toolbar"
          className={cn(
            "glass-toolbar flex shrink-0 items-end justify-between overflow-hidden border-b px-2.5 transition-[height,transform,opacity,padding] duration-200 ease-out xl:hidden",
            mobileChromeHidden
              ? "h-0 -translate-y-full border-b-0 pb-0 pt-0 opacity-0 pointer-events-none"
              : "h-[calc(46px+env(safe-area-inset-top))] pb-1.5 pt-[env(safe-area-inset-top)] opacity-100",
          )}
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-xl"
            aria-label={showMobileMain && noteList ? "返回列表" : "打开导航"}
            onClick={showMobileMain && noteList ? onShowList : () => setSidebarDrawerOpen(true)}
          >
            {showMobileMain && noteList ? <ArrowLeft className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>

          <div className="flex min-w-0 items-center gap-2 px-2">
            <BrandMark compact />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-4">{BRAND_NAME}</div>
              <div className="truncate text-[11px] text-muted-foreground">{mobileTitle}</div>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-xl"
            aria-label={mobileInspectorOpen ? "关闭信息面板" : "打开信息面板"}
            disabled={!rightPanel}
            onClick={onToggleInspector}
          >
            {mobileInspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {sidebar}

          {sidebarDrawerOpen ? (
            <div className="fixed inset-0 z-40 bg-black/28 backdrop-blur-sm lg:hidden" onClick={() => setSidebarDrawerOpen(false)}>
              <div
                className="h-full w-[86vw] max-w-[340px] overflow-hidden pt-[env(safe-area-inset-top)]"
                onClick={(event) => event.stopPropagation()}
                style={{ background: "var(--surface-sidebar)", borderRight: "1px solid var(--border-subtle)" }}
              >
                {mobileSidebar ?? sidebar}
              </div>
            </div>
          ) : null}

          {noteList ? (
            <div
              className="hidden h-full w-[400px] shrink-0 border-r 2xl:w-[440px] xl:flex"
              style={{ borderColor: "var(--border-subtle)", background: "var(--surface-list)" }}
            >
              {noteList}
            </div>
          ) : null}

          {noteList ? (
            <div className={cn("min-h-0 flex-1 overflow-hidden xl:hidden", mobileChromeHidden ? "pb-[env(safe-area-inset-bottom)]" : "pb-[calc(48px+env(safe-area-inset-bottom))]", showMobileList ? "block" : "hidden")}>{noteList}</div>
          ) : null}

          <div className={cn("min-w-0 flex-1 flex-col", noteList && !showMobileMain ? "hidden xl:flex" : "flex")}>
            <main className={cn("min-h-0 flex-1 overflow-hidden xl:pb-0", mobileChromeHidden ? "pb-[env(safe-area-inset-bottom)]" : "pb-[calc(48px+env(safe-area-inset-bottom))]")} style={{ background: "var(--surface-editor)" }}>
              {main}
            </main>
          </div>

          {mobileInspectorOpen && rightPanel ? (
            <div
              className="hidden h-full w-[300px] shrink-0 border-l xl:flex"
              style={{ borderColor: "var(--border-subtle)", background: "var(--surface-panel)" }}
            >
              {rightPanel}
            </div>
          ) : null}

          {mobileInspectorOpen && rightPanel ? (
            <div className="fixed inset-0 z-40 bg-black/28 backdrop-blur-sm xl:hidden" onClick={onToggleInspector}>
              <div
                className="absolute inset-y-0 right-0 z-50 w-[90vw] max-w-[380px] overflow-hidden pt-[env(safe-area-inset-top)]"
                onClick={(event) => event.stopPropagation()}
                style={{ background: "var(--surface-panel)", borderLeft: "1px solid var(--border-subtle)" }}
              >
                {rightPanel}
              </div>
            </div>
          ) : null}
        </div>
        <nav
          className={cn(
            "glass-toolbar fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 gap-1 border-t px-2 pb-[calc(4px+env(safe-area-inset-bottom))] pt-1.5 transition-transform duration-200 ease-out xl:hidden",
            mobileChromeHidden && "translate-y-full pointer-events-none",
          )}
          style={{ borderColor: "var(--border-subtle)" }}
          aria-label="移动端主导航"
        >
          <button
            type="button"
            className={cn("flex items-center justify-center gap-1.5 rounded-[12px] px-2 py-1.5 text-[11px] font-medium", showMobileList ? "bg-primary/12 text-primary" : "text-muted-foreground")}
            onClick={() => {
              setSidebarDrawerOpen(false);
              onShowList();
            }}
          >
            <List className="h-4 w-4" />
            列表
          </button>
          <button
            type="button"
            className={cn("flex items-center justify-center gap-1.5 rounded-[12px] px-2 py-1.5 text-[11px] font-medium", showMobileMain ? "bg-primary/12 text-primary" : "text-muted-foreground")}
            onClick={() => {
              setSidebarDrawerOpen(false);
              onShowMain();
            }}
          >
            <FileText className="h-4 w-4" />
            编辑
          </button>
          <button
            type="button"
            className={cn("flex items-center justify-center gap-1.5 rounded-[12px] px-2 py-1.5 text-[11px] font-medium", mobileInspectorOpen ? "bg-primary/12 text-primary" : "text-muted-foreground", !rightPanel && "opacity-50")}
            disabled={!rightPanel}
            onClick={onToggleInspector}
          >
            {mobileInspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            信息
          </button>
        </nav>
      </div>
    </div>
  );
}
