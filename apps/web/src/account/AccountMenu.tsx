import type { AuthUserSummary } from "@nexus/contracts";
import { Bell, LogOut, UserRound, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface AccountMenuProps {
  user: AuthUserSummary;
  unreadCount: number;
  notificationsEnabled: boolean;
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
  notificationsEnabled,
  modalOpen = false,
  logoutPending = false,
  onPersonalCenter,
  onNotifications,
  onWorkspace,
  onLogout,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabledIndices = [0, ...(notificationsEnabled ? [1] : []), 2, ...(!logoutPending ? [3] : [])];
  const rovingIndex = enabledIndices.includes(activeIndex) ? activeIndex : enabledIndices[0]!;

  const closeAndRestoreFocus = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
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
    if (open) itemRefs.current[rovingIndex]?.focus();
  }, [open, rovingIndex]);

  useEffect(() => {
    if (modalOpen) setOpen(false);
  }, [modalOpen]);

  const runAction = (action: () => void) => {
    closeAndRestoreFocus();
    action();
  };

  const moveMenuFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = enabledIndices.indexOf(rovingIndex);
    const next = event.key === "Home"
      ? enabledIndices[0]!
      : event.key === "End"
        ? enabledIndices.at(-1)!
        : event.key === "ArrowDown"
          ? enabledIndices[(current + 1) % enabledIndices.length]!
          : enabledIndices[(current - 1 + enabledIndices.length) % enabledIndices.length]!;
    setActiveIndex(next);
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
        onClick={() => {
          if (modalOpen) return;
          setActiveIndex(enabledIndices[0]!);
          setOpen((current) => !current);
        }}
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
          <button ref={(element) => { itemRefs.current[0] = element; }} type="button" role="menuitem" tabIndex={rovingIndex === 0 ? 0 : -1} onFocus={() => setActiveIndex(0)} onClick={() => runAction(onPersonalCenter)}><UserRound aria-hidden="true" size={16} />个人中心</button>
          <button ref={(element) => { itemRefs.current[1] = element; }} type="button" role="menuitem" tabIndex={notificationsEnabled && rovingIndex === 1 ? 0 : -1} aria-label={notificationsEnabled ? `通知，${unreadCount} 条未读` : "通知，当前不可用"} aria-disabled={!notificationsEnabled || undefined} disabled={!notificationsEnabled} onFocus={() => setActiveIndex(1)} onClick={() => { if (notificationsEnabled) runAction(() => onNotifications(triggerRef.current!)); }}><Bell aria-hidden="true" size={16} />通知{notificationsEnabled ? unreadCount > 0 ? <span className="account-unread">{unreadCount}</span> : null : <span className="account-unavailable">暂不可用</span>}</button>
          <button ref={(element) => { itemRefs.current[2] = element; }} type="button" role="menuitem" tabIndex={rovingIndex === 2 ? 0 : -1} onFocus={() => setActiveIndex(2)} onClick={() => runAction(onWorkspace)}><UsersRound aria-hidden="true" size={16} />工作区</button>
          <button ref={(element) => { itemRefs.current[3] = element; }} className="account-menu-logout" type="button" role="menuitem" tabIndex={!logoutPending && rovingIndex === 3 ? 0 : -1} aria-disabled={logoutPending || undefined} disabled={logoutPending} onFocus={() => setActiveIndex(3)} onClick={() => runAction(onLogout)}><LogOut aria-hidden="true" size={16} />{logoutPending ? "正在退出…" : "退出登录"}</button>
        </div>
      ) : null}
    </div>
  );
}
