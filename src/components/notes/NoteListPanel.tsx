import { useMemo, useState } from "react";
import {
  Archive,
  CalendarDays,
  CheckSquare,
  FolderInput,
  Grid2x2,
  Inbox,
  Library,
  List,
  Pin,
  Plus,
  Search,
  Sparkles,
  Square,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { NoteExportFormat } from "@/api/export";
import type { Folder, NoteWithTags, Tag } from "@/types/note";
import type { LibraryView, NoteListView, NoteSort } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, decodeEscapedUnicode } from "@/lib/utils";
import { DailyNoteListView, formatDailyHeading, getTodayDateString, isSameLocalDay } from "./DailyNoteListView";
import { EmptyState } from "./EmptyState";
import { NoteCard } from "./NoteCard";
import { TagChip } from "./TagChip";

interface NoteListPanelProps {
  loading: boolean;
  loadError: string | null;
  libraryView: Exclude<LibraryView, "graph" | "knowledge" | "reminders">;
  notes: NoteWithTags[];
  folders: Folder[];
  tags: Tag[];
  selectedNoteId: string | null;
  searchQuery: string;
  recentSearches: string[];
  favoriteOnly: boolean;
  selectedTagId: string | null;
  page: number;
  pageSize: number;
  total: number;
  noteListView: NoteListView;
  noteSort: NoteSort;
  activeDailyDate?: string;
  isTrashView: boolean;
  batchMode: boolean;
  batchSelectedIds: string[];
  onSearch: (value: string) => void;
  onUseRecentSearch: (value: string) => void;
  onFavoriteToggle: () => void;
  onTagToggle: (id: string | null) => void;
  onSelectNote: (id: string) => void;
  onShareNote?: (id: string) => void;
  onExportNote?: (id: string, format: NoteExportFormat) => void;
  onToggleBatchMode: () => void;
  onToggleBatchNote: (id: string) => void;
  onSelectAllVisible: () => void;
  onClearBatchSelection: () => void;
  onBatchDelete: () => void;
  onBatchArchive: () => void;
  onBatchPin: () => void;
  onBatchMoveFolder: (folderId: string | null) => void;
  onQuickDelete?: (id: string) => void;
  onCreateNote: () => void;
  onOpenTemplatePicker: () => void;
  onDailyDateChange?: (date: string) => void;
  onSetListView: (view: NoteListView) => void;
  onSetNoteSort: (sort: NoteSort) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onRetryLoad: () => void;
}

function buildTimeGroups(items: NoteWithTags[], dateKey: "created_at" | "updated_at") {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  const groups = [
    { label: "今天", items: [] as NoteWithTags[] },
    { label: "昨天", items: [] as NoteWithTags[] },
    { label: "更早", items: [] as NoteWithTags[] },
  ];

  for (const item of items) {
    const ts = new Date(item[dateKey]).getTime();
    if (ts >= startOfToday) groups[0].items.push(item);
    else if (ts >= startOfYesterday) groups[1].items.push(item);
    else groups[2].items.push(item);
  }

  return groups.filter((group) => group.items.length > 0);
}

function buildTitleGroups(items: NoteWithTags[]) {
  const map = new Map<string, NoteWithTags[]>();
  for (const item of items) {
    const title = decodeEscapedUnicode(item.title || "无标题笔记").trim();
    const key = (title[0] || "#").toUpperCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "en"))
    .map(([label, grouped]) => ({ label, items: grouped }));
}

function buildGroups(items: NoteWithTags[], sort: NoteSort) {
  if (sort === "created_desc") return buildTimeGroups(items, "created_at");
  if (sort === "title_asc") return buildTitleGroups(items);
  return buildTimeGroups(items, "updated_at");
}

function MetricCard({
  label,
  value,
  tone = "default",
  compact = false,
}: {
  label: string;
  value: string;
  tone?: "default" | "blue" | "green";
  compact?: boolean;
}) {
  const toneClass =
    tone === "blue"
      ? "border-[#007aff]/15 bg-[#007aff]/[0.05]"
      : tone === "green"
        ? "border-emerald-500/15 bg-emerald-500/[0.05]"
        : "border-border/70 bg-white/60 dark:bg-white/[0.03]";

  return (
    <div className={cn("min-w-0 rounded-[18px] border px-2.5", compact ? "py-2.5" : "py-3", toneClass)}>
      <div className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className={cn("mt-1 truncate font-semibold tracking-tight", compact ? "text-base" : "text-lg")}>{value}</div>
    </div>
  );
}

