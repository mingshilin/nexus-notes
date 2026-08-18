import { WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AiPanelProps {
  onOpenSettings: () => void;
}

export function AiPanel({ onOpenSettings }: AiPanelProps) {
  return (
    <div className="rounded-[16px] border border-dashed border-border bg-white/55 p-5 text-center dark:bg-white/[0.04]">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[14px] border border-primary/15 bg-primary/[0.08] text-primary">
        <WandSparkles className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold">AI 助手暂未配置</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        当前还没有接入 AI 服务。这里不会显示假回复，也不会展示不可用的模型切换。
      </p>
      <Button variant="outline" size="sm" className="mt-4 rounded-[12px]" onClick={onOpenSettings}>
        打开设置
      </Button>
    </div>
  );
}
