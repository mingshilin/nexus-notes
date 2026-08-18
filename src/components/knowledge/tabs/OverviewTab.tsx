import { Activity } from "lucide-react";
import { Card, EmptyLine, formatTime } from "@/components/knowledge/KnowledgeCenterShared";
import type { AttachmentCenterItem, FeedLog, KnowledgeDiagnostic, OfflineDraft } from "@/types/knowledge";

interface OverviewTabProps {
  unreadCount: number;
  dueCount: number;
  diagnostics: KnowledgeDiagnostic | null;
  attachments: AttachmentCenterItem[];
  offlineDrafts: OfflineDraft[];
  activity: FeedLog[];
}

export function OverviewTab({ unreadCount, dueCount, diagnostics, attachments, offlineDrafts, activity }: OverviewTabProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {[
        ["未读通知", unreadCount],
        ["到期提醒", dueCount],
        ["孤立笔记", diagnostics?.orphan_notes.length ?? 0],
        ["未整理笔记", diagnostics?.unorganized_notes.length ?? 0],
        ["附件数量", attachments.length],
        ["待同步草稿", offlineDrafts.filter((item) => item.status === "pending").length],
      ].map(([label, value]) => (
        <div key={String(label)} className="rounded-[22px] border border-border/70 bg-white/72 p-5 dark:bg-white/[0.04]">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
          <div className="mt-2 text-3xl font-semibold">{value}</div>
        </div>
      ))}
      <Card title="最近活动" icon={Activity}>
        <div className="space-y-2">
          {activity.slice(0, 6).map((item) => (
            <div key={item.id} className="rounded-[14px] bg-background/70 px-3 py-2 text-sm">
              <div className="font-medium">{item.action}</div>
              <div className="text-xs text-muted-foreground">{item.entity_type} · {formatTime(item.created_at)}</div>
            </div>
          ))}
          {activity.length === 0 ? <EmptyLine>还没有活动记录。</EmptyLine> : null}
        </div>
      </Card>
    </div>
  );
}
