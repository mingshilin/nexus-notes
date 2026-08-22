import type { AuthUserSummary } from "@nexus/contracts";
import { Bot, Database, Library, List, NotebookPen, Settings, Users } from "lucide-react";
import { AccountMenu } from "../account/AccountMenu";
import { useWorkbenchModalOpen } from "../layout/AdaptiveWorkbench";

export type ProductDomain = "notes" | "databases" | "knowledge" | "collaboration" | "ai" | "account";
export type AccountSubsection = "personal" | "workspace";

export interface ProductNavigationProps {
  active: ProductDomain;
  user: AuthUserSummary;
  unreadCount: number;
  collaborationEnabled: boolean;
  mode?: "rail" | "mobile";
  modalOpen?: boolean;
  contextOpen?: boolean;
  logoutPending?: boolean;
  onChange(domain: ProductDomain): void;
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
  mode = "rail",
  modalOpen,
  contextOpen = false,
  logoutPending = false,
  onChange,
  onContextToggle,
  onPersonalCenter = () => onChange("account"),
  onNotifications,
  onWorkspace = () => onChange("account"),
  onLogout,
}: ProductNavigationProps) {
  const workbenchModalOpen = useWorkbenchModalOpen();
  const menuSuppressed = Boolean(modalOpen || workbenchModalOpen);
  const navigate = (domain: ProductDomain) => {
    if (domain === "collaboration" && !collaborationEnabled) return;
    onChange(domain);
  };

  const destinationButton = (domain: ProductDomain, label: string, Icon: typeof NotebookPen) => {
    const activeDestination = active === domain;
    const unavailable = domain === "collaboration" && !collaborationEnabled;
    return (
      <button
        key={domain}
        className={activeDestination ? "product-navigation-item active" : "product-navigation-item"}
        type="button"
        aria-current={activeDestination ? "page" : undefined}
        aria-pressed={activeDestination}
        aria-disabled={unavailable || undefined}
        disabled={unavailable}
        title={unavailable ? "协作功能当前不可用" : undefined}
        onClick={() => navigate(domain)}
      >
        <Icon aria-hidden="true" size={19} />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <div className={`product-navigation product-navigation-${mode}`}>
      {mode === "rail" ? <div className="brand-mark" aria-label="Nexus Notes">N</div> : null}
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
