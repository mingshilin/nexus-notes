import type { AuthUserSummary } from "@nexus/contracts";
import { Bell, LogOut, UserRound, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface AccountMenuProps {
  user: AuthUserSummary;
  unreadCount: number;
  modalOpen?: boolean;
  logoutPending?: boolean;
  onPersonalCenter(): void;
  onNotifications(opener: HTMLElement): void;
  onWorkspace(): void;
  onLogout(): void;
}

export function AccountMenu({
  user,
  unreadCount,
  modalOpen = false,
  logoutPending = false,
  onPersonalCenter,
  onNotifications,
  onWorkspace,
  onLogout,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeAndRestoreFocus();
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      closeAndRestoreFocus();
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  useEffect(() => {
    if (modalOpen) setOpen(false);
  }, [modalOpen]);

  const runAction = (action: () => void) => {
    closeAndRestoreFocus();
    action();
  };

  const moveMenuFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className="account-menu-root" ref={rootRef}>
      <button
        ref={triggerRef}
        className="account-trigger"
        type="button"
        aria-label="账户"
        aria-haspopup="menu"
        aria-expanded={open && !modalOpen}
        onClick={() => { if (!modalOpen) setOpen((current) => !current); }}
      >
        <span className="account-avatar" aria-hidden="true">{(user.displayName || user.email).slice(0, 1).toUpperCase()}</span>
        <span className="account-name">{user.displayName || user.email}</span>
      </button>
      {open && !modalOpen ? (
        <div className="account-menu" ref={menuRef} role="menu" aria-label="账户菜单" onKeyDown={moveMenuFocus}>
          <div className="account-menu-identity">
            <strong>{user.displayName || "Nexus 用户"}</strong>
            <span>{user.email}</span>
          </div>
          <button type="button" role="menuitem" onClick={() => runAction(onPersonalCenter)}><UserRound aria-hidden="true" size={16} />个人中心</button>
          <button type="button" role="menuitem" aria-label={`通知，${unreadCount} 条未读`} onClick={() => runAction(() => onNotifications(triggerRef.current!))}><Bell aria-hidden="true" size={16} />通知{unreadCount > 0 ? <span className="account-unread">{unreadCount}</span> : null}</button>
          <button type="button" role="menuitem" onClick={() => runAction(onWorkspace)}><UsersRound aria-hidden="true" size={16} />工作区</button>
          <button className="account-menu-logout" type="button" role="menuitem" disabled={logoutPending} onClick={() => runAction(onLogout)}><LogOut aria-hidden="true" size={16} />{logoutPending ? "正在退出…" : "退出登录"}</button>
        </div>
      ) : null}
    </div>
  );
}
