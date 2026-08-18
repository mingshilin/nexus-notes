import { Keyboard } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const shortcuts = [
  ["Ctrl / Cmd + N", "新建笔记"],
  ["Ctrl / Cmd + S", "保存"],
  ["Ctrl / Cmd + F", "聚焦搜索"],
  ["Ctrl / Cmd + K", "命令面板"],
  ["Esc", "关闭弹窗 / 返回"],
  ["Shift + ?", "快捷键说明"],
];

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mac-glass rounded-[24px]">
        <DialogHeader>
          <div className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-[14px] border border-primary/15 bg-primary/[0.08] text-primary">
            <Keyboard className="h-5 w-5" />
          </div>
          <DialogTitle>快捷键</DialogTitle>
          <DialogDescription>常用操作可以直接通过键盘完成。</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {shortcuts.map(([keys, label]) => (
            <div key={keys} className="flex items-center justify-between rounded-[16px] border border-border/70 bg-white/60 px-3 py-2 dark:bg-white/[0.04]">
              <span className="text-sm text-muted-foreground">{label}</span>
              <kbd className="rounded-md border border-border bg-white/75 px-2 py-1 font-mono text-xs dark:bg-white/[0.06]">{keys}</kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
