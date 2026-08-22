import { describe, expect, it } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

describe("auth cryptography", () => {
  it("uses the maximum PBKDF2 iteration count supported by Workers by default", async () => {
    const worker = await loadWorker();
    const Hasher = worker.WebCryptoPasswordHasher as new () => {
      hash(password: string): Promise<string>;
    };

    await expect(new Hasher().hash("long-enough-123")).resolves.toMatch(/^pbkdf2_sha256\$100000\$/);
  });

  it("salts PBKDF2 passwords and verifies without exposing plaintext", async () => {
    const worker = await loadWorker();
    expect(worker.WebCryptoPasswordHasher).toBeTypeOf("function");
    const Hasher = worker.WebCryptoPasswordHasher as new (options: Record<string, unknown>) => {
      hash(password: string): Promise<string>;
      verify(password: string, encoded: string): Promise<boolean>;
    };
    const hasher = new Hasher({ iterations: 1_000 });

    const first = await hasher.hash("long-enough-123");
    const second = await hasher.hash("long-enough-123");

    expect(first).toMatch(/^pbkdf2_sha256\$1000\$/);
    expect(first).not.toContain("long-enough-123");
    expect(second).not.toBe(first);
    await expect(hasher.verify("long-enough-123", first)).resolves.toBe(true);
    await expect(hasher.verify("wrong-password", first)).resolves.toBe(false);
  });

  it("creates high-entropy session tokens, six-digit codes, and keyed hashes", async () => {
    const worker = await loadWorker();
    expect(worker.SecureTokenService).toBeTypeOf("function");
    const Tokens = worker.SecureTokenService as new (secret: string) => {
      createSessionToken(): string;
      createEmailCode(): string;
      hash(value: string): Promise<string>;
    };
    const tokens = new Tokens("test-pepper-at-least-32-characters-long");

    const first = tokens.createSessionToken();
    const second = tokens.createSessionToken();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(tokens.createEmailCode()).toMatch(/^\d{6}$/);
    expect(await tokens.hash("plain-token")).toBe(await tokens.hash("plain-token"));
    expect(await tokens.hash("plain-token")).not.toContain("plain-token");
  });
});
