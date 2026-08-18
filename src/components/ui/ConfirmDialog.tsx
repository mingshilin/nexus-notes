import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  destructive = false,
  loading = false,
  onOpenChange,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (loading && !nextOpen) return;
      onOpenChange(nextOpen);
    }}>
      <DialogContent className="mac-glass rounded-[24px]">
        <DialogHeader>
          <div
            className={
              destructive
                ? "mb-2 inline-flex h-11 w-11 items-center justify-center rounded-[14px] border border-destructive/20 bg-destructive/10 text-destructive"
                : "mb-2 inline-flex h-11 w-11 items-center justify-center rounded-[14px] border border-primary/15 bg-primary/[0.08] text-primary"
            }
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="rounded-[12px]" disabled={loading} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "destructive" : "default"} className="rounded-[12px]" disabled={loading} onClick={onConfirm}>
            {loading ? "处理中..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
