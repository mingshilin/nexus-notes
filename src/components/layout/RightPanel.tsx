import { Clock4, FileText, FolderOpen, Info, Network, Shield, WandSparkles } from "lucide-react";
import type { InspectorMode, RightPanelTab } from "@/store/useAppStore";
import type { Database, DatabaseProperty } from "@/types/database";
import type { Folder, GraphData, NoteLink, NoteVersion, NoteWithTags, Tag } from "@/types/note";
import type { WorkspaceMember } from "@/types/workspace";
import type { OutlineItem } from "@/lib/markdown";
import { formatRelativeTime } from "@/lib/utils";
import { NoteProperties } from "@/components/editor/NoteProperties";
import { LocalGraph } from "@/components/graph/LocalGraph";
import { BacklinksPanel } from "@/components/graph/BacklinksPanel";
import { AiPanel } from "@/components/ai/AiPanel";
import { Button } from "@/components/ui/button";
import { cn, decodeEscapedUnicode } from "@/lib/utils";

interface RightPanelProps {
  note: NoteWithTags | null;
  folders: Folder[];
  allTags: Tag[];
  databases?: Database[];
  databaseProperties?: DatabaseProperty[];
  workspaceMembers?: WorkspaceMember[];
  versions: NoteVersion[];
  outline: OutlineItem[];
  graph: GraphData;
  links: NoteLink[];
  backlinks: NoteLink[];
  activeTab: RightPanelTab;
  inspectorMode: InspectorMode;
  charCount: number;
  wordCount: number;
  readMinutes: number;
  tagName: string;
  tagLoading: boolean;
  onTabChange: (tab: RightPanelTab) => void;
  onInspectorModeChange: (mode: InspectorMode) => void;
  onAssignFolder: (folderId: string | null) => void;
  onAssignDatabase?: (databaseId: string | null) => void;
  onToggleTag: (tagId: string) => void;
  onTagNameChange: (value: string) => void;
  onCreateTag: () => void;
  onUpdateDatabaseValue?: (payload: {
    property_id: string;
    value_text?: string | null;
    value_number?: number | null;
    value_boolean?: boolean | null;
    value_date?: string | null;
    value_json?: string[] | null;
  }) => void;
  onRestoreVersion: (versionId: string) => void;
  onOpenNode: (id: string) => void;
  onOpenWikiTarget: (target: string, isId?: boolean) => void;
  onOpenSettings: () => void;
  onInsertSnippet: (snippet: string) => void;
}

const tabs = [
  { key: "outline" as const, label: "大纲", icon: FileText },
  { key: "links" as const, label: "双链", icon: Network },
  { key: "info" as const, label: "信息", icon: Info },
];

const quickBlocks = [
  { label: "标题 1", insert: "# " },
  { label: "标题 2", insert: "## " },
  { label: "项目列表", insert: "- " },
  { label: "任务列表", insert: "- [ ] " },
  { label: "代码块", insert: "```ts\n\n```" },
  { label: "引用块", insert: "> " },
  { label: "分隔线", insert: "\n---\n" },
];

