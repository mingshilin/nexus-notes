import { useState } from "react";
import { FileSearch, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  displayText,
  type DuplicateTitleGroup,
  EmptyLine,
  formatTime,
  Highlight,
  StatusPill,
  type SmartSearchResult,
} from "@/components/knowledge/KnowledgeCenterShared";
import type { Database } from "@/types/database";
import type { KnowledgeDiagnostic, SavedSearch, SavedSearchSourceType } from "@/types/knowledge";
import type { Folder, Tag } from "@/types/note";
import type { WorkspaceMember } from "@/types/workspace";

const sourceTypeLabels: Record<SavedSearchSourceType, string> = {
  notes: "笔记",
  attachments: "附件",
  ocr: "OCR 文本",
};

const attachmentTypeOptions = [
  { id: "image", label: "图片" },
  { id: "pdf", label: "PDF" },
  { id: "other", label: "其他" },
];

const attachmentStatusOptions = [
  { id: "pending", label: "待识别" },
  { id: "processing", label: "识别中" },
  { id: "ready", label: "已完成" },
  { id: "failed", label: "失败" },
  { id: "unsupported", label: "不支持" },
];

interface SmartViewsTabProps {
  savedSearchName: string;
  savedSearchQuery: string;
  savedSearches: SavedSearch[];
  activeSearchQuery: string;
  searchResults: SmartSearchResult[];
  diagnostics: KnowledgeDiagnostic | null;
  duplicateTitleGroups: DuplicateTitleGroup[];
  readOnly: boolean;
  selectedSourceTypes: SavedSearchSourceType[];
  selectedTagIds: string[];
  selectedFolderIds: string[];
  selectedDatabaseIds: string[];
  selectedMemberIds: string[];
  selectedAttachmentTypes: string[];
  selectedAttachmentStatus: string[];
  classifyingUnorganized: boolean;
  taggingOrphans: boolean;
  filterOptions: {
    tags: Tag[];
    folders: Folder[];
    databases: Database[];
    members: WorkspaceMember[];
  };
  onSavedSearchNameChange: (value: string) => void;
  onSavedSearchQueryChange: (value: string) => void;
  onToggleSourceType: (value: SavedSearchSourceType) => void;
  onToggleTag: (id: string) => void;
  onToggleFolder: (id: string) => void;
  onToggleDatabase: (id: string) => void;
  onToggleMember: (id: string) => void;
  onToggleAttachmentType: (id: string) => void;
  onToggleAttachmentStatus: (id: string) => void;
  onSubmitSavedSearch: () => void;
  onApplySavedSearch: (item: SavedSearch) => void;
  onDeleteSavedSearch: (id: string) => Promise<void>;
  onClearActiveSearch: () => void;
  onOpenNote: (id: string) => void;
  onClassifyUnorganized: (target: { type: "inbox" | "folder" | "database"; id?: string }) => Promise<void>;
  onTagOrphanNotes: (tagId: string) => Promise<void>;
  onIgnoreOrphanNotes: () => void;
  onRenameDuplicateNote: (noteId: string, currentTitle: string) => Promise<void>;
  onMergeDuplicateTitleGroup: (group: DuplicateTitleGroup) => Promise<void>;
}

