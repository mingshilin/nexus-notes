import {
  Archive,
  Bell,
  Clock4,
  Copy,
  CopyPlus,
  Download,
  Eye,
  FileText,
  Focus,
  FolderOpen,
  LayoutPanelTop,
  PanelRight,
  Pin,
  Save,
  Share2,
  Sparkles,
  Star,
} from "lucide-react";
import { NOTE_EXPORT_FORMATS, getExportFormatLabel } from "@/lib/noteActions";
import type { NoteWithTags } from "@/types/note";
import type { EditorMode, SaveStatus } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { MoreMenu } from "@/components/ui/MoreMenu";
import { SaveStatusIndicator } from "@/components/notes/SaveStatusIndicator";
import { cn, decodeEscapedUnicode } from "@/lib/utils";

interface EditorHeaderProps {
  note: NoteWithTags;
  editorMode: EditorMode;
  saveStatus: SaveStatus;
  saveError: string | null;
  focusMode: boolean;
  inspectorOpen?: boolean;
  readOnly?: boolean;
  onModeChange: (mode: EditorMode) => void;
  onSaveNow: () => void;
  onRetrySave: () => void;
  onToggleFavorite: () => void;
  onTogglePinned: () => void;
  onArchiveToggle: () => void;
  onDuplicate: () => void;
  onCopyInternalLink: () => void;
  onFocusModeToggle: () => void;
  onOpenHistory: () => void;
  onOpenMoveFolder: () => void;
  onOpenTemplatePicker: () => void;
  onOpenQuickReminder: () => void;
  onShare: () => void;
  onExportMarkdown: () => void;
  onExportMenuOpen?: (format: "md" | "txt" | "html" | "csv" | "pdf" | "docx") => void;
  onDelete: () => void;
  onToggleInspector: () => void;
}

const modeOptions = [
  { key: "write" as const, label: "编辑", icon: FileText },
  { key: "preview" as const, label: "预览", icon: Eye },
  { key: "split" as const, label: "分屏", icon: Sparkles },
];

function getStatusText(note: NoteWithTags) {
  if (note.archived_at) return "已归档";
  if (note.is_pinned) return "已置顶";
  if (note.is_favorite) return "已收藏";
  return "草稿";
}

