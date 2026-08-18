import type { GraphData } from "@/types/note";
import { cn, decodeEscapedUnicode } from "@/lib/utils";

interface LocalGraphProps {
  graph: GraphData;
  currentNoteId?: string | null;
  onSelectNode?: (id: string) => void;
}

export function LocalGraph({ graph, currentNoteId, onSelectNode }: LocalGraphProps) {
  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-[12px] border border-dashed border-border bg-white/50 text-xs text-muted-foreground dark:bg-white/[0.03]">
        暂无双链关系
      </div>
    );
  }

  const centerX = 50;
  const centerY = 50;
  const radius = 34;
  const positions = new Map<string, { x: number; y: number }>();

  graph.nodes.forEach((node, index) => {
    if (node.id === currentNoteId || node.is_current) {
      positions.set(node.id, { x: centerX, y: centerY });
      return;
    }
    const angle = (Math.PI * 2 * index) / Math.max(graph.nodes.length - 1, 1);
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });

  return (
    <div className="relative h-36 overflow-hidden rounded-[14px] border border-border bg-white/60 shadow-inner dark:bg-white/[0.03]">
      <svg className="absolute inset-0 h-full w-full text-border" viewBox="0 0 100 100">
        {graph.edges.map((edge, index) => {
          const source = positions.get(edge.source);
          const target = positions.get(edge.target);
          if (!source || !target) return null;
          return <line key={`${edge.source}-${edge.target}-${index}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="currentColor" strokeWidth="0.8" />;
        })}
      </svg>
      {graph.nodes.map((node) => {
        const pos = positions.get(node.id) ?? { x: centerX, y: centerY };
        const current = node.id === currentNoteId || node.is_current;
        return (
          <button
            key={node.id}
            type="button"
            className={cn(
              "absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-md ring-4 transition-transform hover:scale-125",
              current
                ? "bg-[#1c1c1e] ring-[#c9dafd] dark:bg-white dark:ring-[#409cff]/20"
                : "bg-[#007aff] ring-[#dce7ff] dark:ring-[#409cff]/10",
            )}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            title={decodeEscapedUnicode(node.title)}
            onClick={() => onSelectNode?.(node.id)}
          />
        );
      })}
    </div>
  );
}

