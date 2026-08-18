import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../worker/db/queries", () => ({
  insertTag: vi.fn(),
  listTags: vi.fn(),
}));

import { handleCreateTag, handleListTags } from "../../worker/routes/tags";
import { insertTag, listTags } from "../../worker/db/queries";

const userId = "user-1";
const workspaceId = "ws-1";

describe("tags routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists tags with unified response", async () => {
    vi.mocked(listTags).mockResolvedValue([
      { id: "t1", name: "work", color: "#6B9EFF", created_at: "x", updated_at: "x" },
    ]);
    const response = await handleListTags({} as D1Database, userId, workspaceId);
    const body = (await response.json()) as { success: boolean; data: Array<unknown> };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
  });

  it("validates tag color", async () => {
    const request = new Request("http://localhost/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "work", color: "blue" }),
    });
    await expect(handleCreateTag({} as D1Database, userId, workspaceId, request)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("creates tag", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("x");
    vi.mocked(insertTag).mockResolvedValue(undefined);
    vi.mocked(listTags).mockResolvedValue([
      { id: "x", name: "work", color: "#6B9EFF", created_at: "x", updated_at: "x" },
    ]);
    const request = new Request("http://localhost/api/tags", {
      method: "POST",
      body: JSON.stringify({ name: "work", color: "#6B9EFF" }),
    });
    const response = await handleCreateTag({} as D1Database, userId, workspaceId, request);
    expect(response.status).toBe(201);
    vi.restoreAllMocks();
  });
});
