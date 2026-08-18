import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Quote,
  SquareCheck,
  Text,
  WandSparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  insert: string;
  icon: typeof Text;
  disabled?: boolean;
}

export const slashCommands: SlashCommand[] = [
  { id: "text", label: "Text", description: "普通段落文本", insert: "", icon: Text },
  { id: "h1", label: "Heading 1", description: "一级标题", insert: "# ", icon: Heading1 },
  { id: "h2", label: "Heading 2", description: "二级标题", insert: "## ", icon: Heading2 },
  { id: "h3", label: "Heading 3", description: "三级标题", insert: "### ", icon: Heading3 },
  { id: "bullet", label: "Bullet List", description: "无序列表", insert: "- ", icon: List },
  { id: "number", label: "Numbered List", description: "有序列表", insert: "1. ", icon: ListOrdered },
  { id: "todo", label: "Todo List", description: "任务列表", insert: "- [ ] ", icon: SquareCheck },
  { id: "reminder", label: "Reminder", description: "提醒占位", insert: "> [!reminder]\n> ", icon: SquareCheck },
  { id: "template", label: "Meeting Template", description: "会议记录模板", insert: "## 背景\n\n## 讨论\n\n## 决议\n\n## 待办\n- [ ] ", icon: WandSparkles },
  { id: "quote", label: "Quote", description: "引用块", insert: "> ", icon: Quote },
  { id: "code", label: "Code Block", description: "代码块", insert: "```ts\n\n```", icon: Code2 },
  { id: "callout", label: "Callout", description: "提示块", insert: "> 💡 ", icon: WandSparkles },
  { id: "divider", label: "Divider", description: "分隔线", insert: "---", icon: Minus },
  { id: "ai", label: "AI assistant", description: "AI 功能未配置", insert: "", icon: WandSparkles, disabled: true },
];

interface SlashCommandMenuProps {
  open: boolean;
  query: string;
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (command: SlashCommand) => void;
}

export function SlashCommandMenu({ open, query, activeIndex, onHover, onSelect }: SlashCommandMenuProps) {
  if (!open) return null;
  const q = query.trim().toLowerCase();
  const items = slashCommands.filter((item) => !q || item.label.toLowerCase().includes(q));

  return (
    <div className="mac-glass fixed inset-x-4 bottom-[calc(2.75rem+env(safe-area-inset-bottom))] z-50 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[18px] p-1 shadow-lg md:absolute md:bottom-auto md:left-10 md:right-auto md:top-32 md:w-[320px]">
      <div className="border-b px-3 py-2 text-[11px] font-semibold text-muted-foreground" style={{ borderColor: "var(--border-subtle)" }}>
        基础块
      </div>
      <div className="max-h-[36vh] overflow-y-auto p-1 md:max-h-80">
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              className={cn(
                "flex w-full items-center gap-3 rounded-[12px] px-2 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                activeIndex === index ? "bg-[#007aff]/8 dark:bg-[#409cff]/12" : "hover:bg-black/[0.04] dark:hover:bg-white/[0.04]",
              )}
              onMouseEnter={() => onHover(index)}
              onClick={() => onSelect(item)}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-border bg-white/70 shadow-xs dark:bg-white/[0.06]">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
