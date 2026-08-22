import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

function statement(result: unknown = null, results: unknown[] = []) {
  const current = {
    bind: vi.fn(),
    first: vi.fn(async () => result),
    all: vi.fn(async () => ({ results })),
    run: vi.fn(async () => ({ success: true })),
  };
  current.bind.mockReturnValue(current);
  return current;
}

describe("session and tenancy", () => {
  it("authenticates only a hashed active session cookie", async () => {
    const worker = await loadWorker();
    expect(worker.D1SessionAuthenticator).toBeTypeOf("function");
    const prepared = statement({ session_id: "session-1", user_id: "user-1" });
    const db = { prepare: vi.fn(() => prepared) };
    const tokens = { hash: vi.fn(async () => "hash:plain-token") };
    const Authenticator = worker.D1SessionAuthenticator as new (db: unknown, tokens: unknown, clock: () => Date) => {
      authenticate(request: Request): Promise<Record<string, unknown> | null>;
    };
    const authenticator = new Authenticator(db, tokens, () => new Date("2026-08-21T00:00:00.000Z"));

    await expect(authenticator.authenticate(new Request("https://beta.test", { headers: { cookie: "theme=dark; nexus_session=plain-token" } }))).resolves.toEqual({ userId: "user-1", sessionId: "session-1" });

    expect(tokens.hash).toHaveBeenCalledWith("plain-token");
    expect(prepared.bind).toHaveBeenCalledWith("hash:plain-token", "2026-08-21T00:00:00.000Z");
  });

  it("loads membership and capabilities into WorkspaceContext", async () => {
    const worker = await loadWorker();
    expect(worker.D1WorkspaceAuthorizer).toBeTypeOf("function");
    const membership = statement({ role: "editor" });
    const capabilities = statement(null, [{ capability: "comments" }, { capability: "exports" }]);
    const db = { prepare: vi.fn().mockReturnValueOnce(membership).mockReturnValueOnce(capabilities) };
    const Authorizer = worker.D1WorkspaceAuthorizer as new (db: unknown) => {
      authorize(principal: Record<string, unknown>, workspaceId: string): Promise<Record<string, unknown> | null>;
    };
    const authorizer = new Authorizer(db);

    const context = await authorizer.authorize({ userId: "user-1" }, "ws-1");

    expect(context).toMatchObject({ workspaceId: "ws-1", userId: "user-1", role: "editor" });
    expect([...(context?.capabilities as Set<string>)]).toEqual(["comments", "exports"]);
  });
});
