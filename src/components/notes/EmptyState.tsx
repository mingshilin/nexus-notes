import { FileText, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon = FileText, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 rounded-[18px] border border-dashed border-border/70 bg-white/40 px-8 py-10 text-center dark:bg-white/[0.03]">
      <div className="rounded-[14px] border border-primary/15 bg-primary/[0.08] p-3 text-primary shadow-xs">
        <Icon className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-normal">{title}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {actionLabel && onAction ? (
        <Button variant="secondary" className="rounded-[12px]" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
