import { CheckCircle2, Circle } from "lucide-react";

interface TaskBlockProps {
  checked: boolean;
  children: React.ReactNode;
  onToggle?: () => void;
}

export function TaskBlock({ checked, children, onToggle }: TaskBlockProps) {
  return (
    <button
      type="button"
      className="my-1 flex w-full items-start gap-3 rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-left transition-colors hover:bg-muted/45"
      onClick={onToggle}
    >
      {checked ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
      ) : (
        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <span className={checked ? "text-muted-foreground line-through" : "text-foreground/90"}>
        {children}
      </span>
    </button>
  );
}