export function SmartViewsTab({
  savedSearchName,
  savedSearchQuery,
  savedSearches,
  activeSearchQuery,
  searchResults,
  diagnostics,
  duplicateTitleGroups,
  readOnly,
  selectedSourceTypes,
  selectedTagIds,
  selectedFolderIds,
  selectedDatabaseIds,
  selectedMemberIds,
  selectedAttachmentTypes,
  selectedAttachmentStatus,
  classifyingUnorganized,
  taggingOrphans,
  filterOptions,
  onSavedSearchNameChange,
  onSavedSearchQueryChange,
  onToggleSourceType,
  onToggleTag,
  onToggleFolder,
  onToggleDatabase,
  onToggleMember,
  onToggleAttachmentType,
  onToggleAttachmentStatus,
  onSubmitSavedSearch,
  onApplySavedSearch,
  onDeleteSavedSearch,
  onClearActiveSearch,
  onOpenNote,
  onClassifyUnorganized,
  onTagOrphanNotes,
  onIgnoreOrphanNotes,
  onRenameDuplicateNote,
  onMergeDuplicateTitleGroup,
}: SmartViewsTabProps) {
  const [unorganizedTargetType, setUnorganizedTargetType] = useState<"inbox" | "folder" | "database">("inbox");
  const [unorganizedTargetId, setUnorganizedTargetId] = useState("");
  const [orphanTagId, setOrphanTagId] = useState("");
  const orphanCount = diagnostics?.orphan_notes.length ?? 0;
  const unorganizedCount = diagnostics?.unorganized_notes.length ?? 0;
  const targetOptions = unorganizedTargetType === "folder" ? filterOptions.folders : unorganizedTargetType === "database" ? filterOptions.databases : [];
  const targetRequired = unorganizedTargetType !== "inbox";
  const canClassifyUnorganized = !readOnly && unorganizedCount > 0 && !classifyingUnorganized && (!targetRequired || Boolean(unorganizedTargetId));
  const canTagOrphans = !readOnly && orphanCount > 0 && !taggingOrphans && Boolean(orphanTagId);

  return (
    <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <Card title="保存搜索为智能视图" icon={Search}>
        <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
          <Input value={savedSearchName} onChange={(event) => onSavedSearchNameChange(event.target.value)} placeholder="视图名称" className="rounded-[12px]" />
          <Input value={savedSearchQuery} onChange={(event) => onSavedSearchQueryChange(event.target.value)} placeholder="搜索关键词" className="rounded-[12px]" />
          <Button disabled={readOnly || !savedSearchName.trim()} className="rounded-[12px]" onClick={() => void onSubmitSavedSearch()}>保存</Button>
        </div>
        <div className="mt-3 space-y-3 rounded-[16px] border border-border/70 bg-background/60 p-3">
          <FilterGroup
            title="来源"
            options={(Object.keys(sourceTypeLabels) as SavedSearchSourceType[]).map((id) => ({ id, label: sourceTypeLabels[id] }))}
            selectedIds={selectedSourceTypes}
            onToggle={(id) => onToggleSourceType(id as SavedSearchSourceType)}
          />
          <FilterGroup title="标签" options={filterOptions.tags.map((tag) => ({ id: tag.id, label: tag.name }))} selectedIds={selectedTagIds} onToggle={onToggleTag} emptyText="暂无标签" />
          <FilterGroup title="文件夹" options={filterOptions.folders.map((folder) => ({ id: folder.id, label: folder.name }))} selectedIds={selectedFolderIds} onToggle={onToggleFolder} emptyText="暂无文件夹" />
          <FilterGroup title="数据库" options={filterOptions.databases.map((database) => ({ id: database.id, label: displayText(database.name) }))} selectedIds={selectedDatabaseIds} onToggle={onToggleDatabase} emptyText="暂无数据库" />
          <FilterGroup title="成员" options={filterOptions.members.map((member) => ({ id: member.user_id, label: member.display_name || member.email || member.user_id }))} selectedIds={selectedMemberIds} onToggle={onToggleMember} emptyText="暂无成员" />
          <FilterGroup title="附件类型" options={attachmentTypeOptions} selectedIds={selectedAttachmentTypes} onToggle={onToggleAttachmentType} />
          <FilterGroup title="OCR 状态" options={attachmentStatusOptions} selectedIds={selectedAttachmentStatus} onToggle={onToggleAttachmentStatus} />
        </div>
        <div className="mt-3 space-y-2">
          {savedSearches.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-[14px] bg-background/70 px-3 py-2 text-sm">
              <button className="min-w-0 text-left" onClick={() => onApplySavedSearch(item)}>
                <div className="truncate font-medium">{item.name}</div>
                <div className="truncate text-xs text-muted-foreground">{item.query || "无关键词"} · {formatTime(item.updated_at)}</div>
              </button>
              <Button size="sm" variant="outline" className="rounded-[10px]" disabled={readOnly} onClick={() => void onDeleteSavedSearch(item.id)}>删除</Button>
            </div>
          ))}
          {savedSearches.length === 0 ? <EmptyLine>暂无智能视图。保存一个常用搜索后可一键打开。</EmptyLine> : null}
        </div>
        {activeSearchQuery ? (
          <div className="mt-4 rounded-[16px] border border-border/70 bg-background/70 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">当前结果：{activeSearchQuery}</div>
              <Button size="sm" variant="ghost" onClick={onClearActiveSearch}>清空</Button>
            </div>
            <div className="space-y-2">
              {searchResults.map((item) => (
                <button key={`${item.kind}-${item.id}`} className="block w-full rounded-[12px] bg-white/70 px-3 py-2 text-left text-sm dark:bg-white/[0.04]" onClick={() => onOpenNote(item.noteId)}>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={item.kind === "note" ? "info" : "muted"}>{item.kind === "note" ? "笔记" : "附件"}</StatusPill>
                    <span className="truncate font-medium"><Highlight text={item.title} query={activeSearchQuery} /></span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground"><Highlight text={item.detail} query={activeSearchQuery} /></div>
                  {item.hitSources.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.hitSources.map((source) => (
                        <span key={`${item.kind}-${item.id}-${source.label}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                          <span className="shrink-0 font-medium">命中：{source.label}</span>
                          <span className="truncate text-primary/80"><Highlight text={source.excerpt} query={activeSearchQuery} /></span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </button>
              ))}
              {searchResults.length === 0 ? <EmptyLine>没有找到匹配的笔记、属性或附件。</EmptyLine> : null}
            </div>
          </div>
        ) : null}
      </Card>

      <Card title="知识健康诊断" icon={FileSearch}>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-3">
            <DiagnosticColumn title="孤立笔记" items={diagnostics?.orphan_notes ?? []} actionLabel="打开" onOpenNote={onOpenNote} />
            <div className="rounded-[14px] border border-border/70 bg-background/70 p-3">
              <div className="mb-2 text-xs font-semibold text-muted-foreground">批量处理孤立笔记</div>
              <div className="grid gap-2">
                <select value={orphanTagId} onChange={(event) => setOrphanTagId(event.target.value)} className="rounded-[10px] border border-input bg-background px-2 py-1.5 text-xs">
                  <option value="">选择标签</option>
                  {filterOptions.tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                </select>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="rounded-[10px]" disabled={!canTagOrphans} onClick={() => void onTagOrphanNotes(orphanTagId)}>
                    {taggingOrphans ? "加标签中" : `批量加标签 ${orphanCount || ""}`}
                  </Button>
                  <Button size="sm" variant="ghost" className="rounded-[10px]" disabled={readOnly || orphanCount === 0} onClick={onIgnoreOrphanNotes}>标记忽略</Button>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <DiagnosticColumn title="未整理" items={diagnostics?.unorganized_notes ?? []} actionLabel="整理" onOpenNote={onOpenNote} />
            <div className="rounded-[14px] border border-border/70 bg-background/70 p-3">
              <div className="mb-2 text-xs font-semibold text-muted-foreground">批量归类未整理</div>
              <div className="grid gap-2">
                <select value={unorganizedTargetType} onChange={(event) => {
                  setUnorganizedTargetType(event.target.value as "inbox" | "folder" | "database");
                  setUnorganizedTargetId("");
                }} className="rounded-[10px] border border-input bg-background px-2 py-1.5 text-xs">
                  <option value="inbox">收集箱</option>
                  <option value="folder">文件夹</option>
                  <option value="database">数据库</option>
                </select>
                {targetRequired ? (
                  <select value={unorganizedTargetId} onChange={(event) => setUnorganizedTargetId(event.target.value)} className="rounded-[10px] border border-input bg-background px-2 py-1.5 text-xs">
                    <option value="">{unorganizedTargetType === "folder" ? "选择文件夹" : "选择数据库"}</option>
                    {targetOptions.map((item) => <option key={item.id} value={item.id}>{displayText(item.name)}</option>)}
                  </select>
                ) : null}
                <Button size="sm" variant="outline" className="rounded-[10px]" disabled={!canClassifyUnorganized} onClick={() => void onClassifyUnorganized({ type: unorganizedTargetType, id: unorganizedTargetId || undefined })}>
                  {classifyingUnorganized ? "归类中" : `批量归类 ${unorganizedCount || ""}`}
                </Button>
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-muted-foreground">重复标题</div>
              {duplicateTitleGroups.length > 0 ? <StatusPill tone="warn">{duplicateTitleGroups.length} 组</StatusPill> : null}
            </div>
            {duplicateTitleGroups.map((group) => (
              <div key={group.title} className="rounded-[12px] bg-background/70 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{displayText(group.title)}</div>
                    <div className="text-xs text-muted-foreground">发现 {group.notes.length} 篇同名笔记，V1 合并会追加内容并合并标签，保留原笔记。</div>
                  </div>
                  <StatusPill tone="warn">{group.notes.length}</StatusPill>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="rounded-[10px]" onClick={() => onOpenNote(group.notes[0].id)}>打开</Button>
                  <Button size="sm" variant="outline" className="rounded-[10px]" disabled={readOnly} onClick={() => void onRenameDuplicateNote(group.notes[0].id, displayText(group.notes[0].title, "无标题"))}>重命名</Button>
                  <Button size="sm" className="rounded-[10px]" disabled={readOnly || group.notes.length < 2} onClick={() => void onMergeDuplicateTitleGroup(group)}>合并</Button>
                </div>
              </div>
            ))}
            {duplicateTitleGroups.length === 0 ? <EmptyLine>未发现重复标题。</EmptyLine> : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

function FilterGroup({ title, options, selectedIds, onToggle, emptyText = "全部" }: { title: string; options: Array<{ id: string; label: string }>; selectedIds: string[]; onToggle: (id: string) => void; emptyText?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      {options.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const active = selectedIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-white/70 text-muted-foreground hover:bg-white dark:bg-white/[0.04]"}`}
                onClick={() => onToggle(option.id)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">{emptyText}</div>
      )}
    </div>
  );
}

function DiagnosticColumn({ title, items, actionLabel, onOpenNote }: { title: string; items: Array<{ id: string; title: string; updated_at: string }>; actionLabel: string; onOpenNote: (id: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-muted-foreground">{title}</div>
        {items.length > 0 ? <StatusPill tone="warn">{items.length}</StatusPill> : null}
      </div>
      {items.slice(0, 8).map((item) => (
        <button key={item.id} className="block w-full rounded-[12px] bg-background/70 px-3 py-2 text-left text-sm" onClick={() => onOpenNote(item.id)}>
          <div className="truncate font-medium">{displayText(item.title, "无标题")}</div>
          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{formatTime(item.updated_at)}</span>
            <span>{actionLabel}</span>
          </div>
        </button>
      ))}
      {items.length === 0 ? <EmptyLine>暂无。</EmptyLine> : null}
    </div>
  );
}