export function RightPanel(props: RightPanelProps) {
  const {
    note,
    folders,
    allTags,
    databases = [],
    databaseProperties = [],
    workspaceMembers = [],
    versions,
    outline,
    graph,
    links,
    backlinks,
    activeTab,
    inspectorMode,
    charCount,
    wordCount,
    readMinutes,
    tagName,
    tagLoading,
    onTabChange,
    onInspectorModeChange,
    onAssignFolder,
    onAssignDatabase,
    onToggleTag,
    onTagNameChange,
    onCreateTag,
    onUpdateDatabaseValue,
    onRestoreVersion,
    onOpenNode,
    onOpenWikiTarget,
    onOpenSettings,
    onInsertSnippet,
  } = props;

  return (
    <aside className="flex h-full flex-col" style={{ background: "var(--surface-panel)" }}>
      <div className="flex h-[52px] items-center justify-center border-b px-4" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="rounded-[10px] bg-black/[0.05] p-0.5 dark:bg-white/[0.05]">
          <button
            type="button"
            className={cn(
              "rounded-[8px] px-4 py-1.5 text-[12px] font-medium transition-colors",
              inspectorMode === "format" ? "bg-white text-foreground shadow-sm dark:bg-white/[0.12]" : "text-muted-foreground",
            )}
            onClick={() => onInspectorModeChange("format")}
          >
            格式
          </button>
          <button
            type="button"
            className={cn(
              "rounded-[8px] px-4 py-1.5 text-[12px] font-medium transition-colors",
              inspectorMode === "infoMedia" ? "bg-white text-foreground shadow-sm dark:bg-white/[0.12]" : "text-muted-foreground",
            )}
            onClick={() => onInspectorModeChange("infoMedia")}
          >
            信息与媒体
          </button>
        </div>
      </div>

      {!note ? <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">选择一篇笔记查看详情。</div> : null}

      {note ? (
        <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto p-4">
          {inspectorMode === "format" ? (
            <div className="space-y-5">
              <section>
                <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-foreground/75">
                  <FileText className="h-4 w-4" />
                  文档结构
                </div>
                <div className="rounded-[14px] border border-border/70 bg-white/62 p-2 shadow-xs dark:bg-white/[0.04]">
                  <div className="space-y-1">
                    {outline.map((item) => (
                      <a
                        key={`${item.id}-${item.text}`}
                        href={`#${item.id}`}
                        className={cn(
                          "block rounded-[10px] px-2 py-1.5 text-sm transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.04]",
                          item.level === 2 && "pl-4",
                          item.level === 3 && "pl-6 text-xs",
                        )}
                      >
                        {item.text}
                      </a>
                    ))}
                    {outline.length === 0 ? <p className="px-2 py-2 text-xs text-muted-foreground">添加 Markdown 标题后会自动生成目录。</p> : null}
                  </div>
                </div>
              </section>

              <section>
                <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-foreground/75">
                  <WandSparkles className="h-4 w-4" />
                  快捷插入
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {quickBlocks.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className="rounded-[12px] border border-border/70 bg-white/55 px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-black/[0.04] dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
                      onClick={() => onInsertSnippet(item.insert)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>

              <AiPanel onOpenSettings={onOpenSettings} />
            </div>
          ) : null}

          {inspectorMode === "infoMedia" ? (
            <div className="space-y-5">
              <section className="rounded-[14px] border border-border/70 bg-white/72 p-3 shadow-xs dark:bg-white/[0.04]">
                <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-foreground/75">
                  <Shield className="h-4 w-4" />
                  文档状态
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-[12px] px-2 py-2 hover:bg-black/[0.035] dark:hover:bg-white/[0.04]">
                    <div className="flex items-center gap-2 text-sm">
                      <FolderOpen className="h-4 w-4 text-[#ff9500]" />
                      当前文件夹
                    </div>
                    <span className="text-xs text-muted-foreground">{decodeEscapedUnicode(note.folder?.name ?? "Inbox")}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-[12px] px-2 py-2 hover:bg-black/[0.035] dark:hover:bg-white/[0.04]">
                    <div className="flex items-center gap-2 text-sm">
                      <Clock4 className="h-4 w-4 text-[#007aff]" />
                      最后更新
                    </div>
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(note.updated_at)}</span>
                  </div>
                </div>
              </section>

              <section className="rounded-[14px] border border-border/70 bg-white/72 p-3 shadow-xs dark:bg-white/[0.04]">
                <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-foreground/75">
                  <Info className="h-4 w-4" />
                  页面信息
                </div>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">字符数</dt>
                    <dd className="font-mono text-xs">{charCount}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">词数</dt>
                    <dd className="font-mono text-xs">{wordCount}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">阅读时间</dt>
                    <dd className="text-xs">约 {readMinutes} 分钟</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">标签数量</dt>
                    <dd className="text-xs">{note.tags.length}</dd>
                  </div>
                </dl>
              </section>

              <NoteProperties
                note={note}
                folders={folders}
                allTags={allTags}
                databases={databases}
                databaseProperties={databaseProperties}
                workspaceMembers={workspaceMembers}
                tagName={tagName}
                tagLoading={tagLoading}
                onTagNameChange={onTagNameChange}
                onAssignFolder={onAssignFolder}
                onAssignDatabase={onAssignDatabase}
                onToggleTag={onToggleTag}
                onCreateTag={onCreateTag}
                onUpdateDatabaseValue={onUpdateDatabaseValue}
              />

              <section>
                <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-foreground/75">
                  <Network className="h-4 w-4" />
                  图谱与链接
                </div>
                <div className="mb-3 rounded-[14px] border border-border/70 bg-white/72 p-3 shadow-xs dark:bg-white/[0.04]">
                  <div className="mb-3 flex gap-1 rounded-[10px] bg-black/[0.05] p-1 dark:bg-white/[0.05]">
                    {tabs.map((tab) => {
                      const Icon = tab.icon;
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          className={cn(
                            "flex flex-1 items-center justify-center gap-1 rounded-[8px] px-2 py-1.5 text-[12px] font-medium transition-colors",
                            activeTab === tab.key ? "bg-white text-foreground shadow-sm dark:bg-white/[0.12]" : "text-muted-foreground",
                          )}
                          onClick={() => onTabChange(tab.key)}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                  {activeTab === "outline" ? (
                    <div className="space-y-1">
                      {outline.map((item) => (
                        <a
                          key={`${item.id}-${item.text}`}
                          href={`#${item.id}`}
                          className={cn(
                            "block rounded-[10px] px-2 py-1.5 text-sm transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]",
                            item.level === 2 && "pl-4",
                            item.level === 3 && "pl-6 text-xs",
                          )}
                        >
                          {item.text}
                        </a>
                      ))}
                      {outline.length === 0 ? <p className="px-2 py-2 text-xs text-muted-foreground">这篇笔记还没有标题层级。</p> : null}
                    </div>
                  ) : null}
                  {activeTab === "links" ? <BacklinksPanel links={links} backlinks={backlinks} onOpenLink={onOpenWikiTarget} /> : null}
                  {activeTab === "info" ? (
                    <div className="space-y-3">
                      <LocalGraph graph={graph} currentNoteId={note.id} onSelectNode={onOpenNode} />
                      <div className="space-y-2">
                        {versions.slice(0, 3).map((version) => (
                          <div key={version.id} className="rounded-[12px] border border-border/70 bg-white/55 p-2 dark:bg-white/[0.04]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-medium">{version.title || "无标题笔记"}</span>
                              <Button size="sm" variant="outline" className="rounded-[10px]" onClick={() => onRestoreVersion(version.id)}>
                                恢复
                              </Button>
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground">{formatRelativeTime(version.created_at)}</p>
                          </div>
                        ))}
                        {versions.length === 0 ? <p className="text-xs text-muted-foreground">暂无历史版本。</p> : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="border-t pt-4" style={{ borderColor: "var(--border-subtle)" }}>
                <AiPanel onOpenSettings={onOpenSettings} />
              </section>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
