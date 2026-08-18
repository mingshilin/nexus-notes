import { cn, decodeEscapedUnicode } from "@/lib/utils";
import type { Tag } from "@/types/note";

interface TagChipProps {
  tag: Tag;
  active?: boolean;
  onClick?: () => void;
}

export function TagChip({ tag, active = false, onClick }: TagChipProps) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.();
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all",
        active
          ? "border-primary/35 bg-primary/10 text-primary"
          : "border-border/70 bg-muted/25 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      )}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: tag.color }}
        aria-hidden
      />
      <span>{decodeEscapedUnicode(tag.name)}</span>
    </button>
  );
}
