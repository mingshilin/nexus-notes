import { describe, expect, it, vi } from "vitest";

import { MAX_UPLOAD_BYTES } from "@nexus/contracts";

import {
  MAX_OCR_EXTRACTED_TEXT_BYTES,
  OcrExtractionError,
  OcrExtractor,
  type OcrObjectStore,
} from "../src/attachments/ocr-extractor";

function stream(bytes: Uint8Array, onCancel?: () => void) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
    cancel: onCancel,
  });
}

function fakeStore(objects: Record<string, { bytes: Uint8Array; size?: number }>): OcrObjectStore {
  return {
    get: vi.fn(async (key: string) => {
      const object = objects[key];
      return object ? { body: stream(object.bytes), size: object.size ?? object.bytes.byteLength } : null;
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

function request(overrides: Partial<Parameters<OcrExtractor["extract"]>[0]> = {}) {
  return {
    objectKey: "ws-1/attachments/attachment-1",
    filename: "scan.pdf",
    mimeType: "application/pdf",
    sizeBytes: 5,
    ...overrides,
  };
}

async function expectExtractionError(promise: Promise<unknown>, code: string, retryable: boolean) {
  await expect(promise).rejects.toMatchObject({ code, retryable });
}

describe("OcrExtractor", () => {
  it("decodes UTF-8 text locally without an AI binding", async () => {
    const store = fakeStore({
      "ws-1/attachments/attachment-1": { bytes: new TextEncoder().encode("local text") },
    });
    const extractor = new OcrExtractor({ files: store });

    await expect(extractor.extract(request({ filename: "note.txt", mimeType: "text/plain", sizeBytes: 10 }))).resolves.toBe("local text");
    expect(store.get).toHaveBeenCalledWith("ws-1/attachments/attachment-1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("rejects local UTF-8 text larger than the extracted-text bound", async () => {
    const bytes = new TextEncoder().encode("a".repeat(MAX_OCR_EXTRACTED_TEXT_BYTES + 1));
    const extractor = new OcrExtractor({
      files: fakeStore({ "ws-1/attachments/attachment-1": { bytes } }),
    });

    await expectExtractionError(extractor.extract(request({ filename: "large.txt", mimeType: "text/plain", sizeBytes: bytes.byteLength })), "OCR_OUTPUT_TOO_LARGE", false);
  });

  it.each([
    ["application/pdf", "scan.pdf"],
    ["image/jpeg", "scan.jpg"],
    ["image/png", "scan.png"],
    ["image/webp", "scan.webp"],
  ] as const)("converts %s through the injected Workers AI binding", async (mimeType, filename) => {
    const sourceBytes = new Uint8Array([1, 2, 3]);
    const store = fakeStore({
      "ws-1/attachments/attachment-1": { bytes: sourceBytes },
    });
    const ai = { toMarkdown: vi.fn(async () => ({ id: "conversion-1", name: filename, mimeType, format: "markdown" as const, tokens: 2, data: "# Converted" })) };
    const extractor = new OcrExtractor({ files: store, ai });

    await expect(extractor.extract(request({ filename, mimeType, sizeBytes: 3 }))).resolves.toBe("# Converted");
    const conversionInput = ai.toMarkdown.mock.calls[0]?.[0];
    expect(conversionInput).toEqual(expect.objectContaining({ name: filename, blob: expect.any(Blob) }));
    expect(conversionInput?.blob.type).toBe(mimeType);
    expect(new Uint8Array(await conversionInput!.blob.arrayBuffer())).toEqual(sourceBytes);
  });

  it("returns stable terminal errors for unavailable objects, bindings, unsupported MIME, provider errors, and empty output", async () => {
    const missingObject = new OcrExtractor({ files: fakeStore({}) });
    await expectExtractionError(missingObject.extract(request()), "OCR_OBJECT_NOT_FOUND", false);

    const object = { "ws-1/attachments/attachment-1": { bytes: new Uint8Array([1]) } };
    await expectExtractionError(new OcrExtractor({ files: fakeStore(object) }).extract(request()), "OCR_AI_UNAVAILABLE", false);
    await expectExtractionError(new OcrExtractor({ files: fakeStore(object) }).extract(request({ mimeType: "image/svg+xml" })), "OCR_UNSUPPORTED_MIME", false);

    const providerError = new OcrExtractor({
      files: fakeStore(object),
      ai: { toMarkdown: vi.fn(async () => ({ id: "conversion-1", name: "scan.pdf", mimeType: "application/pdf", format: "error" as const, error: "provider detail" })) },
    });
    await expectExtractionError(providerError.extract(request()), "OCR_AI_FORMAT_ERROR", false);

    const emptyOutput = new OcrExtractor({
      files: fakeStore(object),
      ai: { toMarkdown: vi.fn(async () => ({ id: "conversion-1", name: "scan.pdf", mimeType: "application/pdf", format: "markdown" as const, tokens: 0, data: "   " })) },
    });
    await expectExtractionError(emptyOutput.extract(request()), "OCR_EMPTY_RESULT", false);
  });

  it.each([
    [{ format: "unknown" }, "OCR_AI_INVALID_RESPONSE", true],
    [{ format: "markdown" }, "OCR_AI_INVALID_RESPONSE", true],
    [{ format: "markdown", data: 42 }, "OCR_AI_INVALID_RESPONSE", true],
    [{ format: "error" }, "OCR_AI_INVALID_RESPONSE", true],
    [null, "OCR_AI_INVALID_RESPONSE", true],
  ])("maps malformed AI conversion payload %# to a stable retryable error", async (payload, code, retryable) => {
    const extractor = new OcrExtractor({
      files: fakeStore({ "ws-1/attachments/attachment-1": { bytes: new Uint8Array([1]) } }),
      ai: { toMarkdown: vi.fn(async () => payload) },
    });

    await expectExtractionError(extractor.extract(request({ sizeBytes: 1 })), code, retryable);
  });

  it("cancels oversized objects before conversion and rejects oversized extracted text", async () => {
    const cancel = vi.fn();
    const files: OcrObjectStore = {
      get: vi.fn(async () => ({ body: stream(new Uint8Array([1]), cancel), size: MAX_UPLOAD_BYTES + 1 })),
    };
    const ai = { toMarkdown: vi.fn() };
    const oversizedInput = new OcrExtractor({ files, ai });

    await expectExtractionError(oversizedInput.extract(request()), "OCR_INPUT_TOO_LARGE", false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(ai.toMarkdown).not.toHaveBeenCalled();

    const oversizedOutput = new OcrExtractor({
      files: fakeStore({ "ws-1/attachments/attachment-1": { bytes: new Uint8Array([1]) } }),
      ai: { toMarkdown: vi.fn(async () => ({ id: "conversion-1", name: "scan.pdf", mimeType: "application/pdf", format: "markdown" as const, tokens: 1, data: "a".repeat(MAX_OCR_EXTRACTED_TEXT_BYTES + 1) })) },
    });
    await expectExtractionError(oversizedOutput.extract(request()), "OCR_OUTPUT_TOO_LARGE", false);
  });

  it("classifies a conversion timeout as retryable", async () => {
    const object = { "ws-1/attachments/attachment-1": { bytes: new Uint8Array([1]) } };
    const timeout = new OcrExtractor(
      { files: fakeStore(object), ai: { toMarkdown: vi.fn(() => new Promise(() => undefined)) } },
      { timeoutMs: 25 },
    );
    await expectExtractionError(timeout.extract(request()), "OCR_TIMEOUT", true);
  });

  it("classifies cancellation as retryable", async () => {
    const object = { "ws-1/attachments/attachment-1": { bytes: new Uint8Array([1]) } };
    const controller = new AbortController();
    controller.abort();
    const cancelled = new OcrExtractor({ files: fakeStore(object), ai: { toMarkdown: vi.fn() } });
    await expectExtractionError(cancelled.extract(request({ signal: controller.signal })), "OCR_CANCELLED", true);
  });

  it("enforces an expired deadline without reading the object", async () => {
    const object = { "ws-1/attachments/attachment-1": { bytes: new Uint8Array([1]) } };
    const deadline = new OcrExtractor({ files: fakeStore(object), ai: { toMarkdown: vi.fn() } });
    await expectExtractionError(deadline.extract(request({ deadline: new Date(Date.now() - 1) })), "OCR_DEADLINE_EXCEEDED", false);
  });

  it("passes a cancellation signal to dependencies, cancels a late object body, and ignores a late AI result", async () => {
    const lateObject = deferred<{ body: ReadableStream<Uint8Array>; size: number } | null>();
    const lateObjectCancel = vi.fn();
    const files: OcrObjectStore = { get: vi.fn(() => lateObject.promise) };
    const ai = { toMarkdown: vi.fn() };
    const objectTimeout = new OcrExtractor({ files, ai }, { timeoutMs: 25 });

    await expectExtractionError(objectTimeout.extract(request()), "OCR_TIMEOUT", true);
    lateObject.resolve({ body: stream(new Uint8Array([1]), lateObjectCancel), size: 1 });
    await flushAsyncWork();
    expect(lateObjectCancel).toHaveBeenCalledOnce();
    expect(ai.toMarkdown).not.toHaveBeenCalled();
    expect(files.get.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));

    const lateAi = deferred<unknown>();
    const dataRead = vi.fn(() => "# late");
    const latePayload = { format: "markdown" as const } as { format: "markdown"; data?: string };
    Object.defineProperty(latePayload, "data", { get: dataRead });
    const immediateFiles = fakeStore({ "ws-1/attachments/attachment-1": { bytes: new Uint8Array([1]) } });
    const conversionTimeout = new OcrExtractor({
      files: immediateFiles,
      ai: { toMarkdown: vi.fn((_file: unknown, options: { signal?: AbortSignal }) => {
        expect(options.signal).toBeInstanceOf(AbortSignal);
        return lateAi.promise;
      }) },
    }, { timeoutMs: 25 });

    await expectExtractionError(conversionTimeout.extract(request({ sizeBytes: 1 })), "OCR_TIMEOUT", true);
    lateAi.resolve(latePayload);
    await flushAsyncWork();
    expect(dataRead).not.toHaveBeenCalled();
  });

  it("rejects malformed UTF-8 text without sending it to AI", async () => {
    const ai = { toMarkdown: vi.fn() };
    const extractor = new OcrExtractor({
      files: fakeStore({ "ws-1/attachments/attachment-1": { bytes: new Uint8Array([0xc3, 0x28]) } }),
      ai,
    });

    await expectExtractionError(extractor.extract(request({ filename: "broken.txt", mimeType: "text/plain", sizeBytes: 2 })), "OCR_TEXT_DECODE_FAILED", false);
    expect(ai.toMarkdown).not.toHaveBeenCalled();
  });
});
