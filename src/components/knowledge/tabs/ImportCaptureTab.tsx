import { Check, Clipboard, Import } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, displayText, EmptyLine, formatTime, StatusPill } from "@/components/knowledge/KnowledgeCenterShared";
import { normalizeDisplayIcon } from "@/lib/utils";
import type { Database } from "@/types/database";
import type { ImportJob, OfflineDraft } from "@/types/knowledge";
import type { NoteWithTags } from "@/types/note";

type ClipTarget = "inbox" | "daily" | "database";
type ImportPreviewItem = { title: string; content: string };

interface ImportCaptureTabProps {
  databases: Database[];
  notes: NoteWithTags[];
  readOnly: boolean;
  clipTitle: string;
  clipUrl: string;
  clipContent: string;
  clipTarget: ClipTarget;
  clipDatabaseId: string;
  importText: string;
  importPreview: ImportPreviewItem[];
  importJobs: ImportJob[];
  draftTitle: string;
  draftContent: string;
  draftNoteId: string;
  offlineDrafts: OfflineDraft[];
  noteTitleSet: Set<string>;
  onClipTitleChange: (value: string) => void;
  onClipUrlChange: (value: string) => void;
  onClipContentChange: (value: string) => void;
  onClipTargetChange: (value: ClipTarget) => void;
  onClipDatabaseIdChange: (value: string) => void;
  onImportTextChange: (value: string) => void;
  onDraftTitleChange: (value: string) => void;
  onDraftContentChange: (value: string) => void;
  onDraftNoteIdChange: (value: string) => void;
  onSubmitClip: () => void;
  onSubmitImport: () => void;
  onSubmitDraft: () => void;
  onSyncDraft: (draft: OfflineDraft) => Promise<void>;
  onOpenNote: (id: string) => void;
}

