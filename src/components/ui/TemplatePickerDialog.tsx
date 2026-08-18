import { FileText, NotebookPen } from "lucide-react";
import type { NoteTemplate } from "@/lib/noteTemplates";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface TemplatePickerDialogProps {
  open: boolean;
  mode: "create" | "apply";
  templates: NoteTemplate[];
  activeTemplateId: string | null;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectTemplate: (templateId: string) => void;
  onConfirm: () => void;
}

export function TemplatePickerDialog({
  open,
  mode,
  templates,
  activeTemplateId,
  loading = false,
  onOpenChange,
  onSelectTemplate,
  onConfirm,
}: TemplatePickerDialogProps) {
  const activeTemplate = templates.find((template) => template.id === activeTemplateId) ?? templates[0] ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mac-glass max-w-4xl gap-0 overflow-hidden rounded-[24px] p-0">
        <div className="grid max-h-[78vh] min-h-[520px] md:grid-cols-[280px_1fr]">
          <div className="border-r p-4" style={{ borderColor: "var(--border-subtle)", background: "var(--surface-sidebar)" }}>
            <DialogHeader className="mb-4">
              <div className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-[14px] border border-primary/15 bg-primary/[0.08] text-primary">
                <NotebookPen className="h-5 w-5" />
              </div>
              <DialogTitle>{mode === "create" ? "从模板创建笔记" : "应用模板到当前笔记"}</DialogTitle>
              <DialogDescription>{mode === "create" ? "选择一个模板作为起点。" : "将模板内容覆盖到当前笔记。"}</DialogDescription>
            </DialogHeader>
            <ScrollArea className="h-[360px] pr-2">
              <div className="space-y-2">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={cn(
                      "w-full rounded-[16px] border px-3 py-3 text-left transition-colors",
                      activeTemplate?.id === template.id ? "border-primary/30 bg-primary/[0.08]" : "border-border/60 bg-white/70 hover:bg-white/90 dark:bg-white/[0.04]",
                    )}
                    onClick={() => onSelectTemplate(template.id)}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{template.name}</span>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">{template.description}</p>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          <div className="flex min-h-0 flex-col" style={{ background: "var(--surface-elevated)" }}>
            <div className="border-b px-5 py-4" style={{ borderColor: "var(--border-subtle)" }}>
              <h3 className="text-lg font-semibold">{activeTemplate?.title ?? "选择模板"}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{activeTemplate?.description ?? "从左侧选择一个模板。"}</p>
            </div>
            <ScrollArea className="flex-1 px-5 py-4">
              <pre className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">{activeTemplate?.content ?? ""}</pre>
            </ScrollArea>
            <DialogFooter className="border-t px-5 py-4" style={{ borderColor: "var(--border-subtle)" }}>
              <Button variant="outline" className="rounded-[12px]" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button className="rounded-[12px]" disabled={!activeTemplate || loading} onClick={onConfirm}>
                {mode === "create" ? "创建笔记" : "应用模板"}
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
