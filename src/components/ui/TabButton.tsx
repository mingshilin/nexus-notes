import { Diamond, X } from "lucide-react";
import { cn, decodeEscapedUnicode } from "@/lib/utils";

interface TabButtonProps {
  title: string;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}

export function TabButton({ title, active, onSelect, onClose }: TabButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "group flex h-9 min-w-[180px] max-w-[260px] items-center gap-2 rounded-t-[16px] border border-b-0 px-4 text-left text-sm font-medium transition-all",
        active
          ? "bg-white/82 text-foreground shadow-[0_-2px_12px_rgba(15,23,42,0.05)] dark:bg-white/[0.09]"
          : "border-transparent text-muted-foreground hover:bg-white/35 hover:text-foreground dark:hover:bg-white/[0.04]",
      )}
      style={active ? { borderColor: "var(--border-subtle)" } : undefined}
      onClick={onSelect}
    >
      <Diamond className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{decodeEscapedUnicode(title) || "无标题笔记"}</span>
      <span
        role="button"
        tabIndex={-1}
        className="rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-black/5 hover:text-foreground group-hover:opacity-100 dark:hover:bg-white/[0.06]"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <X className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}
