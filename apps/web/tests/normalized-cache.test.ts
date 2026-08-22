import { describe, expect, it } from "vitest";

type WebExports = Record<string, unknown>;

async function loadWeb() {
  return (await import("../src/index")) as WebExports;
}

describe("NormalizedCache", () => {
  it("isolates workspaces, rejects older revisions, and reports stale data", async () => {
    const web = await loadWeb();
    expect(web.NormalizedCache).toBeTypeOf("function");
    let now = 1_000;
    const Cache = web.NormalizedCache as new (options: Record<string, unknown>) => {
      writeEntity(input: Record<string, unknown>): void;
      readEntity<T>(workspaceId: string, type: string, id: string, maxAgeMs: number): { data: T; revision: number; stale: boolean } | null;
    };
    const cache = new Cache({ clock: () => now });

    cache.writeEntity({ workspaceId: "ws-1", type: "note", id: "note-1", revision: 2, data: { title: "Current" } });
    cache.writeEntity({ workspaceId: "ws-1", type: "note", id: "note-1", revision: 1, data: { title: "Old" } });
    cache.writeEntity({ workspaceId: "ws-2", type: "note", id: "note-1", revision: 1, data: { title: "Other" } });

    expect(cache.readEntity<{ title: string }>("ws-1", "note", "note-1", 500)).toEqual({
      data: { title: "Current" }, revision: 2, stale: false,
    });
    expect(cache.readEntity<{ title: string }>("ws-2", "note", "note-1", 500)?.data.title).toBe("Other");
    now = 1_501;
    expect(cache.readEntity("ws-1", "note", "note-1", 500)?.stale).toBe(true);
  });
});
