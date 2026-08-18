import {
  Archive,
  Bell,
  Brain,
  CalendarDays,
  Clock3,
  Database,
  Folder,
  Inbox,
  Library,
  LogOut,
  Moon,
  Network,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  Sun,
  Tags,
  Trash2,
} from "lucide-react";
import type { Database as DatabaseType } from "@/types/database";
import type { Folder as FolderType, Tag } from "@/types/note";
import type { LibraryView, ThemeMode } from "@/store/useAppStore";
import { BrandMark } from "@/components/branding/BrandMark";
import { Button } from "@/components/ui/button";
import { BRAND_NAME } from "@/lib/brand";
import { cn, decodeEscapedUnicode, normalizeDisplayIcon } from "@/lib/utils";

interface SidebarProps {
  noteCount: number;
  favoriteCount: number;
  pinnedCount: number;
  trashCount: number;
  dueReminderCount?: number;
  databases: DatabaseType[];
  folders: FolderType[];
  tags: Tag[];
  libraryView: LibraryView;
  selectedFolderId: string | null;
  selectedDatabaseId: string | null;
  selectedTagId: string | null;
  theme: ThemeMode;
  userEmail?: string;
  userName?: string | null;
  avatarUrl?: string | null;
  accountMenuOpen: boolean;
  mobile?: boolean;
  onViewChange: (view: LibraryView, folderId?: string | null) => void;
  onTagToggle: (tagId: string | null) => void;
  onCreateNote: () => void;
  onCreateDatabase: () => void;
  onCreateFolder: () => void;
  onRenameFolder: (folder: FolderType) => void;
  onDeleteFolder: (folder: FolderType) => void;
  onOpenCommand: () => void;
  onOpenSettings: () => void;
  onOpenReminders: () => void;
  onThemeChange: (theme: ThemeMode) => void;
  onToggleAccountMenu: (open: boolean) => void;
  onLogout: () => void;
}

function navItem(active: boolean, accent = false) {
  return cn(
    "group flex h-9 w-full items-center gap-2 rounded-[10px] px-2.5 text-[13px] font-medium transition-colors",
    active
      ? "bg-[#007aff] text-white shadow-sm"
      : accent
        ? "text-[#007aff] hover:bg-black/5 dark:hover:bg-white/[0.04]"
        : "text-foreground/78 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/[0.04]",
  );
}

function Count({ value }: { value?: number }) {
  if (value === undefined) return null;
  return <span className="ml-auto text-[11px] tabular-nums opacity-60">{value}</span>;
}

