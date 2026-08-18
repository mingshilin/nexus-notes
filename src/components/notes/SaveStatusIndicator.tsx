import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { SaveStatus } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";

interface SaveStatusIndicatorProps {
  status: SaveStatus;
  error?: string | null;
  onRetry?: () => void;
}

export function SaveStatusIndicator({ status, error, onRetry }: SaveStatusIndicatorProps) {
  if (status === "idle") return null;

  if (status === "saving") {
    return (
      <div className="state-chip state-chip-saving">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>保存中</span>
      </div>
    );
  }

  if (status === "saved") {
    return (
      <div className="state-chip state-chip-saved">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>已保存</span>
      </div>
    );
  }

  return (
    <div className="state-chip state-chip-failed">
      <AlertCircle className="h-3.5 w-3.5" />
      <span>{error || "保存失败"}</span>
      {onRetry ? (
        <Button type="button" variant="ghost" size="sm" className="h-6 rounded-full px-2 text-xs" onClick={onRetry}>
          重试
        </Button>
      ) : null}
    </div>
  );
}
