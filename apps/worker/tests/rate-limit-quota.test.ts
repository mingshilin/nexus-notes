import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

function statement(firstResult: unknown) {
  const current = { bind: vi.fn(), first: vi.fn(async () => firstResult) };
  current.bind.mockReturnValue(current);
  return current;
}

describe("rate limits and quotas", () => {
  it("uses an atomic D1 counter and rejects requests above the route limit", async () => {
    const worker = await loadWorker();
    expect(worker.D1RateLimiter).toBeTypeOf("function");
    const prepared = statement({ count: 6, expires_at: "2026-08-21T00:10:00.000Z" });
    const db = { prepare: vi.fn(() => prepared) };
    const tokens = { hash: vi.fn(async () => "hashed-bucket") };
    const Limiter = worker.D1RateLimiter as new (db: unknown, tokens: unknown, clock: () => Date) => {
      consume(input: Record<string, unknown>): Promise<void>;
    };
    const limiter = new Limiter(db, tokens, () => new Date("2026-08-21T00:00:00.000Z"));

    await expect(limiter.consume({ key: "ip:203.0.113.1", limit: 5, windowSeconds: 600 })).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });

    expect(db.prepare).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO rate_limits[\s\S]*ON CONFLICT[\s\S]*RETURNING count, expires_at/i));
    expect(prepared.bind).toHaveBeenCalledWith("hashed-bucket", "2026-08-21T00:00:00.000Z", "2026-08-21T00:10:00.000Z");
  });

  it("applies workspace quota overrides before default limits", async () => {
    const worker = await loadWorker();
    expect(worker.D1QuotaService).toBeTypeOf("function");
    const override = statement({ limit_value: 20_000 });
    const usage = statement({ value: 15_000 });
    const db = { prepare: vi.fn().mockReturnValueOnce(override).mockReturnValueOnce(usage) };
    const Quotas = worker.D1QuotaService as new (db: unknown) => {
      assertAvailable(workspaceId: string, key: string, delta: number): Promise<void>;
    };
    const quotas = new Quotas(db);

    await expect(quotas.assertAvailable("ws-1", "notes", 1)).resolves.toBeUndefined();
  });
});