export function Sidebar({
  noteCount,
  favoriteCount,
  pinnedCount,
  trashCount,
  dueReminderCount = 0,
  databases,
  folders,
  tags,
  libraryView,
  selectedFolderId,
  selectedDatabaseId,
  selectedTagId,
  theme,
  userEmail,
  userName,
  avatarUrl,
  accountMenuOpen,
  mobile = false,
  onViewChange,
  onTagToggle,
  onCreateNote,
  onCreateDatabase,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onOpenCommand,
  onOpenSettings,
  onOpenReminders,
  onThemeChange,
  onToggleAccountMenu,
  onLogout,
}: SidebarProps) {
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <aside
      className={cn("h-full w-[240px] shrink-0 flex-col border-r", mobile ? "flex" : "hidden lg:flex")}
      style={{ background: "var(--surface-sidebar)", borderColor: "var(--border-subtle)" }}
    >
      <div className="h-[52px] shrink-0 px-4" />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 text-[13px]">
        <div className="mb-4 flex items-center gap-2 px-2">
          <BrandMark compact />
          <div className="truncate text-sm font-semibold">{BRAND_NAME}</div>
        </div>

        <div className="mb-5">
          <button
            type="button"
            className="mac-input-shell flex h-11 w-full items-center gap-2 px-3 text-left text-[13px] text-foreground/70"
            onClick={onOpenCommand}
          >
            <Search className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1">搜索 / 命令</span>
            <span className="rounded-md border border-black/5 bg-white/45 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground dark:bg-white/[0.06]">
              ⌘K
            </span>
          </button>
        </div>

        <section className="mb-6 space-y-1">
          <button className={navItem(false)} onClick={onCreateNote}>
            <Sparkles className="h-4 w-4 text-[#ff9500]" />
            快速备忘录
          </button>
          <button className={navItem(libraryView === "graph", true)} onClick={() => onViewChange("graph")}>
            <Network className="h-4 w-4" />
            知识图谱
          </button>
          <button className={navItem(libraryView === "knowledge", true)} onClick={() => onViewChange("knowledge")}>
            <Brain className="h-4 w-4" />
            知识中心
          </button>
        </section>

        <section className="mb-6">
          <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/35">Cloud</p>
          <div className="space-y-1">
            <button className={navItem(libraryView === "inbox")} onClick={() => onViewChange("inbox")}>
              <Inbox className="h-4 w-4" />
              收集箱
            </button>
            <button className={navItem(libraryView === "daily")} onClick={() => onViewChange("daily")}>
              <CalendarDays className="h-4 w-4" />
              每日笔记
            </button>
          </div>
        </section>

        <section className="mb-6">
          <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/35">Library</p>
          <div className="space-y-1">
            <button className={navItem(libraryView === "all")} onClick={() => onViewChange("all")}>
              <Library className="h-4 w-4" />
              全部笔记
              <Count value={noteCount} />
            </button>
            <button className={navItem(libraryView === "favorites")} onClick={() => onViewChange("favorites")}>
              <Star className="h-4 w-4" />
              收藏
              <Count value={favoriteCount} />
            </button>
            <button className={navItem(libraryView === "pinned")} onClick={() => onViewChange("pinned")}>
              <Pin className="h-4 w-4" />
              置顶
              <Count value={pinnedCount} />
            </button>
            <button className={navItem(libraryView === "recent")} onClick={() => onViewChange("recent")}>
              <Clock3 className="h-4 w-4" />
              最近打开
            </button>
            <button className={navItem(libraryView === "reminders")} onClick={onOpenReminders}>
              <Bell className="h-4 w-4" />
              提醒中心
              <Count value={dueReminderCount > 0 ? dueReminderCount : undefined} />
            </button>
          </div>
        </section>

        <section className="mb-6">
          <div className="mb-1 flex items-center justify-between px-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/35">Databases</p>
            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md" onClick={onCreateDatabase} aria-label="新建数据库" title="新建数据库">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-1">
            {databases.map((database) => (
              <button
                key={database.id}
                className={navItem(libraryView === "database" && selectedDatabaseId === database.id)}
                onClick={() => onViewChange("database", database.id)}
              >
                <Database className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {normalizeDisplayIcon(database.icon) ? `${normalizeDisplayIcon(database.icon)} ` : ""}
                  {decodeEscapedUnicode(database.name)}
                </span>
              </button>
            ))}
            {databases.length === 0 ? (
              <button type="button" className="w-full rounded-[10px] px-2 py-2 text-left text-xs text-muted-foreground hover:bg-black/5" onClick={onCreateDatabase}>
                暂无数据库，点击新建
              </button>
            ) : null}
          </div>
        </section>

        <section className="mb-6">
          <div className="mb-1 flex items-center justify-between px-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/35">Projects</p>
            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md" onClick={onCreateFolder}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-1">
            {folders.map((folder) => (
              <div key={folder.id} className="group relative">
                <button
                  className={cn(navItem(libraryView === "folder" && selectedFolderId === folder.id), "pr-14")}
                  onClick={() => onViewChange("folder", folder.id)}
                >
                  <Folder className="h-4 w-4" />
                  <span className="min-w-0 flex-1 truncate text-left">{decodeEscapedUnicode(folder.name)}</span>
                  <Count value={folder.note_count ?? 0} />
                </button>
                <div className="absolute right-1 top-1 hidden items-center gap-0.5 rounded-lg bg-white/75 p-0.5 shadow-sm backdrop-blur-md group-hover:flex dark:bg-[#1f2430]/70">
                  <button
                    type="button"
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/[0.06]"
                    onClick={() => onRenameFolder(folder)}
                    aria-label="重命名文件夹"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                    onClick={() => onDeleteFolder(folder)}
                    aria-label="删除文件夹"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
            {folders.length === 0 ? <p className="px-2 py-1 text-xs text-muted-foreground">暂无文件夹</p> : null}
          </div>
        </section>

        <section className="mb-6">
          <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/35">Tags</p>
          <div className="space-y-1">
            {tags.map((tag) => (
              <button
                key={tag.id}
                className={navItem(selectedTagId === tag.id)}
                onClick={() => onTagToggle(selectedTagId === tag.id ? null : tag.id)}
              >
                <Tags className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate text-left">{decodeEscapedUnicode(tag.name)}</span>
              </button>
            ))}
            {tags.length === 0 ? <p className="px-2 py-1 text-xs text-muted-foreground">暂无标签</p> : null}
          </div>
        </section>

        <section>
          <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/35">Manage</p>
          <div className="space-y-1">
            <button className={navItem(libraryView === "archive")} onClick={() => onViewChange("archive")}>
              <Archive className="h-4 w-4" />
              归档
            </button>
            <button className={navItem(libraryView === "trash")} onClick={() => onViewChange("trash")}>
              <Trash2 className="h-4 w-4" />
              回收站
              <Count value={trashCount} />
            </button>
          </div>
        </section>
      </div>

      <div className="border-t p-3" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="relative">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-black/5 dark:hover:bg-white/[0.04]"
            onClick={() => onToggleAccountMenu(!accountMenuOpen)}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={userName ?? userEmail ?? "avatar"} className="h-8 w-8 rounded-full border border-black/10 object-cover" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-black text-sm font-semibold text-white dark:border-white/10 dark:bg-white dark:text-black">
                {(userName || userEmail)?.slice(0, 1).toUpperCase() ?? "N"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{userName || userEmail || "当前账户"}</div>
              {userEmail ? <div className="truncate text-[11px] text-muted-foreground">{userEmail}</div> : null}
            </div>
          </button>
          {accountMenuOpen ? (
            <div className="mac-glass absolute bottom-11 left-0 right-0 z-20 rounded-2xl p-1.5">
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]" onClick={onOpenSettings}>
                <Settings className="h-4 w-4" />
                个人资料与设置
              </button>
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]" onClick={onOpenReminders}>
                <Bell className="h-4 w-4" />
                提醒管理
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
                onClick={() => onThemeChange(nextTheme)}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {theme === "dark" ? "切换浅色模式" : "切换深色模式"}
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-red-500 hover:bg-red-500/8"
                onClick={onLogout}
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
