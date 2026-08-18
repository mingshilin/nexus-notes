import { MessageSquare } from "lucide-react";

export function InlineComment() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      <MessageSquare className="h-3 w-3" />
      评论功能即将支持
    </span>
  );
}