export function ImportCaptureTab({
  databases,
  notes,
  readOnly,
  clipTitle,
  clipUrl,
  clipContent,
  clipTarget,
  clipDatabaseId,
  importText,
  importPreview,
  importJobs,
  draftTitle,
  draftContent,
  draftNoteId,
  offlineDrafts,
  noteTitleSet,
  onClipTitleChange,
  onClipUrlChange,
  onClipContentChange,
  onClipTargetChange,
  onClipDatabaseIdChange,
  onImportTextChange,
  onDraftTitleChange,
  onDraftContentChange,
  onDraftNoteIdChange,
  onSubmitClip,
  onSubmitImport,
  onSubmitDraft,
  onSyncDraft,
  onOpenNote,
}: ImportCaptureTabProps) {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const bookmarkletScript = `javascript:(async()=>{const s=window.getSelection()?.toString()||document.body.innerText.slice(0,4000);const payload={title:document.title,url:location.href,content:s,target:"${clipTarget}",database_id:${clipTarget === "database" ? JSON.stringify(clipDatabaseId || null) : "null"}};const r=await fetch("${baseUrl}/api/clipper/capture",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify(payload)});const j=await r.json();if(!r.ok||!j.success){alert(j?.error?.message||"Nexus Notes capture failed");return;}alert("Captured to Nexus Notes");})();`;
  const targetDescription = clipTarget === "daily"
    ? "捕获后追加到当天每日笔记，并自动打开结果。"
    : clipTarget === "database"
      ? "捕获后创建数据库记录；未选择时使用第一个数据库。"
      : "捕获后进入收集箱，并自动打开结果。";

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card title="Web Clipper" icon={Clipboard}>
        <div className="space-y-2">
          <Input value={clipTitle} onChange={(event) => onClipTitleChange(event.target.value)} placeholder="网页标题" className="rounded-[12px]" />
          <Input value={clipUrl} onChange={(event) => onClipUrlChange(event.target.value)} placeholder="URL" className="rounded-[12px]" />
          <Textarea value={clipContent} onChange={(event) => onClipContentChange(event.target.value)} placeholder="选中文本 / 摘要" className="min-h-28 rounded-[12px]" />
          <div className="grid gap-2 sm:grid-cols-2">
            <select value={clipTarget} onChange={(event) => onClipTargetChange(event.target.value as ClipTarget)} className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm">
              <option value="inbox">收集箱</option>
              <option value="daily">每日笔记</option>
              <option value="database">数据库</option>
            </select>
            {clipTarget === "database" ? (
              <select value={clipDatabaseId} onChange={(event) => onClipDatabaseIdChange(event.target.value)} className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm">
                {databases.map((database) => <option key={database.id} value={database.id}>{normalizeDisplayIcon(database.icon) ? `${normalizeDisplayIcon(database.icon)} ` : ""}{displayText(database.name)}</option>)}
              </select>
            ) : null}
          </div>
          <Button className="rounded-[12px]" disabled={readOnly || (!clipTitle.trim() && !clipUrl.trim() && !clipContent.trim())} onClick={() => void onSubmitClip()}>保存捕获</Button>
          <div className="rounded-[14px] border border-dashed border-border bg-background/70 p-3 text-xs text-muted-foreground">
            <div className="font-semibold text-foreground">书签脚本</div>
            <p className="mt-1">{targetDescription} 将下面脚本保存为浏览器书签，在网页上点击即可捕获当前标题、URL 和选中文本。</p>
            <div className="mt-2 line-clamp-3 break-all rounded-[10px] bg-white/70 p-2 font-mono dark:bg-white/[0.04]">{bookmarkletScript}</div>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 rounded-[10px]"
              onClick={() => {
                void navigator.clipboard?.writeText(bookmarkletScript);
                toast.success("书签脚本已复制");
              }}
            >
              复制书签脚本
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Markdown 导入" icon={Import}>
        <Textarea value={importText} onChange={(event) => onImportTextChange(event.target.value)} placeholder={"粘贴 Markdown；用一行 --- 分隔多篇笔记"} className="min-h-52 rounded-[12px]" />
        <div className="mt-3 rounded-[14px] bg-background/70 p-3">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">导入预览</div>
          <div className="max-h-40 space-y-2 overflow-auto pr-1">
            {importPreview.map((item, index) => {
              const duplicate = noteTitleSet.has(item.title.trim().toLowerCase());
              return (
                <div key={`${item.title}-${index}`} className="rounded-[10px] bg-white/70 px-2 py-1 text-xs dark:bg-white/[0.04]">
                  <span className="font-medium">{item.title}</span>
                  {duplicate ? <span className="ml-2 text-amber-600">重复标题</span> : null}
                </div>
              );
            })}
            {importPreview.length === 0 ? <p className="text-xs text-muted-foreground">输入 Markdown 后会在这里预览标题和重复提示。</p> : null}
          </div>
        </div>
        <Button className="mt-2 rounded-[12px]" disabled={readOnly || importPreview.length === 0} onClick={() => void onSubmitImport()}>导入 {importPreview.length || ""}</Button>
        <div className="mt-3 space-y-2 text-xs text-muted-foreground">
          {importJobs.slice(0, 4).map((job) => <div key={job.id}>导入 {job.imported_count} 篇 · {job.warnings?.length ?? 0} 条提示 · {formatTime(job.created_at)}</div>)}
        </div>
      </Card>

      <Card title="离线草稿" icon={Check}>
        <Input value={draftTitle} onChange={(event) => onDraftTitleChange(event.target.value)} placeholder="草稿标题" className="mb-2 rounded-[12px]" />
        <select value={draftNoteId} onChange={(event) => onDraftNoteIdChange(event.target.value)} className="mb-2 w-full rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm">
          <option value="">同步为新笔记</option>
          {notes.map((note) => <option key={note.id} value={note.id}>覆盖：{displayText(note.title, "无标题")}</option>)}
        </select>
        <Textarea value={draftContent} onChange={(event) => onDraftContentChange(event.target.value)} placeholder="断网时可先写到草稿，恢复后同步。" className="min-h-32 rounded-[12px]" />
        <Button className="mt-2 rounded-[12px]" onClick={() => void onSubmitDraft()} disabled={!draftTitle.trim() && !draftContent.trim()}>保存草稿</Button>
        <div className="mt-3 space-y-2">
          {offlineDrafts.map((draft) => {
            const targetNoteId = draft.conflict_note_id || draft.note_id;
            const statusLabel = draft.status === "synced" ? "已同步" : draft.status === "conflict" ? "同步冲突" : "待同步";
            const statusTone = draft.status === "synced" ? "good" : draft.status === "conflict" ? "bad" : "warn";
            return (
              <div key={draft.id} className="rounded-[14px] bg-background/70 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate font-medium">{draft.title || "未命名草稿"}</div>
                  <StatusPill tone={statusTone}>{statusLabel}</StatusPill>
                </div>
                <div className="text-xs text-muted-foreground">{draft.note_id ? "覆盖已有笔记" : "新笔记"} · {formatTime(draft.updated_at)}</div>
                {draft.status === "conflict" ? (
                  <div className="mt-2 rounded-[10px] border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-200">
                    {draft.conflict_reason || "目标笔记已变化，请打开后手动处理。"}
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {draft.status !== "synced" ? (
                    <Button size="sm" variant="outline" className="rounded-[10px]" disabled={readOnly} onClick={() => void onSyncDraft(draft)}>同步并打开</Button>
                  ) : null}
                  {draft.status === "conflict" && targetNoteId ? (
                    <Button size="sm" variant="secondary" className="rounded-[10px]" onClick={() => onOpenNote(targetNoteId)}>打开目标笔记</Button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {offlineDrafts.length === 0 ? <EmptyLine>暂无离线草稿。</EmptyLine> : null}
        </div>
      </Card>
    </div>
  );
}
