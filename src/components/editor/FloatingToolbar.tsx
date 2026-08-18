import { Code2, Heading1, Heading2, List, Quote, SquareCheck, WandSparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface FloatingToolbarProps {
  visible: boolean;
  onInsert: (value: string) => void;
}

const actions = [
  { id: "h1", label: "H1", icon: Heading1, insert: "# " },
  { id: "h2", label: "H2", icon: Heading2, insert: "## " },
  { id: "list", label: "List", icon: List, insert: "- " },
  { id: "todo", label: "Todo", icon: SquareCheck, insert: "- [ ] " },
  { id: "quote", label: "Quote", icon: Quote, insert: "> " },
  { id: "code", label: "Code", icon: Code2, insert: "```ts\n\n```" },
];

export function FloatingToolbar({ visible, onInsert }: FloatingToolbarProps) {
  if (!visible) return null;

  return (
    <div className="hidden justify-center pb-4 xl:flex">
      <div
        className="animate-siri-glow rounded-[14px] bg-[length:200%_auto] p-px"
        style={{ backgroundImage: "linear-gradient(90deg,#00c6ff,#0072ff,#ff00e4,#ff8c00,#00c6ff)" }}
      >
        <div className="flex h-10 items-center gap-1 rounded-[13px] bg-[var(--surface-overlay)] px-1.5 shadow-md backdrop-blur-xl">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-black/[0.04] text-[#6d28d9] dark:bg-white/[0.05]">
            <WandSparkles className="h-4 w-4" />
          </span>
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-xs font-medium text-foreground/80 transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.05]",
                )}
                onClick={() => onInsert(action.insert)}
              >
                <Icon className="h-3.5 w-3.5" />
                {action.label}
              </button>
            );
          })}
          <button
            type="button"
            disabled
            className="flex h-8 items-center rounded-[8px] px-3 text-xs font-medium text-muted-foreground opacity-60"
            title="AI 功能未配置"
          >
            AI
          </button>
        </div>
      </div>
    </div>
  );
}

