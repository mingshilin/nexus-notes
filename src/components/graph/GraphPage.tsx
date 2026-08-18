import { Network } from "lucide-react";
import type { GraphData } from "@/types/note";
import { LocalGraph } from "./LocalGraph";

interface GraphPageProps {
  graph: GraphData;
  selectedNoteId: string | null;
  onSelectNode: (id: string) => void;
}

export function GraphPage({ graph, selectedNoteId, onSelectNode }: GraphPageProps) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-8">
      <div className="w-full max-w-5xl rounded-[24px] border border-border/70 bg-white/72 p-6 shadow-sm dark:bg-white/[0.04]">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-primary/15 bg-primary/[0.08] text-primary">
            <Network className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">知识图谱</h1>
            <p className="text-sm text-muted-foreground">基于 `[[双链]]` 自动生成当前工作区的关联关系。</p>
          </div>
        </div>
        <div className="rounded-[20px] border border-border/70 bg-gradient-to-br from-white/60 to-slate-100/80 p-6 dark:from-white/[0.03] dark:to-white/[0.01]">
          <LocalGraph graph={graph} currentNoteId={selectedNoteId} onSelectNode={onSelectNode} />
          {graph.nodes.length === 0 ? (
            <p className="mt-4 text-center text-sm text-muted-foreground">在笔记里输入 `[[笔记标题]]` 来建立知识连接。</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
