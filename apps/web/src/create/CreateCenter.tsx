import { Bell, CalendarDays, Database, FileUp, Lightbulb, Plus, Zap, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef } from "react";
import { useWorkbenchModalState } from "../layout/AdaptiveWorkbench";

export interface CreateCenterProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  disabled?: boolean;
  onCreateNote?(): void;
  onQuickCapture?(): void;
  onTodayNote?(): void;
  onCreateDatabase?(): void;
  onCreateReminder?(): void;
  onImport?(): void;
}

type CreateAction = {
  id: "note" | "capture" | "today" | "database" | "reminder" | "import";
  label: string;
  description: string;
  icon: typeof Lightbulb;
  run?: () => void;
};

const focusableSelector = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function CreateCenter({ open, onOpenChange, disabled = false, onCreateNote, onQuickCapture, onTodayNote, onCreateDatabase, onCreateReminder, onImport }: CreateCenterProps) {
  const setWorkbenchModalOpen = useWorkbenchModalState();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const actions: CreateAction[] = [
    { id: "note", label: "新建笔记", description: "打开一篇空白笔记，马上开始记录。", icon: Lightbulb, run: onCreateNote },
    { id: "capture", label: "快速捕获", description: "先记下一个想法，稍后再整理。", icon: Zap, run: onQuickCapture },
    { id: "today", label: "今日笔记", description: "打开或创建今天的笔记。", icon: CalendarDays, run: onTodayNote },
    { id: "database", label: "新建数据库", description: "创建一个结构化数据库。", icon: Database, run: onCreateDatabase },
    { id: "reminder", label: "新建提醒", description: "提醒中心正在接入统一创建流程。", icon: Bell, run: onCreateReminder },
    { id: "import", label: "导入内容", description: "文件和外部内容导入即将开放。", icon: FileUp, run: onImport },
  ];

  useEffect(() => {
    if (!open) {
      triggerRef.current?.focus();
      return undefined;
    }
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

  const dialog = open ? (
    <div className="create-center-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onOpenChange(false); }}>
      <div ref={dialogRef} className="create-center-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
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
        <div className="create-center-actions">
          {actions.map(({ id, label, description, icon: Icon, run }) => {
            const available = Boolean(run);
            const status = available ? null : id === "reminder" || id === "import" ? "即将开放" : "当前不可用";
            const accessibleLabel = status ? `${label}，${status}` : label;
            return (
              <button
                key={id}
                type="button"
                className={available ? "create-center-action" : "create-center-action unavailable"}
                aria-label={accessibleLabel}
                aria-describedby={status ? `${titleId}-${id}-status` : undefined}
                disabled={!available}
                onClick={() => {
                  if (!run) return;
                  onOpenChange(false);
                  run();
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
      <button ref={triggerRef} className="create-center-trigger" type="button" aria-label="创建内容" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => onOpenChange(true)}>
        <Plus aria-hidden="true" size={17} />
        <span>创建内容</span>
      </button>
      {dialog && typeof document !== "undefined" ? createPortal(dialog, document.body) : null}
    </>
  );
}
