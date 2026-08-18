import { Plus } from "lucide-react";
import type { NoteWithTags } from "@/types/note";
import { BRAND_NAME } from "@/lib/brand";
import { TabButton } from "@/components/ui/TabButton";

interface TopTabsProps {
  tabs: string[];
  notesById: Map<string, NoteWithTags>;
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
}

const buildVersion = import.meta.env.VITE_BUILD_VERSION || import.meta.env.VITE_APP_VERSION || "dev";

export function TopTabs({ tabs, notesById, activeId, onSelect, onClose, onCreate }: TopTabsProps) {
  return (
    <header className="glass-toolbar flex h-12 shrink-0 items-end gap-2 border-b px-3" style={{ borderColor: "var(--border-subtle)" }}>
      <div className="hidden items-center gap-2 px-1 pb-3 lg:flex">
        <span className="mac-traffic-light bg-[#ff5f57]" />
        <span className="mac-traffic-light bg-[#febc2e]" />
        <span className="mac-traffic-light bg-[#28c840]" />
      </div>
      <div className="scrollbar-subtle flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
        {tabs.map((id) => (
          <TabButton
            key={id}
            title={notesById.get(id)?.title ?? `${BRAND_NAME} 加载中...`}
            active={activeId === id}
            onSelect={() => onSelect(id)}
            onClose={() => onClose(id)}
          />
        ))}
      </div>
      <span className="mb-1.5 hidden shrink-0 rounded-md border border-border/60 px-2 py-1 text-[10px] text-muted-foreground md:inline-block">
        v{buildVersion}
      </span>
      <button
        type="button"
        className="mb-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/45 hover:text-foreground"
        onClick={onCreate}
        aria-label="新建笔记"
      >
        <Plus className="h-4 w-4" />
      </button>
    </header>
  );
}

