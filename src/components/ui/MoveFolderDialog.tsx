import { FolderOpen } from "lucide-react";
import type { Folder } from "@/types/note";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, decodeEscapedUnicode } from "@/lib/utils";

interface MoveFolderDialogProps {
  open: boolean;
  folders: Folder[];
  selectedFolderId: string | null;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectFolder: (folderId: string | null) => void;
  onConfirm: () => void;
}

export function MoveFolderDialog({
  open,
  folders,
  selectedFolderId,
  loading = false,
  onOpenChange,
  onSelectFolder,
  onConfirm,
}: MoveFolderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mac-glass max-w-lg rounded-[24px]">
        <DialogHeader>
          <div className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-[14px] border border-primary/15 bg-primary/[0.08] text-primary">
            <FolderOpen className="h-5 w-5" />
          </div>
          <DialogTitle>移动到文件夹</DialogTitle>
          <DialogDescription>选择当前笔记要归属的文件夹。</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[320px] pr-1">
          <div className="space-y-2">
            <button
              type="button"
              className={cn(
                "w-full rounded-[16px] border px-3 py-3 text-left text-sm transition-colors",
                selectedFolderId === null ? "border-primary/30 bg-primary/[0.08]" : "border-border/60 bg-white/70 hover:bg-white/90 dark:bg-white/[0.04]",
              )}
              onClick={() => onSelectFolder(null)}
            >
              Inbox / 未分组
            </button>
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className={cn(
                  "w-full rounded-[16px] border px-3 py-3 text-left text-sm transition-colors",
                  selectedFolderId === folder.id ? "border-primary/30 bg-primary/[0.08]" : "border-border/60 bg-white/70 hover:bg-white/90 dark:bg-white/[0.04]",
                )}
                onClick={() => onSelectFolder(folder.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{decodeEscapedUnicode(folder.name)}</span>
                  <span className="text-xs text-muted-foreground">{folder.note_count ?? 0}</span>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" className="rounded-[12px]" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button className="rounded-[12px]" disabled={loading} onClick={onConfirm}>
            确认移动
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
