import { CalendarDays, Edit3, Filter, KanbanSquare, Plus, Settings2, Table2, Trash2 } from "lucide-react";
import type { Database, DatabaseRecordTemplate, DatabaseViewKind } from "@/types/database";
import { Button } from "@/components/ui/button";
import { cn, decodeEscapedUnicode, normalizeDisplayIcon } from "@/lib/utils";

const viewTabs = [
  { key: "table" as const, label: "表格", icon: Table2 },
  { key: "board" as const, label: "看板", icon: KanbanSquare },
  { key: "calendar" as const, label: "日历", icon: CalendarDays },
];

interface DatabaseToolbarProps {
  database: Database;
  templates: DatabaseRecordTemplate[];
  activeView: DatabaseViewKind;
  selectedTemplateId: string;
  onSelectedTemplateChange: (value: string) => void;
  onToggleDatabaseEditor: () => void;
  onTogglePropertyManager: () => void;
  onToggleViewOptions: () => void;
  onExportCsv?: () => Promise<void> | void;
  onImportCsvClick?: () => void;
  onCreateNote: (templateId?: string | null) => void;
  onRequestDeleteDatabase: () => void;
  onViewChange: (view: DatabaseViewKind) => void;
}

export function DatabaseToolbar({
  database,
  templates,
  activeView,
  selectedTemplateId,
  onSelectedTemplateChange,
  onToggleDatabaseEditor,
  onTogglePropertyManager,
  onToggleViewOptions,
  onExportCsv,
  onImportCsvClick,
  onCreateNote,
  onRequestDeleteDatabase,
  onViewChange,
}: DatabaseToolbarProps) {
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:text-xs">Database</div>
          <div className="mt-1 flex items-center gap-2">
            <h2 className="truncate text-xl font-bold tracking-tight sm:text-2xl">
              {normalizeDisplayIcon(database.icon) ? `${normalizeDisplayIcon(database.icon)} ` : ""}
              {decodeEscapedUnicode(database.name)}
            </h2>
            <Button size="icon" variant="ghost" className="h-8 w-8 rounded-[10px]" onClick={onToggleDatabaseEditor}>
              <Edit3 className="h-3.5 w-3.5" />
            </Button>
          </div>
          {database.description ? <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground sm:mt-1 sm:line-clamp-none sm:text-sm">{decodeEscapedUnicode(database.description)}</p> : null}
        </div>
        <div className="scrollbar-subtle -mx-1 flex max-w-full min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto px-1 pb-0.5 sm:mx-0 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:px-0 sm:pb-0">
          <Button size="sm" variant="outline" className="rounded-[12px]" aria-label="manage-properties" onClick={onTogglePropertyManager}>
            <Settings2 className="h-3.5 w-3.5" />
            属性
          </Button>
          <Button size="sm" variant="outline" className="rounded-[12px]" onClick={onToggleViewOptions}>
            <Filter className="h-3.5 w-3.5" />
            视图
          </Button>
          {onExportCsv ? <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => void onExportCsv()}>CSV 导出</Button> : null}
          {onImportCsvClick ? <Button size="sm" variant="outline" className="rounded-[12px]" onClick={onImportCsvClick}>CSV 导入</Button> : null}
          {templates.length > 0 ? (
            <select
              value={selectedTemplateId}
              onChange={(event) => onSelectedTemplateChange(event.target.value)}
              className="h-9 max-w-full rounded-[12px] border border-input bg-background/80 px-2 text-sm outline-none"
              aria-label="record-template"
            >
              <option value="">空白模板</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
          ) : null}
          <Button size="sm" className="rounded-[12px]" onClick={() => onCreateNote(selectedTemplateId || null)}>
            <Plus className="h-3.5 w-3.5" />
            新建记录
          </Button>
          <Button size="sm" variant="outline" className="rounded-[12px] text-destructive" onClick={onRequestDeleteDatabase}>
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </Button>
        </div>
      </div>

      <div className="scrollbar-subtle mt-3 flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5 sm:mt-4 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:pb-0">
        {viewTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-[12px] border px-2.5 py-1.5 text-xs transition-colors sm:gap-2 sm:px-3 sm:py-2 sm:text-sm",
                activeView === tab.key
                  ? "border-[#007aff]/20 bg-[#007aff]/8 text-[#007aff]"
                  : "border-border/70 bg-white/70 text-foreground/75 dark:bg-white/[0.04]",
              )}
              onClick={() => onViewChange(tab.key)}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>
    </>
  );
}
