import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DeleteConfirmDialogProps {
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  permanent?: boolean;
  loading?: boolean;
}

export function DeleteConfirmDialog({
  open,
  title,
  onOpenChange,
  onConfirm,
  permanent = false,
  loading = false,
}: DeleteConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (loading && !nextOpen) return;
      onOpenChange(nextOpen);
    }}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <DialogTitle>
            {permanent
              ? "确认永久删除"
              : "确认删除笔记"}
          </DialogTitle>
          <DialogDescription>
            {permanent
              ? `笔记《${title || "无标题"}》将被永久删除，不可恢复。`
              : `笔记《${title || "无标题"}》将移入回收站。`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="rounded-lg" disabled={loading} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" className="rounded-lg" disabled={loading} onClick={onConfirm}>
            {loading ? "删除中..." : permanent ? "永久删除" : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
