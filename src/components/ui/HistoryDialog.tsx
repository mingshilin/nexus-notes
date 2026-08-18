import { Clock4 } from "lucide-react";
import type { NoteVersion } from "@/types/note";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatRelativeTime } from "@/lib/utils";

interface HistoryDialogProps {
  open: boolean;
  versions: NoteVersion[];
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (versionId: string) => void;
}

export function HistoryDialog({ open, versions, loading = false, onOpenChange, onRestore }: HistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mac-glass max-w-2xl rounded-[24px]">
        <DialogHeader>
          <div className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-[14px] border border-primary/15 bg-primary/[0.08] text-primary">
            <Clock4 className="h-5 w-5" />
          </div>
          <DialogTitle>历史版本</DialogTitle>
          <DialogDescription>选择一个历史版本进行查看或恢复。</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[420px] pr-1">
          <div className="space-y-3">
            {versions.map((version) => (
              <div key={version.id} className="rounded-[16px] border border-border/70 bg-white/70 p-4 dark:bg-white/[0.04]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{version.title || "无标题笔记"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatRelativeTime(version.created_at)}</p>
                  </div>
                  <Button size="sm" variant="outline" className="rounded-[12px]" disabled={loading} onClick={() => onRestore(version.id)}>
                    恢复
                  </Button>
                </div>
                <pre className="mt-3 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
                  {version.content.slice(0, 420) || "此版本没有正文内容。"}
                </pre>
              </div>
            ))}
            {versions.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
                暂无历史版本
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
