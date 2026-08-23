import type { AuthUserSummary } from "@nexus/contracts";
import { Bot, Database, Library, List, NotebookPen, Plus, Settings, Users } from "lucide-react";
import { Fragment, useId } from "react";
import { AccountMenu } from "../account/AccountMenu";
import { useWorkbenchModalOpen } from "../layout/AdaptiveWorkbench";

export type ProductDomain = "notes" | "databases" | "knowledge" | "reminders" | "collaboration" | "ai" | "account";
export type AccountSubsection = "personal" | "workspace";

export interface ProductNavigationProps {
  active: ProductDomain;
  user: AuthUserSummary;
  unreadCount: number;
  collaborationEnabled: boolean;
  notificationsEnabled: boolean;
  mode?: "rail" | "mobile";
  modalOpen?: boolean;
  contextOpen?: boolean;
  logoutPending?: boolean;
  onChange(domain: ProductDomain): void;
  onCreateNote?(): void;
  createNoteDisabled?: boolean;
  onContextToggle?(): void;
  onPersonalCenter?(): void;
  onNotifications(opener: HTMLElement): void;
  onWorkspace?(): void;
  onLogout(): void;
}

const destinations = [
  { domain: "notes", label: "笔记", icon: NotebookPen },
  { domain: "databases", label: "数据库", icon: Database },
  { domain: "knowledge", label: "知识整理", icon: Library },
  { domain: "collaboration", label: "协作", icon: Users },
  { domain: "ai", label: "AI 助手", icon: Bot },
] as const;

export function ProductNavigation({
  active,
  user,
  unreadCount,
  collaborationEnabled,
  notificationsEnabled,
  mode = "rail",
  modalOpen,
  contextOpen = false,
  logoutPending = false,
  onChange,
  onCreateNote,
  createNoteDisabled = false,
  onContextToggle,
  onPersonalCenter = () => onChange("account"),
  onNotifications,
  onWorkspace = () => onChange("account"),
  onLogout,
}: ProductNavigationProps) {
  const workbenchModalOpen = useWorkbenchModalOpen();
  const collaborationDescriptionId = useId();
  const menuSuppressed = Boolean(modalOpen || workbenchModalOpen);
  const navigate = (domain: ProductDomain) => {
    onChange(domain);
  };

  const destinationButton = (domain: ProductDomain, label: string, Icon: typeof NotebookPen) => {
    const activeDestination = active === domain;
    const unavailable = domain === "collaboration" && !collaborationEnabled;
    return (
      <Fragment key={domain}>
        <button
          className={["product-navigation-item", activeDestination ? "active" : "", unavailable ? "unavailable" : ""].filter(Boolean).join(" ")}
          type="button"
          aria-current={activeDestination ? "page" : undefined}
          aria-pressed={activeDestination}
          aria-describedby={unavailable ? collaborationDescriptionId : undefined}
          onClick={() => navigate(domain)}
        >
          <Icon aria-hidden="true" size={19} />
          <span>{label}</span>
          {unavailable ? <span className="product-navigation-status" aria-hidden="true">未开启</span> : null}
        </button>
        {unavailable ? <span id={collaborationDescriptionId} className="sr-only">协作功能当前未开启</span> : null}
      </Fragment>
    );
  };

  return (
    <div className={`product-navigation product-navigation-${mode}`}>
      {mode === "rail" ? <div className="brand-mark" aria-label="Nexus Notes">N</div> : null}
      {mode === "rail" && onCreateNote ? (
        <button
          className="product-navigation-create"
          type="button"
          aria-label="新建笔记"
          aria-keyshortcuts="Control+N Meta+N"
          title="新建笔记（Ctrl/Cmd+N）"
          disabled={createNoteDisabled}
          onClick={onCreateNote}
        >
          <Plus aria-hidden="true" size={18} />
          <span>新建笔记</span>
        </button>
      ) : null}
      <div className="product-navigation-destinations">
        {destinations.map(({ domain, label, icon }) => destinationButton(domain, label, icon))}
      </div>
      {onContextToggle && (active === "notes" || active === "databases") ? (
        <button
          className="product-navigation-item product-navigation-context"
          type="button"
          aria-label={contextOpen ? "关闭笔记列表" : "打开笔记列表"}
          aria-pressed={contextOpen}
          onClick={onContextToggle}
        >
          <List aria-hidden="true" size={19} />
          <span>列表</span>
        </button>
      ) : null}
      <div className="product-navigation-account">
        {destinationButton("account", "设置", Settings)}
        <AccountMenu
          user={user}
          unreadCount={unreadCount}
          notificationsEnabled={notificationsEnabled}
          modalOpen={menuSuppressed}
          logoutPending={logoutPending}
          onPersonalCenter={onPersonalCenter}
          onNotifications={onNotifications}
          onWorkspace={onWorkspace}
          onLogout={onLogout}
        />
      </div>
    </div>
  );
}
