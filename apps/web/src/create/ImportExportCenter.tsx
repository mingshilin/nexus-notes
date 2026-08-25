import type { Job } from "@nexus/contracts";
import { FileUp, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useState } from "react";
import type { OperationsClient } from "../data/operations-client";

const MAX_IMPORT_BYTES = 200_000;

interface ImportPreviewItem {
  title: string;
  content: string;
}

type ImportOperations = Pick<OperationsClient, "createJob" | "getJob"> & Partial<Pick<OperationsClient, "cancelJob">>;

export interface ImportExportCenterProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  operations: ImportOperations;
  onImported?(): void;
}

function jobStatusLabel(status: Job["status"]) {
  if (status === "queued") return "排队中";
  if (status === "running") return "处理中";
  if (status === "complete") return "导入完成";
  if (status === "failed") return "导入失败";
  return "已取消";
}

function errorText(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "IMPORT_CONTENT_INVALID") return "文件为空或超过 200 KB，请选择较小的 Markdown/文本文件。";
  if (code === "OPERATION_KIND_UNSUPPORTED") return "当前导入格式暂不支持。";
  return "导入请求失败，请检查网络后重试。原文件不会被删除。";
}

async function readFileText(file: File) {
  if (typeof file.text === "function") return file.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("FILE_READ_FAILED"));
    reader.readAsText(file);
  });
}

function previewMarkdownImport(content: string): ImportPreviewItem[] {
  return content
    .split(/\r?\n---+\r?\n/u)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const firstLine = block.split(/\r?\n/u)[0]?.replace(/^#{1,6}\s*/u, "").trim() ?? "";
      return { title: (firstLine || `Imported ${index + 1}`).slice(0, 160), content: block };
    });
}

export function ImportExportCenter({ open, onOpenChange, operations, onImported }: ImportExportCenterProps) {
  const titleId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [previewItems, setPreviewItems] = useState<ImportPreviewItem[]>([]);
  const [previewPending, setPreviewPending] = useState(false);
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setFile(null);
    setJob(null);
    setPreviewItems([]);
    setPreviewPending(false);
    setPending(false);
    setCancelling(false);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!file) {
      setPreviewItems([]);
      setPreviewPending(false);
      return undefined;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setPreviewItems([]);
      setPreviewPending(false);
      return undefined;
    }
    let cancelled = false;
    setPreviewPending(true);
    void readFileText(file).then((content) => {
      if (!cancelled) setPreviewItems(previewMarkdownImport(content));
    }).catch(() => {
      if (!cancelled) setPreviewItems([]);
    }).finally(() => {
      if (!cancelled) setPreviewPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => {
    if (!open || !job || job.status === "complete" || job.status === "failed" || job.status === "cancelled") return undefined;
    const controller = new AbortController();
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await operations.getJob(job.id, controller.signal);
        if (controller.signal.aborted || !next) return;
        setJob(next);
        if (next.status === "complete") onImported?.();
        else if (next.status !== "failed" && next.status !== "cancelled") timer = window.setTimeout(() => void poll(), 800);
      } catch {
        if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), 1_500);
      }
    };
    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [job, onImported, open, operations]);

  if (!open || typeof document === "undefined") return null;

  const submit = async () => {
    if (!file || pending) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setError("文件超过 200 KB，请选择较小的 Markdown/文本文件。");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const content = await readFileText(file);
      const next = await operations.createJob({
        kind: "import",
        idempotency_key: crypto.randomUUID(),
        payload: { format: "markdown", filename: file.name, content },
      });
      setJob(next);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(false);
    }
  };

  const cancel = async () => {
    if (!job || job.status !== "queued" || !operations.cancelJob || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      setJob(await operations.cancelJob(job.id, { base_revision: job.revision }));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setCancelling(false);
    }
  };

  const dialog = (
    <div className="create-center-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onOpenChange(false); }}>
      <section className="create-center-dialog import-export-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
        <header className="create-center-header">
          <div>
            <p className="eyebrow">导入中心</p>
            <h2 id={titleId}>导入 Markdown 或文本</h2>
            <p>文件会在当前工作区创建为一篇新笔记，支持单个不超过 200 KB 的 `.md`、`.markdown`、`.txt` 文件。</p>
          </div>
          <button type="button" className="create-center-close" aria-label="关闭导入中心" onClick={() => onOpenChange(false)}><X aria-hidden="true" size={18} /></button>
        </header>
        <label className="import-export-file-picker">
          <FileUp aria-hidden="true" size={20} />
          <span>{file ? file.name : "选择文件"}</span>
          <input aria-label="选择要导入的 Markdown 或文本文件" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" disabled={pending} onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); setJob(null); setError(null); }} />
        </label>
        {file ? <p className="create-center-feedback" role="status">已选择 {file.name}，大小 {Math.ceil(file.size / 1024)} KB。</p> : null}
        {previewPending ? <p className="create-center-feedback" role="status">正在生成导入预览…</p> : null}
        {!previewPending && previewItems.length > 0 ? <div className="import-export-preview" aria-label="导入预览">
          <p className="create-center-feedback" role="status">预览 {previewItems.length} 条笔记</p>
          <ol>
            {previewItems.slice(0, 8).map((item, index) => <li key={`${item.title}-${index}`}>{item.title}</li>)}
          </ol>
          {previewItems.length > 8 ? <p className="create-center-feedback">其余 {previewItems.length - 8} 条将在后台继续导入。</p> : null}
        </div> : null}
        {error ? <p className="create-center-feedback error" role="alert">{error}</p> : null}
        {job ? <p className="create-center-feedback" role="status">任务 {job.id}：{jobStatusLabel(job.status)}{job.error_code ? `（${job.error_code}）` : ""}</p> : null}
        <div className="account-actions import-export-actions">
          <button type="button" onClick={() => onOpenChange(false)}>关闭</button>
          {job?.status === "queued" && operations.cancelJob ? <button type="button" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? "正在撤销…" : "撤销导入"}</button> : null}
          <button type="button" disabled={!file || pending || job?.status === "queued" || job?.status === "running"} onClick={() => void submit()}>{pending ? "正在读取文件…" : job?.status === "complete" ? "再次导入" : job?.status === "failed" ? "重试导入" : "开始导入"}</button>
        </div>
      </section>
    </div>
  );
  return createPortal(dialog, document.body);
}
