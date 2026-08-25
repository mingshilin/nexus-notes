import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

function statement(result: unknown = null) {
  const current = {
    bind: vi.fn(),
    first: vi.fn(async () => result),
    run: vi.fn(async () => ({ success: true })),
  };
  current.bind.mockReturnValue(current);
  return current;
}

describe("D1AuthRepository", () => {
  it("persists the bounded user agent only on the created session", async () => {
    const worker = await loadWorker();
    const prepared = statement();
    const db = { prepare: vi.fn(() => prepared), batch: vi.fn() };
    const Repository = worker.D1AuthRepository as new (db: unknown, id: () => string) => {
      createSession(input: { userId: string; tokenHash: string; expiresAt: string; now: string; userAgent: string }): Promise<void>;
    };
    const repository = new Repository(db, () => "session-1");

    await repository.createSession({
      userId: "user-1", tokenHash: "hash:session", expiresAt: "2026-09-21T00:00:00.000Z",
      now: "2026-08-21T00:00:00.000Z", userAgent: "Test Browser",
    });

    expect(db.prepare).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO sessions \(id, user_id, token_hash, expires_at, last_seen_at, created_at, user_agent\)/i));
    expect(prepared.bind).toHaveBeenCalledWith(
      "session-1", "user-1", "hash:session", "2026-09-21T00:00:00.000Z",
      "2026-08-21T00:00:00.000Z", "2026-08-21T00:00:00.000Z", "Test Browser",
    );
  });

  it("atomically consumes a valid unused reset token", async () => {
    const worker = await loadWorker();
    expect(worker.D1AuthRepository).toBeTypeOf("function");
    const prepared = statement({ user_id: "user-1" });
    const db = { prepare: vi.fn(() => prepared), batch: vi.fn() };
    const Repository = worker.D1AuthRepository as new (db: unknown, id: () => string) => {
      consumePasswordReset(hash: string, now: string): Promise<{ userId: string } | null>;
    };
    const repository = new Repository(db, () => "id-1");

    await expect(repository.consumePasswordReset("hash:token", "2026-08-21T00:00:00.000Z")).resolves.toEqual({ userId: "user-1" });

    expect(db.prepare).toHaveBeenCalledWith(expect.stringMatching(/UPDATE password_resets[\s\S]*consumed_at IS NULL[\s\S]*expires_at > \?[\s\S]*RETURNING user_id/i));
    expect(prepared.bind).toHaveBeenCalledWith("2026-08-21T00:00:00.000Z", "hash:token", "2026-08-21T00:00:00.000Z");
  });

  it("updates the password and revokes sessions in one D1 batch", async () => {
    const worker = await loadWorker();
    const statements = [statement(), statement()];
    const db = { prepare: vi.fn(() => statements.shift()!), batch: vi.fn(async () => []) };
    const Repository = worker.D1AuthRepository as new (db: unknown, id: () => string) => {
      updatePasswordAndRevokeSessions(userId: string, hash: string, now: string): Promise<void>;
    };
    const repository = new Repository(db, () => "id-1");

    await repository.updatePasswordAndRevokeSessions("user-1", "new-hash", "2026-08-21T00:00:00.000Z");

    expect(db.batch).toHaveBeenCalledOnce();
    expect(db.prepare.mock.calls[0]?.[0]).toMatch(/UPDATE users SET password_hash/i);
    expect(db.prepare.mock.calls[1]?.[0]).toMatch(/UPDATE sessions SET revoked_at/i);
  });
});