function GroupSection({
  label,
  items,
  noteListView,
  visibleQuery,
  selectedNoteId,
  batchMode,
  batchSelectedIds,
  onTagToggle,
  onSelectNote,
  onToggleBatchNote,
  onShareNote,
  onExportNote,
  onQuickDelete,
}: {
  label: string;
  items: NoteWithTags[];
  noteListView: NoteListView;
  visibleQuery: string;
  selectedNoteId: string | null;
  batchMode: boolean;
  batchSelectedIds: string[];
  onTagToggle: (id: string | null) => void;
  onSelectNote: (id: string) => void;
  onShareNote?: (id: string) => void;
  onExportNote?: (id: string, format: NoteExportFormat) => void;
  onToggleBatchNote: (id: string) => void;
  onQuickDelete?: (id: string) => void;
}) {
  return (
    <section>
      <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={cn(noteListView === "grid" ? "grid grid-cols-2 gap-2.5" : "space-y-2.5")}>
        {items.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            selected={selectedNoteId === note.id}
            compact={noteListView === "grid"}
            query={visibleQuery}
            batchMode={batchMode}
            batchSelected={batchSelectedIds.includes(note.id)}
            onSelect={() => onSelectNote(note.id)}
            onTagSelect={(tagId) => onTagToggle(tagId)}
            onShare={onShareNote ? () => onShareNote(note.id) : undefined}
            onExport={onExportNote ? (format) => onExportNote(note.id, format) : undefined}
            onToggleBatch={() => onToggleBatchNote(note.id)}
            onQuickDelete={onQuickDelete ? () => onQuickDelete(note.id) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

export function NoteListPanel({
  loading,
  loadError,
  libraryView,
  notes,
  folders,
  tags,
  selectedNoteId,
  searchQuery,
  recentSearches,
  favoriteOnly,
  selectedTagId,
  page,
  pageSize,
  total,
  noteListView,
  noteSort,
  activeDailyDate,
  isTrashView,
  batchMode,
  batchSelectedIds,
  onSearch,
  onUseRecentSearch,
  onFavoriteToggle,
  onTagToggle,
  onSelectNote,
  onShareNote,
  onExportNote,
  onToggleBatchMode,
  onToggleBatchNote,
  onSelectAllVisible,
  onClearBatchSelection,
  onBatchDelete,
  onBatchArchive,
  onBatchPin,
  onBatchMoveFolder,
  onQuickDelete,
  onCreateNote,
  onOpenTemplatePicker,
  onDailyDateChange,
  onSetListView,
  onSetNoteSort,
  onPrevPage,
  onNextPage,
  onRetryLoad,
}: NoteListPanelProps) {
  const [batchMoveTarget, setBatchMoveTarget] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const visibleQuery = decodeEscapedUnicode(searchQuery);
  const hasPrev = page > 1;
  const hasNext = page * pageSize < total;
  const hasPagination = hasPrev || hasNext;
  const isInboxView = libraryView === "inbox";
  const isDailyView = libraryView === "daily";
  const isAllView = libraryView === "all";
  const displayDate = activeDailyDate ?? getTodayDateString();
  const isToday = displayDate === getTodayDateString();

  const pinnedNotes = useMemo(() => notes.filter((note) => note.is_pinned), [notes]);
  const regularNotes = useMemo(() => notes.filter((note) => !note.is_pinned), [notes]);
  const groupedRegularNotes = useMemo(() => buildGroups(regularNotes, noteSort), [regularNotes, noteSort]);

  const inboxTodayCount = notes.filter((note) => isSameLocalDay(note.created_at, getTodayDateString())).length;
  const inboxTaggedCount = notes.filter((note) => note.tags.length > 0).length;
  const inboxFavoriteCount = notes.filter((note) => note.is_favorite).length;
  const showPinnedSection = !isTrashView && !isDailyView && !isInboxView && !visibleQuery.trim() && noteSort !== "title_asc";
  const showRecentSearches = recentSearches.length > 0 && !isDailyView;
  const showGridToggle = !isDailyView;
  const showSortSelect = !isDailyView;
  const showTemplateAction = !isTrashView && !isDailyView;
  const showCompactFilterToggle = isDailyView || isInboxView || isAllView;
  const hasActiveCompactFilters = Boolean(visibleQuery.trim() || favoriteOnly || selectedTagId);
  const compactFiltersCollapsed = showCompactFilterToggle && !mobileFiltersOpen && !hasActiveCompactFilters;
  const headerTitle = isTrashView
    ? "回收站"
    : isInboxView
      ? "收集箱"
      : isDailyView
        ? formatDailyHeading(displayDate)
        : isAllView
          ? "全部笔记"
          : "笔记列表";
  const headerDescription = isTrashView
    ? "已删除笔记会先保留在这里，确认后再彻底清空。"
    : isInboxView
      ? "临时记录先放这里，整理后再归档到项目。"
      : isDailyView
        ? `${isToday ? "今天" : displayDate} 的记录会按时间轴展开，适合追踪进展、会议和碎片想法。`
        : isAllView
          ? "这里负责全库浏览、筛选和排序。"
          : total > 0
            ? `${total} 篇笔记`
            : "保持轻量，专注书写。";
  const searchPlaceholder = isInboxView
    ? "搜索待整理内容"
    : isDailyView
      ? "搜索这一天的记录"
      : "搜索标题或内容";
  const emptyState = !visibleQuery.trim()
    ? isTrashView
      ? {
          icon: Trash2,
          title: "回收站为空",
          description: "删除的笔记会先出现在这里。",
          actionLabel: undefined,
        }
      : isInboxView
        ? {
            icon: Inbox,
            title: "收集箱是空的",
            description: "新的临时记录、网页摘录和待整理想法会先落在这里。",
            actionLabel: "快速记录",
          }
        : isDailyView
          ? {
              icon: CalendarDays,
              title: `${formatDailyHeading(displayDate)} 还没有记录`,
              description: "把这一天的会议、想法和进展写在这里，逐步形成连续时间轴。",
              actionLabel: "写下第一条",
            }
          : isAllView
            ? {
                icon: Library,
                title: "还没有任何笔记",
                description: "这里会展示整个笔记库，适合全局浏览、筛选和排序。",
                actionLabel: "新建笔记",
              }
            : {
                icon: Library,
                title: "还没有笔记",
                description: "新建一篇笔记开始记录。",
                actionLabel: "新建笔记",
              }
    : {
        icon: Search,
        title: "没有匹配结果",
        description: "试试换个关键词，或清空筛选后再看。",
        actionLabel: undefined,
      };
  const favoriteLabel = isDailyView ? "仅看当天收藏" : isInboxView ? "仅看收集箱收藏" : "收藏";

  return (
    <aside className="flex h-full min-w-0 flex-col overflow-hidden" style={{ background: "var(--surface-list)" }}>
      <ScrollArea className="min-h-0 flex-1">
        <div
          className={cn(
            "border-b px-3 pb-2 pt-3 sm:px-4 sm:pb-3 sm:pt-4 xl:sticky xl:top-0 xl:z-10",
            showCompactFilterToggle && "pb-1.5 pt-2 sm:pb-2 sm:pt-3",
          )}
          style={{ borderColor: "var(--border-subtle)", background: "var(--surface-list)" }}
        >
        <div className={cn("mb-2 space-y-2 sm:mb-3 sm:space-y-3", showCompactFilterToggle && "mb-1.5 space-y-1.5 sm:mb-2 sm:space-y-2")}>
          <div className="min-w-0">
            <div className="mb-1 flex min-w-0 items-center gap-2">
              <h2 className="min-w-0 truncate text-[17px] font-bold tracking-tight">{headerTitle}</h2>
              {isInboxView ? (
                <span className="inline-flex shrink-0 items-center rounded-full border border-[#007aff]/20 bg-[#007aff]/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#007aff]">
                  Inbox
                </span>
              ) : null}
              {isDailyView ? (
                <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-500/20 bg-emerald-500/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
                  Daily Log
                </span>
              ) : null}
              {isAllView ? (
                <span className="inline-flex shrink-0 items-center rounded-full border border-border/70 bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground dark:bg-white/[0.05]">
                  Library
                </span>
              ) : null}
            </div>
            <p className={cn("mt-0.5 max-w-full truncate text-[12px] leading-5 text-muted-foreground 2xl:max-w-[34ch] 2xl:whitespace-normal", showCompactFilterToggle && "hidden xl:block")}>{headerDescription}</p>
          </div>
          <div className="grid min-w-0 max-w-full gap-1.5 overflow-hidden">
            {showSortSelect || !isTrashView ? (
              <div
                className={cn(
                  "grid min-w-0 max-w-full items-center gap-2",
                  showSortSelect && !isTrashView ? "grid-cols-[minmax(0,1fr)_minmax(104px,120px)] sm:grid-cols-[minmax(0,1fr)_minmax(116px,132px)]" : "grid-cols-1",
                )}
              >
                {showSortSelect ? (
                  <select
                    value={noteSort}
                    onChange={(event) => onSetNoteSort(event.target.value as NoteSort)}
                    className="h-9 w-full min-w-0 max-w-full rounded-[12px] border border-border/70 bg-white/80 px-2.5 py-2 text-xs text-foreground shadow-sm dark:bg-white/[0.06]"
                    aria-label="笔记排序"
                  >
                    <option value="updated_desc">最近更新</option>
                    <option value="created_desc">最近创建</option>
                    <option value="title_asc">标题 A-Z</option>
                  </select>
                ) : null}
                {!isTrashView ? (
                  <Button size="sm" className="w-full min-w-0 justify-center rounded-[14px] px-2.5 shadow-sm sm:px-3" onClick={onCreateNote}>
                    <Plus className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{isDailyView ? "写记录" : isInboxView ? "快速记录" : "新建"}</span>
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 overflow-visible">
              <Button size="sm" variant={batchMode ? "default" : "outline"} className="shrink-0 rounded-[14px] px-3" onClick={onToggleBatchMode}>
                {batchMode ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                批量
              </Button>
              {showCompactFilterToggle ? (
                <Button
                  size="sm"
                  variant={mobileFiltersOpen || hasActiveCompactFilters ? "default" : "outline"}
                  className="shrink-0 rounded-[14px] px-3"
                  aria-expanded={mobileFiltersOpen}
                  onClick={() => setMobileFiltersOpen((value) => !value)}
                >
                  <Search className="h-3.5 w-3.5" />
                  筛选
                </Button>
              ) : null}
              {showGridToggle ? (
                <div className="shrink-0 rounded-[8px] bg-black/[0.05] p-0.5 dark:bg-white/[0.05]">
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors",
                      noteListView === "list" ? "bg-white text-foreground shadow-sm dark:bg-white/[0.12]" : "text-muted-foreground",
                    )}
                    onClick={() => onSetListView("list")}
                  >
                    <List className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors",
                      noteListView === "grid" ? "bg-white text-foreground shadow-sm dark:bg-white/[0.12]" : "text-muted-foreground",
                    )}
                    onClick={() => onSetListView("grid")}
                  >
                    <Grid2x2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {isInboxView ? (
          <div className="mb-2 space-y-1.5 sm:mb-3 sm:space-y-2">
            <div className="hidden items-center gap-2 rounded-[16px] border border-[#007aff]/15 bg-[#007aff]/[0.04] px-3 py-2 text-sm text-muted-foreground 2xl:flex">
              <Inbox className="h-4 w-4 shrink-0 text-[#007aff]" />
              <span className="truncate">先收集，再整理。灵感、摘抄和临时待办都先落这里。</span>
            </div>
            <div className="hidden grid-cols-3 gap-2 2xl:grid">
              <MetricCard label="待整理" value={String(total)} tone="blue" compact />
              <MetricCard label="今日收入" value={String(inboxTodayCount)} compact />
              <MetricCard label="已加标签" value={String(inboxTaggedCount)} compact />
            </div>
            <div className="rounded-[14px] border border-dashed border-[#007aff]/25 bg-[#007aff]/[0.04] px-2 py-1.5 sm:px-2.5">
              <div className="flex items-center justify-between gap-2 sm:gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-medium text-muted-foreground">
                    待整理 {total} · 今日 {inboxTodayCount} · 收藏 {inboxFavoriteCount} · 标签 {inboxTaggedCount}
                  </div>
                </div>
                <div className="flex min-w-0 flex-wrap justify-end gap-1.5 sm:gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 min-w-0 rounded-[10px] px-2 text-[11px] sm:px-2.5"
                    onClick={() => {
                      if (!batchMode) onToggleBatchMode();
                      onSelectAllVisible();
                    }}
                  >
                    快速清理
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 min-w-0 rounded-[10px] px-2 text-[11px] sm:px-2.5" onClick={() => !batchMode && onToggleBatchMode()}>
                    批量归类
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {isAllView ? (
          <div className="mb-3 hidden grid-cols-3 gap-2 2xl:grid">
            <MetricCard label="当前结果" value={String(total)} />
            <MetricCard label="文件夹" value={String(folders.length)} />
            <MetricCard label="标签" value={String(tags.length)} />
          </div>
        ) : null}

        {batchMode ? (
          <div className="scrollbar-subtle mb-3 flex flex-nowrap items-center gap-2 overflow-x-auto rounded-[14px] border border-border/70 bg-white/70 p-2 dark:bg-white/[0.05]">
            <span className="whitespace-nowrap text-xs text-muted-foreground">已选择 {batchSelectedIds.length} 项</span>
            <Button size="sm" variant="outline" className="rounded-[12px] whitespace-nowrap" onClick={onSelectAllVisible}>
              全选当前页
            </Button>
            <Button size="sm" variant="outline" className="rounded-[12px] whitespace-nowrap" onClick={onClearBatchSelection}>
              清空
            </Button>
            {!isTrashView ? (
              <>
                <Button size="sm" variant="outline" className="rounded-[12px] whitespace-nowrap" disabled={batchSelectedIds.length === 0} onClick={onBatchArchive}>
                  <Archive className="h-3.5 w-3.5" />
                  批量归档
                </Button>
                <Button size="sm" variant="outline" className="rounded-[12px] whitespace-nowrap" disabled={batchSelectedIds.length === 0} onClick={onBatchPin}>
                  <Pin className="h-3.5 w-3.5" />
                  批量置顶
                </Button>
                <div className="flex items-center gap-2 rounded-[10px] border border-border/70 bg-background/60 px-2 py-1">
                  <FolderInput className="h-3.5 w-3.5 text-muted-foreground" />
                  <select
                    value={batchMoveTarget}
                    onChange={(event) => setBatchMoveTarget(event.target.value)}
                    className="h-7 min-w-[120px] rounded-[8px] border border-border/60 bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                    aria-label="批量移动到文件夹"
                  >
                    <option value="">移动到...</option>
                    <option value="__inbox__">Inbox（无文件夹）</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {decodeEscapedUnicode(folder.name)}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-[10px] whitespace-nowrap"
                    disabled={batchSelectedIds.length === 0 || !batchMoveTarget}
                    onClick={() => {
                      onBatchMoveFolder(batchMoveTarget === "__inbox__" ? null : batchMoveTarget);
                      setBatchMoveTarget("");
                    }}
                  >
                    移动
                  </Button>
                </div>
              </>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="rounded-[12px] whitespace-nowrap text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={batchSelectedIds.length === 0}
              onClick={onBatchDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {isTrashView ? "批量永久删除" : "批量删除"}
            </Button>
          </div>
        ) : null}

        <div className={cn("mac-input-shell relative mb-2 px-1 sm:mb-3", compactFiltersCollapsed && "hidden")}>
          <Search className="pointer-events-none absolute left-3.5 top-2.5 h-4 w-4 text-muted-foreground sm:top-3" />
          <Input
            id="note-search-input"
            value={visibleQuery}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-10 border-transparent bg-transparent pl-10 pr-9 shadow-none focus-visible:ring-0 sm:h-11"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearch("")}
              className="absolute right-2 top-2.5 rounded-lg p-1 text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.05]"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className={cn("scrollbar-subtle mb-1 flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 sm:mb-2 sm:flex-wrap sm:overflow-visible sm:pb-0", compactFiltersCollapsed && "hidden")}>
          <Button size="sm" variant={favoriteOnly ? "default" : "outline"} className="shrink-0 rounded-[14px]" onClick={onFavoriteToggle}>
            <Star className={cn("h-3.5 w-3.5", favoriteOnly && "fill-current")} />
            {favoriteLabel}
          </Button>
          {showTemplateAction ? (
            <Button size="sm" variant="outline" className="shrink-0 rounded-[14px]" onClick={onOpenTemplatePicker}>
              <Sparkles className="h-3.5 w-3.5" />
              模板
            </Button>
          ) : null}
        </div>

        {showRecentSearches && !compactFiltersCollapsed ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {recentSearches.slice(0, 4).map((q) => (
              <button
                key={q}
                className="rounded-full border border-border/70 px-2 py-1 text-[11px] text-muted-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                onClick={() => onUseRecentSearch(q)}
              >
                {q}
              </button>
            ))}
          </div>
        ) : null}

        {tags.length > 0 && !compactFiltersCollapsed ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                active={selectedTagId === tag.id}
                onClick={() => onTagToggle(selectedTagId === tag.id ? null : tag.id)}
              />
            ))}
          </div>
        ) : null}
      </div>

        <div className={cn("px-3 py-2 sm:px-4 sm:py-3", showCompactFilterToggle && "py-1.5 sm:py-2", isDailyView && "px-2.5 sm:px-4")}>
        {loading ? <p className="px-2 py-8 text-sm text-muted-foreground">正在加载...</p> : null}

        {!loading && loadError ? (
          <EmptyState
            title="加载失败"
            description={loadError}
            actionLabel="重试"
            onAction={onRetryLoad}
          />
        ) : null}

        {!loading && !loadError && notes.length === 0 ? (
          <EmptyState
            icon={emptyState.icon}
            title={emptyState.title}
            description={emptyState.description}
            actionLabel={emptyState.actionLabel}
            onAction={emptyState.actionLabel ? onCreateNote : undefined}
          />
        ) : null}

        {!loading && !loadError && notes.length > 0 ? (
          isDailyView ? (
            <DailyNoteListView
              items={notes}
              displayDate={displayDate}
              total={total}
              visibleQuery={visibleQuery}
              selectedNoteId={selectedNoteId}
              batchMode={batchMode}
              batchSelectedIds={batchSelectedIds}
              onDailyDateChange={onDailyDateChange}
              onTagToggle={onTagToggle}
              onSelectNote={onSelectNote}
              onShareNote={onShareNote}
              onExportNote={onExportNote}
              onToggleBatchNote={onToggleBatchNote}
              onQuickDelete={onQuickDelete}
            />
          ) : (
            <div className="space-y-4">
              {showPinnedSection && pinnedNotes.length > 0 ? (
                <GroupSection
                  label="置顶"
                  items={pinnedNotes}
                  noteListView={noteListView}
                  visibleQuery={visibleQuery}
                  selectedNoteId={selectedNoteId}
                  batchMode={batchMode}
                  batchSelectedIds={batchSelectedIds}
                  onTagToggle={onTagToggle}
                  onSelectNote={onSelectNote}
                  onShareNote={onShareNote}
                  onExportNote={onExportNote}
                  onToggleBatchNote={onToggleBatchNote}
                  onQuickDelete={onQuickDelete}
                />
              ) : null}

              {groupedRegularNotes.map((group) => (
                <GroupSection
                  key={group.label}
                  label={group.label}
                  items={group.items}
                  noteListView={noteListView}
                  visibleQuery={visibleQuery}
                  selectedNoteId={selectedNoteId}
                  batchMode={batchMode}
                  batchSelectedIds={batchSelectedIds}
                  onTagToggle={onTagToggle}
                  onSelectNote={onSelectNote}
                  onShareNote={onShareNote}
                  onExportNote={onExportNote}
                  onToggleBatchNote={onToggleBatchNote}
                  onQuickDelete={onQuickDelete}
                />
              ))}
            </div>
          )
        ) : null}
        </div>
      </ScrollArea>

      <div className={cn("border-t px-3 py-1.5 text-xs text-muted-foreground sm:px-4 sm:py-2", !hasPagination && "hidden")} style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center justify-between">
          <span>
            {total === 0 ? "0" : `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)}`} / {total}
          </span>
          <div className={cn("items-center gap-1.5 sm:gap-2", hasPagination ? "flex" : "hidden sm:flex")}>
            <Button size="sm" variant="outline" className="rounded-[10px]" disabled={!hasPrev} onClick={onPrevPage}>
              上一页
            </Button>
            <Button size="sm" variant="outline" className="rounded-[10px]" disabled={!hasNext} onClick={onNextPage}>
              下一页
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
