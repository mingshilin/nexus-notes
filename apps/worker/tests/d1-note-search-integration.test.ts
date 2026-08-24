import { afterEach, describe, expect, it } from "vitest";
import { createTestD1, seedTenants } from "./helpers/d1";

const disposers: Array<() => Promise<void>> = [];
const now = "2026-08-23T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
});

describe("D1 note full-text search", () => {
  it("returns only matching notes from the requested workspace", async () => {
    const database = await createTestD1();
    disposers.push(database.dispose);
    await seedTenants(database.db);
    const worker = await import("../src");
    const repository = new worker.D1NoteRepository(database.db);

    for (const note of [
      ["matching-note", "项目计划", "记录下一季度项目计划"],
      ["other-note", "旅行清单", "准备周末行程"],
    ] as const) {
      await repository.createNote({
        id: note[0],
        workspaceId: "ws-1",
        userId: "user-1",
        title: note[1],
        content: note[2],
        folderId: null,
        databaseId: null,
        dailyDate: null,
        isFavorite: false,
        isPinned: false,
        source: "manual",
        now,
        requestId: `request-${note[0]}`,
      });
    }

    const result = await repository.listNotes({ workspaceId: "ws-1", query: "计划", limit: 20 });

    expect(result.items.map((note: { id: string }) => note.id)).toEqual(["matching-note"]);
  });
});
