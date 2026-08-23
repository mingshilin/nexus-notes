import { Bell, CalendarDays, Database, FileUp, Lightbulb, Plus, Zap, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";
import { useWorkbenchModalState } from "../layout/AdaptiveWorkbench";

export type CreateActionResult = void | boolean;
export type CreateActionHandler = () => CreateActionResult | Promise<CreateActionResult>;

export interface CreateCenterProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  disabled?: boolean;
  onCreateNote?: CreateActionHandler;
  onQuickCapture?: CreateActionHandler;
  onTodayNote?: CreateActionHandler;
  onCreateDatabase?: CreateActionHandler;
  onCreateReminder?: CreateActionHandler;
  onImport?: CreateActionHandler;
}

type CreateAction = {
  id: "note" | "capture" | "today" | "database" | "reminder" | "import";
  label: string;
  description: string;
  icon: typeof Lightbulb;
  run?: CreateActionHandler;
};

const focusableSelector = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function CreateCenter({ open, onOpenChange, disabled = false, onCreateNote, onQuickCapture, onTodayNote, onCreateDatabase, onCreateReminder, onImport }: CreateCenterProps) {
  const setWorkbenchModalOpen = useWorkbenchModalState();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<CreateAction["id"] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const dialogId = `${titleId}-dialog`;

  const actions: CreateAction[] = [
    { id: "note", label: "新建笔记", description: "打开一篇空白笔记，马上开始记录。", icon: Lightbulb, run: onCreateNote },
    { id: "capture", label: "快速捕获", description: "先记下一个想法，稍后再整理。", icon: Zap, run: onQuickCapture },
    { id: "today", label: "今日笔记", description: "打开或创建今天的笔记。", icon: CalendarDays, run: onTodayNote },
    { id: "database", label: "新建数据库", description: "创建一个结构化数据库。", icon: Database, run: onCreateDatabase },
    { id: "reminder", label: "新建提醒", description: "提醒中心正在接入统一创建流程。", icon: Bell, run: onCreateReminder },
    { id: "import", label: "导入内容", description: "文件和外部内容导入即将开放。", icon: FileUp, run: onImport },
  ];

  useEffect(() => {
    if (!open) return undefined;
    wasOpenRef.current = true;
    setWorkbenchModalOpen(true);
    closeRef.current?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1
        : activeIndex < 0 || activeIndex === focusable.length - 1 ? 0 : activeIndex + 1;
      event.preventDefault();
      focusable[nextIndex]!.focus();
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      setWorkbenchModalOpen(false);
    };
  }, [onOpenChange, open, setWorkbenchModalOpen]);

  useEffect(() => {
    if (open || !wasOpenRef.current) return undefined;
    wasOpenRef.current = false;
    setPendingAction(null);
    const timer = window.setTimeout(() => {
      const trigger = triggerRef.current;
      if (trigger && !trigger.closest("[inert]")) trigger.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const finishAction = (id: CreateAction["id"], label: string, result: CreateActionResult) => {
    setPendingAction(null);
    if (result === false) {
      setActionError(`未能开始${label}。当前可能已有未完成操作，请完成后再试。`);
      return;
    }
    setActionError(null);
    onOpenChange(false);
  };

  const runAction = (id: CreateAction["id"], label: string, run: CreateActionHandler) => {
    if (disabled || pendingAction) return;
    setPendingAction(id);
    setActionError(null);
    try {
      const result = run();
      if (result instanceof Promise) {
        void result.then((value) => finishAction(id, label, value)).catch(() => {
          setPendingAction(null);
          setActionError(`${label}启动失败，请稍后重试。`);
        });
        return;
      }
      finishAction(id, label, result);
    } catch {
      setPendingAction(null);
      setActionError(`${label}启动失败，请稍后重试。`);
    }
  };

  const dialog = open ? (
    <div className="create-center-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onOpenChange(false); }}>
      <div id={dialogId} ref={dialogRef} className="create-center-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <header className="create-center-header">
          <div>
            <p className="eyebrow">创建中心</p>
            <h2 id={titleId}>创建内容</h2>
            <p id={descriptionId}>选择一个入口，开始记录、整理或建立结构。</p>
          </div>
          <button ref={closeRef} type="button" className="create-center-close" aria-label="关闭创建内容" onClick={() => onOpenChange(false)}>
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        {disabled ? <p className="create-center-feedback" role="status">正在退出登录，请稍候。</p> : null}
        {actionError ? <p className="create-center-feedback error" role="alert">{actionError}</p> : null}
        <div className="create-center-actions">
          {actions.map(({ id, label, description, icon: Icon, run }) => {
            const available = Boolean(run) && !disabled;
            const pending = pendingAction === id;
            const status = pending
              ? "处理中"
              : available
                ? null
                : disabled
                  ? "暂不可用"
                  : id === "reminder" || id === "import" ? "即将开放" : "当前不可用";
            const accessibleLabel = status ? `${label}，${status}` : label;
            return (
              <button
                key={id}
                type="button"
                className={available ? "create-center-action" : "create-center-action unavailable"}
                aria-label={accessibleLabel}
                aria-describedby={status ? `${titleId}-${id}-status` : undefined}
                aria-busy={pending || undefined}
                disabled={!available || pendingAction !== null}
                onClick={() => {
                  if (!run) return;
                  runAction(id, label, run);
                }}
              >
                <span className="create-center-action-icon"><Icon aria-hidden="true" size={19} /></span>
                <span className="create-center-action-copy"><strong>{label}</strong><small>{description}</small></span>
                {status ? <span id={`${titleId}-${id}-status`} className="create-center-action-status">{status}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button ref={triggerRef} className="create-center-trigger" type="button" aria-label="创建内容" aria-haspopup="dialog" aria-controls={dialogId} aria-expanded={open} disabled={disabled} onClick={() => { setActionError(null); onOpenChange(true); }}>
        <Plus aria-hidden="true" size={17} />
        <span>创建内容</span>
      </button>
      {dialog && typeof document !== "undefined" ? createPortal(dialog, document.body) : null}
    </>
  );
}
