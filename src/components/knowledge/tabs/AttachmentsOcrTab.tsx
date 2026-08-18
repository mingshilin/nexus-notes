import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, displayText, EmptyLine, StatusPill } from "@/components/knowledge/KnowledgeCenterShared";
import type { AttachmentCenterItem } from "@/types/knowledge";
import type { NoteWithTags } from "@/types/note";

interface AttachmentsOcrTabProps {
  attachments: AttachmentCenterItem[];
  notes: NoteWithTags[];
  readOnly: boolean;
  attachmentQuery: string;
  attachmentType: string;
  attachmentStatus: string;
  attachmentNoteId: string;
  attachmentFrom: string;
  attachmentTo: string;
  ocrBusyId: string | null;
  ocrBatchBusy: boolean;
  ocrProgress: string;
  deletingAttachmentId: string | null;
  onAttachmentQueryChange: (value: string) => void;
  onAttachmentTypeChange: (value: string) => void;
  onAttachmentStatusChange: (value: string) => void;
  onAttachmentNoteIdChange: (value: string) => void;
  onAttachmentFromChange: (value: string) => void;
  onAttachmentToChange: (value: string) => void;
  onRefreshAttachments: () => Promise<void>;
  onOpenNote: (id: string) => void;
  onRecognizeAttachment: (item: AttachmentCenterItem) => Promise<void>;
  onRetryFailedAttachments: () => Promise<void>;
  onDeleteAttachment: (item: AttachmentCenterItem) => void;
}

export function AttachmentsOcrTab({
  attachments,
  notes,
  readOnly,
  attachmentQuery,
  attachmentType,
  attachmentStatus,
  attachmentNoteId,
  attachmentFrom,
  attachmentTo,
  ocrBusyId,
  ocrBatchBusy,
  ocrProgress,
  deletingAttachmentId,
  onAttachmentQueryChange,
  onAttachmentTypeChange,
  onAttachmentStatusChange,
  onAttachmentNoteIdChange,
  onAttachmentFromChange,
  onAttachmentToChange,
  onRefreshAttachments,
  onOpenNote,
  onRecognizeAttachment,
  onRetryFailedAttachments,
  onDeleteAttachment,
}: AttachmentsOcrTabProps) {
  const failedCount = attachments.filter((item) => item.ocr_status === "failed").length;
  return (
    <Card
      title="附件中心与 OCR"
      icon={Paperclip}
      actions={failedCount > 0 ? (
        <Button size="sm" variant="outline" className="rounded-[10px]" disabled={readOnly || ocrBatchBusy} onClick={() => void onRetryFailedAttachments()}>
          {ocrBatchBusy ? "批量重试中" : `批量重试失败项 ${failedCount}`}
        </Button>
      ) : null}
    >
      <div className="mb-3 grid gap-2 md:grid-cols-2 xl:grid-cols-[1fr_130px_140px_170px_140px_140px_auto]">
        <Input value={attachmentQuery} onChange={(event) => onAttachmentQueryChange(event.target.value)} placeholder="按文件名、OCR、笔记标题搜索" className="rounded-[12px]" />
        <select value={attachmentType} onChange={(event) => onAttachmentTypeChange(event.target.value)} className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm">
          <option value="all">全部类型</option>
          <option value="image">图片</option>
          <option value="pdf">PDF</option>
          <option value="other">其他</option>
        </select>
        <select value={attachmentStatus} onChange={(event) => onAttachmentStatusChange(event.target.value)} className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm">
          <option value="all">全部状态</option>
          <option value="pending">待识别</option>
          <option value="processing">识别中</option>
          <option value="ready">已完成</option>
          <option value="failed">失败</option>
          <option value="unsupported">不支持</option>
        </select>
        <select value={attachmentNoteId} onChange={(event) => onAttachmentNoteIdChange(event.target.value)} className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm">
          <option value="">全部笔记</option>
          {notes.map((note) => <option key={note.id} value={note.id}>{displayText(note.title, "无标题")}</option>)}
        </select>
        <Input type="date" value={attachmentFrom} onChange={(event) => onAttachmentFromChange(event.target.value)} aria-label="附件起始日期" className="rounded-[12px]" />
        <Input type="date" value={attachmentTo} onChange={(event) => onAttachmentToChange(event.target.value)} aria-label="附件结束日期" className="rounded-[12px]" />
        <Button variant="outline" className="rounded-[12px]" onClick={() => void onRefreshAttachments()}>筛选</Button>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {attachments.map((item) => (
          <div key={item.id} className="rounded-[16px] border border-border/70 bg-background/70 p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{item.file_name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{displayText(item.note_title, item.note_id)} · {item.mime_type} · {Math.ceil(item.size / 1024)} KB</div>
              </div>
              <StatusPill tone={item.ocr_status === "ready" ? "good" : item.ocr_status === "failed" ? "bad" : item.ocr_status === "processing" ? "info" : "muted"}>{item.ocr_status ?? "pending"}</StatusPill>
            </div>
            <div className="mt-2 line-clamp-4 rounded-[10px] bg-white/60 p-2 text-xs text-muted-foreground dark:bg-white/[0.04]">{item.ocr_text || "暂无 OCR 文本"}</div>
            {item.ocr_status === "failed" ? (
              <div className="mt-2 rounded-[10px] border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-300">
                失败原因：{item.ocr_text || "未知错误"}
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="rounded-[10px]" onClick={() => onOpenNote(item.note_id)}>打开笔记</Button>
              <Button size="sm" variant="outline" className="rounded-[10px]" onClick={() => window.open(`/api/attachments/${item.id}/file`, "_blank", "noopener,noreferrer")}>打开文件</Button>
              <Button size="sm" className="rounded-[10px]" disabled={readOnly || ocrBusyId === item.id || item.ocr_status === "unsupported"} onClick={() => void onRecognizeAttachment(item)}>
                {ocrBusyId === item.id ? "识别中" : item.ocr_status === "failed" ? "重试 OCR" : "识别 OCR"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="rounded-[10px]"
                disabled={readOnly || deletingAttachmentId === item.id}
                onClick={() => onDeleteAttachment(item)}
              >
                {deletingAttachmentId === item.id ? "删除中" : "删除"}
              </Button>
            </div>
            {ocrBusyId === item.id && ocrProgress ? <div className="mt-2 text-xs text-primary">{ocrProgress}</div> : null}
          </div>
        ))}
        {attachments.length === 0 ? <EmptyLine>暂无附件或没有匹配结果。</EmptyLine> : null}
      </div>
    </Card>
  );
}
