import { describe, expect, it } from "vitest";

import type { OcrAiBinding } from "../src/attachments/ocr-extractor";
import { createBetaWorker } from "../src/bootstrap";
import type { BetaWorkerEnv } from "../src/routes/health";

class FakeD1PreparedStatement implements D1PreparedStatement {
  bind(..._values: unknown[]) { return this; }
  async first<T>(_columnName?: string): Promise<T | null> { return null; }
  async run<T>(): Promise<D1Result<T>> { return { success: true, results: [], meta: d1Meta() }; }
  async all<T>(): Promise<D1Result<T>> { return { success: true, results: [], meta: d1Meta() }; }
  raw<T>(_options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T>(_options?: { columnNames?: false }): Promise<T[]>;
  async raw<T>(_options?: { columnNames?: boolean }): Promise<T[]> { return []; }
}

class FakeD1Session implements D1DatabaseSession {
  constructor(private readonly statement: D1PreparedStatement) {}

  prepare(_query: string) { return this.statement; }
  async batch<T>(_statements: D1PreparedStatement[]): Promise<D1Result<T>[]> { return []; }
  getBookmark() { return null; }
}

class FakeD1Database implements D1Database {
  private readonly statement = new FakeD1PreparedStatement();
  private readonly session = new FakeD1Session(this.statement);

  prepare(_query: string) { return this.statement; }
  async batch<T>(_statements: D1PreparedStatement[]): Promise<D1Result<T>[]> { return []; }
  async exec(_query: string) { return { count: 0, duration: 0 }; }
  withSession(_constraintOrBookmark?: D1SessionBookmark | D1SessionConstraint) { return this.session; }
  async dump() { return new ArrayBuffer(0); }
}

function d1Meta(): D1Result<never>["meta"] {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: 0,
    last_row_id: 0,
    changed_db: false,
    changes: 0,
  };
}

class FakeR2Object implements R2Object {
  readonly version = "version";
  readonly size = 0;
  readonly etag = "etag";
  readonly httpEtag = '"etag"';
  readonly checksums: R2Checksums = { toJSON: () => ({}) };
  readonly uploaded = new Date(0);
  readonly storageClass = "Standard";

  constructor(readonly key: string) {}

  writeHttpMetadata(_headers: Headers) {}
}

class FakeR2ObjectBody extends FakeR2Object implements R2ObjectBody {
  get body() { return new ReadableStream<Uint8Array>(); }
  get bodyUsed() { return false; }
  async arrayBuffer() { return new ArrayBuffer(0); }
  async bytes() { return new Uint8Array(); }
  async text() { return ""; }
  async json<T>(): Promise<T> { throw new Error(`No JSON body for ${this.key}`); }
  async blob() { return new Blob(); }
}

class FakeR2MultipartUpload implements R2MultipartUpload {
  constructor(readonly key: string, readonly uploadId: string) {}

  async uploadPart(partNumber: number) { return { partNumber, etag: `etag-${partNumber}` }; }
  async abort() {}
  async complete(_uploadedParts: R2UploadedPart[]) { return new FakeR2Object(this.key); }
}

class FakeR2Bucket implements R2Bucket {
  async head(_key: string) { return null; }
  async get(key: string, _options?: R2GetOptions) { return new FakeR2ObjectBody(key); }
  async put(key: string, _value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, _options?: R2PutOptions) {
    return new FakeR2Object(key);
  }
  async createMultipartUpload(key: string) { return new FakeR2MultipartUpload(key, "upload"); }
  resumeMultipartUpload(key: string, uploadId: string) { return new FakeR2MultipartUpload(key, uploadId); }
  async delete(_keys: string | string[]) {}
  async list(_options?: R2ListOptions): Promise<R2Objects> { return { objects: [], delimitedPrefixes: [], truncated: false }; }
}

function createReadyAi(): OcrAiBinding {
  return {
    async toMarkdown() { return { format: "markdown", data: "# OCR" }; },
  };
}

type OcrCapability =
  | { files: "absent"; ai: "absent" }
  | { files: "partial"; ai: "absent" }
  | { files: "available"; ai: "absent" }
  | { files: "available"; ai: "partial" }
  | { files: "available"; ai: "available" };

function healthEnv(capability: OcrCapability): BetaWorkerEnv {
  const env: BetaWorkerEnv = {
    DB: new FakeD1Database(),
    APP_BASE_URL: "https://beta.test",
    RATE_LIMIT_SECRET: "rate-limit-secret-at-least-32-characters",
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    RESEND_API_KEY: "resend-secret",
    EMAIL_FROM: "Nexus Notes <notes@beta.test>",
  };

  if (capability.files !== "absent") {
    env.FILES = new FakeR2Bucket();
    if (capability.files === "partial") Object.defineProperty(env.FILES, "delete", { value: undefined });
  }
  if (capability.ai !== "absent") {
    env.AI = createReadyAi();
    if (capability.ai === "partial") Object.defineProperty(env.AI, "toMarkdown", { value: undefined });
  }

  return env;
}

describe("OCR health capability", () => {
  const capabilityCases: Array<[OcrCapability, "unconfigured" | "degraded" | "ready"]> = [
    [{ files: "absent", ai: "absent" }, "unconfigured"],
    [{ files: "partial", ai: "absent" }, "unconfigured"],
    [{ files: "available", ai: "absent" }, "degraded"],
    [{ files: "available", ai: "partial" }, "degraded"],
    [{ files: "available", ai: "available" }, "ready"],
  ];

  it.each(capabilityCases)("reports callable OCR capability with exact safe response keys", async (capability, ocr) => {
    const response = await createBetaWorker().fetch(new Request("https://beta.test/api/v2/health"), healthEnv(capability));

    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text());
    expect(body.data).toEqual({ status: "ok", version: "development", ocr });
    expect(Object.keys(body.data).sort()).toEqual(["ocr", "status", "version"]);
    expect(Object.keys(body).sort()).toEqual(["data", "request_id", "success"]);
  });
});
