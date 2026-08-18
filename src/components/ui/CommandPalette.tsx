import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Bell,
  Brain,
  CalendarDays,
  Copy,
  CopyPlus,
  Download,
  FileInput,
  FileText,
  Focus,
  FolderPlus,
  Inbox,
  Keyboard,
  Library,
  Moon,
  Network,
  Pin,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import type { Folder, NoteWithTags, Tag } from "@/types/note";
import type { LibraryView } from "@/store/useAppStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn, decodeEscapedUnicode } from "@/lib/utils";

export interface CommandAction {
  id: string;
  label: string;
  group: string;
  icon: typeof Plus;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  notes: NoteWithTags[];
  folders?: Folder[];
  tags?: Tag[];
  onOpenChange: (open: boolean) => void;
  onViewChange: (view: LibraryView, folderId?: string | null) => void;
  onSelectNote: (id: string) => void;
  onTagSelect?: (id: string) => void;
  onCreateNote: () => void;
  onQuickCapture?: () => void;
  onOpenTodayDailyNote?: () => void;
  onOpenTemplatePicker: () => void;
  onDuplicateCurrent: () => void;
  onCopyInternalLink: () => void;
  onImportMarkdown: () => void;
  onExportCurrent: () => void;
  onExportAll: () => void;
  onCreateDatabase?: () => void;
  onCreateFolder: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onToggleTheme: () => void;
  onToggleFocusMode: () => void;
  focusMode: boolean;
}