export function EditorHeader({
  note,
  editorMode,
  saveStatus,
  saveError,
  focusMode,
  inspectorOpen = false,
  readOnly = false,
  onModeChange,
  onSaveNow,
  onRetrySave,
  onToggleFavorite,
  onTogglePinned,
  onArchiveToggle,
  onDuplicate,
  onCopyInternalLink,
  onFocusModeToggle,
  onOpenHistory,
  onOpenMoveFolder,
  onOpenTemplatePicker,
  onOpenQuickReminder,
  onShare,
  onExportMarkdown,
  onExportMenuOpen,
  onDelete,
  onToggleInspector,
}: EditorHeaderProps) {
  return (
    <header
      className="glass-toolbar relative z-20 flex shrink-0 flex-col gap-2 border-b px-3 py-2 text-black/75 dark:text-white/80 md:px-4"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="state-chip shrink-0">{getStatusText(note)}</span>
          <span className="hidden text-muted-foreground sm:inline">/</span>
          <span className="hidden max-w-36 truncate text-muted-foreground sm:inline">
            {decodeEscapedUnicode(note.folder?.name ?? "Inbox")}
          </span>
          <span className="hidden text-muted-foreground sm:inline">/</span>
          <span className="max-w-[42vw] truncate font-medium text-foreground md:max-w-[30vw]">
            {decodeEscapedUnicode(note.title) || "无标题笔记"}
          </span>
          {readOnly ? <span className="state-chip shrink-0">只读</span> : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div className="hidden sm:block">
            <SaveStatusIndicator status={saveStatus} error={saveError} onRetry={onRetrySave} />
          </div>
          <Button size="sm" variant="outline" className="hidden rounded-xl md:inline-flex" onClick={onShare}>
            <Share2 className="h-4 w-4" />
            分享
          </Button>
          {onExportMenuOpen ? (
            <MoreMenu
              triggerLabel="导出笔记"
              menuClassName="w-52"
              trigger={
                <Button size="sm" variant="outline" className="hidden rounded-xl md:inline-flex">
                  <Download className="h-4 w-4" />
                  导出
                </Button>
              }
            >
              {NOTE_EXPORT_FORMATS.map((format) => (
                <button
                  key={format}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
                  onClick={() => onExportMenuOpen(format)}
                >
                  <Download className="h-4 w-4" />
                  导出 {getExportFormatLabel(format)}
                </button>
              ))}
            </MoreMenu>
          ) : null}
          <Button
            size="sm"
            variant={inspectorOpen ? "default" : "outline"}
            className="h-9 rounded-xl px-2.5"
            aria-label={inspectorOpen ? "关闭信息面板" : "打开信息面板"}
            aria-pressed={inspectorOpen}
            title={inspectorOpen ? "关闭信息面板" : "打开信息面板"}
            onClick={onToggleInspector}
          >
            <PanelRight className="h-4 w-4" />
            <span className="hidden md:inline">{inspectorOpen ? "关闭信息" : "信息"}</span>
          </Button>
          <MoreMenu triggerLabel="更多操作">
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
              onClick={onArchiveToggle}
              disabled={readOnly}
            >
              <Archive className="h-4 w-4" />
              {note.archived_at ? "恢复笔记" : "归档笔记"}
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
              onClick={onOpenTemplatePicker}
              disabled={readOnly}
            >
              <Sparkles className="h-4 w-4" />
              应用模板
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
              onClick={onOpenMoveFolder}
              disabled={readOnly}
            >
              <FolderOpen className="h-4 w-4" />
              移动到文件夹
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
              onClick={onOpenQuickReminder}
              disabled={readOnly}
            >
              <Bell className="h-4 w-4" />
              创建提醒
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
              onClick={onDuplicate}
              disabled={readOnly}
            >
              <CopyPlus className="h-4 w-4" />
              复制为新笔记
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
              onClick={onCopyInternalLink}
            >
              <Copy className="h-4 w-4" />
              复制内部链接
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
              onClick={onFocusModeToggle}
            >
              <Focus className="h-4 w-4" />
              {focusMode ? "退出专注模式" : "进入专注模式"}
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
              onClick={onOpenHistory}
            >
              <Clock4 className="h-4 w-4" />
              历史版本
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
              onClick={() => onModeChange("preview")}
            >
              <Eye className="h-4 w-4" />
              阅读模式
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
              onClick={() => onModeChange("split")}
            >
              <LayoutPanelTop className="h-4 w-4" />
              打开分屏
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
              onClick={onShare}
            >
              <Share2 className="h-4 w-4" />
              分享
            </button>
            {onExportMenuOpen
              ? NOTE_EXPORT_FORMATS.map((format) => (
                  <button
                    key={format}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
                    onClick={() => onExportMenuOpen(format)}
                  >
                    <Download className="h-4 w-4" />
                    导出 {getExportFormatLabel(format)}
                  </button>
                ))
              : null}
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
              onClick={onDelete}
              disabled={readOnly}
            >
              删除笔记
            </button>
          </MoreMenu>
        </div>
      </div>

      <div className="scrollbar-subtle flex items-center justify-between gap-2 overflow-x-auto pb-0.5">
        <div className="flex shrink-0 items-center gap-1 rounded-[10px] bg-black/[0.04] p-1 dark:bg-white/[0.05]">
          {modeOptions.map((mode) => {
            const Icon = mode.icon;
            return (
              <button
                key={mode.key}
                type="button"
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 text-xs font-medium transition-colors",
                  editorMode === mode.key
                    ? "bg-white text-foreground shadow-sm dark:bg-white/[0.12]"
                    : "text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.04]",
                )}
                onClick={() => onModeChange(mode.key)}
              >
                <Icon className="h-3.5 w-3.5" />
                {mode.label}
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon" variant="ghost" className="rounded-xl" onClick={onSaveNow} disabled={readOnly}>
            <Save className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="rounded-xl md:hidden" onClick={onShare}>
            <Share2 className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="rounded-xl" onClick={onToggleFavorite} disabled={readOnly}>
            <Star className={cn("h-4 w-4", note.is_favorite && "fill-[#ff9500] text-[#ff9500]")} />
          </Button>
          <Button size="icon" variant="ghost" className="rounded-xl" onClick={onTogglePinned} disabled={readOnly}>
            <Pin className={cn("h-4 w-4", note.is_pinned && "fill-[#ffcc00] text-[#ffcc00]")} />
          </Button>
          <Button size="icon" variant="ghost" className="rounded-xl" onClick={onExportMarkdown}>
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="sm:hidden">
        <SaveStatusIndicator status={saveStatus} error={saveError} onRetry={onRetrySave} />
      </div>
    </header>
  );
}
