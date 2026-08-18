import Tesseract from "tesseract.js";
import * as pdfjs from "pdfjs-dist/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface RecognizeAttachmentInput {
  url: string;
  mimeType: string;
  fileName: string;
  maxPdfPages?: number;
  onProgress?: (message: string, progress: number) => void;
}

interface PdfPage {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void> };
}

function report(input: RecognizeAttachmentInput, message: string, progress: number) {
  input.onProgress?.(message, Math.max(0, Math.min(1, progress)));
}

async function createOcrWorker(input: RecognizeAttachmentInput) {
  try {
    return await Tesseract.createWorker("eng+chi_sim", undefined, {
      logger: (message) => {
        if (typeof message.progress === "number") report(input, message.status || "OCR", message.progress);
      },
    });
  } catch {
    return Tesseract.createWorker("eng", undefined, {
      logger: (message) => {
        if (typeof message.progress === "number") report(input, message.status || "OCR", message.progress);
      },
    });
  }
}

async function recognizeBlob(blob: Blob, input: RecognizeAttachmentInput) {
  const worker = await createOcrWorker(input);
  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
    });
    const result = await worker.recognize(blob);
    return result.data.text.trim();
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

async function extractPdfText(arrayBuffer: ArrayBuffer) {
  const document = await pdfjs.getDocument({ data: arrayBuffer.slice(0) }).promise;
  const pages = Math.min(document.numPages, 20);
  const parts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: { str?: string }) => item.str ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (pageText) parts.push(pageText);
  }
  await document.destroy();
  return parts.join("\n\n").trim();
}

async function renderPdfPageToBlob(page: PdfPage) {
  const viewport = page.getViewport({ scale: 1.7 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("Failed to render PDF page"));
    }, "image/png");
  });
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

async function recognizePdf(input: RecognizeAttachmentInput, arrayBuffer: ArrayBuffer) {
  report(input, "读取 PDF 文本层", 0.08);
  const textLayer = await extractPdfText(arrayBuffer);
  if (textLayer.length >= 20) {
    report(input, "PDF 文本层识别完成", 1);
    return textLayer;
  }

  report(input, "渲染扫描版 PDF", 0.16);
  const document = await pdfjs.getDocument({ data: arrayBuffer.slice(0) }).promise;
  const maxPages = Math.min(document.numPages, input.maxPdfPages ?? 3);
  const worker = await createOcrWorker(input);
  const parts: string[] = [];
  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
    });
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      report(input, `渲染第 ${pageNumber}/${maxPages} 页`, 0.2 + (pageNumber - 1) / maxPages * 0.25);
      const page = await document.getPage(pageNumber);
      const blob = await renderPdfPageToBlob(page);
      report(input, `识别第 ${pageNumber}/${maxPages} 页`, 0.45 + (pageNumber - 1) / maxPages * 0.45);
      const result = await worker.recognize(blob);
      const text = result.data.text.trim();
      if (text) parts.push(`--- Page ${pageNumber} ---\n${text}`);
    }
  } finally {
    await worker.terminate().catch(() => undefined);
    await document.destroy();
  }
  return parts.join("\n\n").trim();
}

export async function recognizeAttachment(input: RecognizeAttachmentInput) {
  report(input, "下载附件", 0.02);
  const response = await fetch(input.url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("附件下载失败");
  const blob = await response.blob();
  const mimeType = (input.mimeType || blob.type || "").toLowerCase();

  if (mimeType.startsWith("image/")) {
    report(input, "开始图片 OCR", 0.08);
    const text = await recognizeBlob(blob, input);
    return text || `未识别到文字：${input.fileName}`;
  }

  if (mimeType === "application/pdf" || input.fileName.toLowerCase().endsWith(".pdf")) {
    const text = await recognizePdf(input, await blob.arrayBuffer());
    return text || `未识别到 PDF 文字：${input.fileName}`;
  }

  throw new Error("当前仅支持图片和 PDF OCR");
}