export function CommandPalette({
  open,
  notes,
  folders = [],
  tags = [],
  onOpenChange,
  onViewChange,
  onSelectNote,
  onTagSelect,
  onCreateNote,
  onQuickCapture,
  onOpenTodayDailyNote,
  onOpenTemplatePicker,
  onDuplicateCurrent,
  onCopyInternalLink,
  onImportMarkdown,
  onExportCurrent,
  onExportAll,
  onCreateDatabase,
  onCreateFolder,
  onOpenSettings,
  onOpenShortcuts,
  onToggleTheme,
  onToggleFocusMode,
  focusMode,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const actions = useMemo<CommandAction[]>(
    () => [
      { id: "new", label: "新建笔记", group: "操作", icon: Plus, run: onCreateNote },
      ...(onQuickCapture ? [{ id: "quick-capture", label: "快速捕获", group: "操作", icon: Inbox, run: onQuickCapture }] : []),
      { id: "template", label: "从模板创建", group: "操作", icon: Sparkles, run: onOpenTemplatePicker },
      { id: "duplicate", label: "复制当前笔记", group: "操作", icon: CopyPlus, run: onDuplicateCurrent },
      { id: "copy-link", label: "复制内部链接", group: "操作", icon: Copy, run: onCopyInternalLink },
      { id: "daily-list", label: "查看每日笔记列表", group: "视图", icon: CalendarDays, run: () => onViewChange("daily") },
      ...(onOpenTodayDailyNote
        ? [{ id: "today-daily", label: "打开今天的每日笔记", group: "操作", icon: CalendarDays, run: onOpenTodayDailyNote }]
        : []),
      { id: "import", label: "导入 Markdown", group: "操作", icon: FileInput, run: onImportMarkdown },
      { id: "export-current", label: "导出当前笔记", group: "操作", icon: Download, run: onExportCurrent },
      { id: "export-all", label: "导出全部数据", group: "操作", icon: Download, run: onExportAll },
      { id: "inbox", label: "打开收集箱", group: "视图", icon: Inbox, run: () => onViewChange("inbox") },
      { id: "all", label: "查看全部笔记", group: "视图", icon: Library, run: () => onViewChange("all") },
      { id: "favorites", label: "查看收藏", group: "视图", icon: Star, run: () => onViewChange("favorites") },
      { id: "pinned", label: "查看置顶", group: "视图", icon: Pin, run: () => onViewChange("pinned") },
      { id: "archive", label: "查看归档", group: "视图", icon: Archive, run: () => onViewChange("archive") },
      { id: "trash", label: "查看回收站", group: "视图", icon: Trash2, run: () => onViewChange("trash") },
      { id: "graph", label: "打开知识图谱", group: "视图", icon: Network, run: () => onViewChange("graph") },
      { id: "knowledge", label: "打开知识中心", group: "视图", icon: Brain, run: () => onViewChange("knowledge") },
      { id: "reminders", label: "打开提醒中心", group: "视图", icon: Bell, run: () => onViewChange("reminders") },
      ...(onCreateDatabase ? [{ id: "database", label: "创建数据库", group: "组织", icon: Library, run: onCreateDatabase }] : []),
      { id: "folder", label: "创建文件夹", group: "组织", icon: FolderPlus, run: onCreateFolder },
      { id: "settings", label: "打开设置", group: "系统", icon: Settings, run: onOpenSettings },
      { id: "theme", label: "切换主题", group: "系统", icon: Moon, run: onToggleTheme },
      { id: "focus", label: focusMode ? "退出专注模式" : "进入专注模式", group: "系统", icon: Focus, run: onToggleFocusMode },
      { id: "shortcuts", label: "快捷键说明", group: "系统", icon: Keyboard, run: onOpenShortcuts },
    ],
    [
      focusMode,
      onCopyInternalLink,
      onCreateDatabase,
      onCreateFolder,
      onCreateNote,
      onQuickCapture,
      onDuplicateCurrent,
      onExportAll,
      onExportCurrent,
      onImportMarkdown,
      onOpenSettings,
      onOpenShortcuts,
      onOpenTemplatePicker,
      onOpenTodayDailyNote,
      onToggleFocusMode,
      onToggleTheme,
      onViewChange,
    ],
  );

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();

    const commandItems = actions
      .filter((action) => !q || action.label.toLowerCase().includes(q))
      .map((action) => ({
        type: "action" as const,
        id: action.id,
        label: action.label,
        group: action.group,
        icon: action.icon,
        run: action.run,
      }));

    const noteItems = notes
      .filter((note) => {
        if (!q) return false;
        return `${decodeEscapedUnicode(note.title)}\n${decodeEscapedUnicode(note.content)}\n${note.tags.map((tag) => tag.name).join(" ")}`
          .toLowerCase()
          .includes(q);
      })
      .slice(0, 10)
      .map((note) => ({
        type: "note" as const,
        id: note.id,
        label: decodeEscapedUnicode(note.title) || "无标题笔记",
        group: "笔记",
        icon: FileText,
        run: () => onSelectNote(note.id),
      }));

    const folderItems = folders
      .filter((folder) => q && decodeEscapedUnicode(folder.name).toLowerCase().includes(q))
      .map((folder) => ({
        type: "folder" as const,
        id: folder.id,
        label: decodeEscapedUnicode(folder.name),
        group: "文件夹",
        icon: FolderPlus,
        run: () => onViewChange("folder", folder.id),
      }));

    const tagItems = tags
      .filter((tag) => q && decodeEscapedUnicode(tag.name).toLowerCase().includes(q))
      .map((tag) => ({
        type: "tag" as const,
        id: tag.id,
        label: decodeEscapedUnicode(tag.name),
        group: "标签",
        icon: Search,
        run: () => onTagSelect?.(tag.id),
      }));

    return [...commandItems, ...noteItems, ...folderItems, ...tagItems];
  }, [actions, folders, notes, onSelectNote, onTagSelect, onViewChange, query, tags]);

  useEffect(() => {
    setActiveIndex(0);
    if (!open) setQuery("");
  }, [open, query]);

  function runActive() {
    const item = items[activeIndex];
    if (!item) return;
    item.run();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mac-glass max-w-3xl gap-0 overflow-hidden rounded-[24px] p-0">
        <DialogHeader className="border-b px-4 py-3" style={{ borderColor: "var(--border-subtle)" }}>
          <DialogTitle className="sr-only">命令面板</DialogTitle>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((value) => Math.min(value + 1, Math.max(items.length - 1, 0)));
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((value) => Math.max(value - 1, 0));
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  runActive();
                }
              }}
              placeholder="搜索命令、笔记、文件夹或标签"
              className="h-12 rounded-[14px] border-transparent bg-white/55 pl-9 text-base shadow-none focus-visible:ring-0 dark:bg-white/[0.05]"
            />
          </div>
        </DialogHeader>
        <div className="scrollbar-subtle max-h-[58vh] overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">没有匹配结果</p>
          ) : (
            items.map((item, index) => {
              const Icon = item.icon;
              const showGroup = index === 0 || items[index - 1].group !== item.group;
              return (
                <div key={`${item.type}-${item.id}`}>
                  {showGroup ? (
                    <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      {item.group}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => {
                      item.run();
                      onOpenChange(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left text-sm transition-colors",
                      activeIndex === index ? "bg-[#007aff]/8 text-foreground dark:bg-[#409cff]/12" : "hover:bg-black/[0.035] dark:hover:bg-white/[0.04]",
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-border/70 bg-white/72 shadow-xs dark:bg-white/[0.06]">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{decodeEscapedUnicode(item.label)}</span>
                    <span className="hidden rounded-md border border-border/70 bg-white/65 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground dark:bg-white/[0.05] sm:inline">
                      Enter
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
