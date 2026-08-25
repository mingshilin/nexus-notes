import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useWorkbenchModalState } from "../layout/AdaptiveWorkbench";

export function ModalDialog({
  label,
  opener,
  onClose,
  className = "collaboration-dialog",
  backdropClassName = "",
  children,
}: {
  label: string;
  opener: HTMLElement | null;
  onClose(): void;
  className?: string;
  backdropClassName?: string;
  children(closeRef: { current: HTMLButtonElement | null }): ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const setWorkbenchModalOpen = useWorkbenchModalState();

  useEffect(() => {
    setWorkbenchModalOpen(true);
    const viewport = window.visualViewport;
    const updateKeyboardInset = () => {
      const height = viewport?.height ?? window.innerHeight;
      const offset = viewport?.offsetTop ?? 0;
      document.documentElement.style.setProperty("--collaboration-keyboard", `${Math.max(0, window.innerHeight - height - offset)}px`);
    };
    updateKeyboardInset();
    viewport?.addEventListener("resize", updateKeyboardInset);
    viewport?.addEventListener("scroll", updateKeyboardInset);
    closeRef.current?.focus();
    return () => {
      viewport?.removeEventListener("resize", updateKeyboardInset);
      viewport?.removeEventListener("scroll", updateKeyboardInset);
      document.documentElement.style.removeProperty("--collaboration-keyboard");
      setWorkbenchModalOpen(false);
      opener?.focus();
    };
  }, [opener, setWorkbenchModalOpen]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
    if (focusable.length === 0) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={`collaboration-dialog-backdrop ${backdropClassName}`.trim()} onMouseDown={onClose}>
      <section
        className={className}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-scroll-owner="dialog"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children(closeRef)}
      </section>
    </div>,
    document.body,
  );
}
