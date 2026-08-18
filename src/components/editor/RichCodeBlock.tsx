import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface RichCodeBlockProps {
  language?: string;
  code: string;
}

export function RichCodeBlock({ language = "text", code }: RichCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("代码已复制");
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="group my-6 overflow-hidden rounded-xl border border-zinc-700/80 bg-[#1e1e1e] shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-700 bg-zinc-800 px-4 py-2">
        <span className="font-mono text-xs text-zinc-400">{language}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 opacity-0 transition-opacity hover:bg-white/10 hover:text-white group-hover:opacity-100"
          onClick={copyCode}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="scrollbar-subtle overflow-x-auto p-4 font-mono text-[13px] leading-6 text-zinc-300">
        <code>{code}</code>
      </pre>
    </div>
  );
}
