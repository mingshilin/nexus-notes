import { FolderPlus, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface FolderDialogProps {
  open: boolean;
  mode: "create" | "rename";
  value: string;
  loading?: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
}

export function FolderDialog({
  open,
  mode,
  value,
  loading = false,
  error = null,
  onOpenChange,
  onValueChange,
  onSubmit,
}: FolderDialogProps) {
  const isRename = mode === "rename";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mac-glass rounded-[24px]">
        <DialogHeader>
          <div className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-[14px] border border-primary/15 bg-primary/[0.08] text-primary">
            {isRename ? <PencilLine className="h-5 w-5" /> : <FolderPlus className="h-5 w-5" />}
          </div>
          <DialogTitle>{isRename ? "重命名文件夹" : "新建文件夹"}</DialogTitle>
          <DialogDescription>{isRename ? "更新当前文件夹名称。" : "创建一个新的文件夹来组织笔记。"}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Input
            autoFocus
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder="输入文件夹名称"
            className="h-11 rounded-[14px]"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-[12px]" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button className="rounded-[12px]" disabled={loading} onClick={onSubmit}>
            {isRename ? "保存名称" : "创建文件夹"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
