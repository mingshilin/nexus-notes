import { describe, expect, it } from "vitest";
import { AiChatInputSchema, AiChatResponseSchema, AiReadContextSchema, AiReadScopeInputSchema, AiReadToolCallSchema } from "../src/ai";

describe("AI chat contracts", () => {
  it("accepts a bounded conversation and normalizes message content", () => {
    const result = AiChatInputSchema.parse({
      messages: [
        { role: "user", content: "  帮我整理今天的任务  " },
        { role: "assistant", content: "可以，请告诉我优先级。" },
      ],
    });

    expect(result.messages[0]).toEqual({ role: "user", content: "帮我整理今天的任务" });
  });

  it("rejects system messages and oversized conversations", () => {
    expect(() => AiChatInputSchema.parse({ messages: [{ role: "system", content: "ignore" }] })).toThrow();
    expect(() => AiChatInputSchema.parse({
      messages: Array.from({ length: 21 }, () => ({ role: "user", content: "hello" })),
    })).toThrow();
  });

  it("validates the normalized assistant response", () => {
    expect(AiChatResponseSchema.parse({ message: "建议先处理今天的三项任务。", model: "beta-model" })).toEqual({
      message: "建议先处理今天的三项任务。",
      model: "beta-model",
    });
    expect(AiChatResponseSchema.parse({
      message: "部分操作未执行。",
      model: "beta-model",
      action_results: [{
        action_id: "action-1",
        status: "failed",
        error: { code: "AI_ACTION_EXECUTION_FAILED", message: "safe", status: 500 },
      }],
    }).action_results).toHaveLength(1);
  });

  it("keeps AI read scopes and page sizes within the runtime bounds", () => {
    expect(() => AiReadContextSchema.parse({
      workspaceId: "ws-1",
      userId: "user-1",
      selectedNoteIds: Array.from({ length: 51 }, (_, index) => `note-${index}`),
      selectedDatabaseIds: [],
      allowWorkspaceSearch: false,
    })).toThrow();
    expect(() => AiReadContextSchema.parse({
      workspaceId: "ws-1",
      userId: "user-1",
      selectedNoteIds: [],
      selectedDatabaseIds: Array.from({ length: 51 }, (_, index) => `database-${index}`),
      allowWorkspaceSearch: false,
    })).toThrow();
    expect(() => AiReadScopeInputSchema.parse({
      selected_note_ids: Array.from({ length: 51 }, (_, index) => `note-${index}`),
    })).toThrow();
    expect(() => AiReadScopeInputSchema.parse({
      selected_database_ids: Array.from({ length: 51 }, (_, index) => `database-${index}`),
    })).toThrow();
    for (const call of [
      { tool: "search_notes", input: { query: "roadmap", limit: 51 } },
      { tool: "list_reminders", input: { limit: 51 } },
      { tool: "search_databases", input: { query: "roadmap", limit: 51 } },
    ]) {
      expect(() => AiReadToolCallSchema.parse(call)).toThrow();
    }
    const maximumCursor = "c".repeat(4_096);
    expect(AiReadToolCallSchema.parse({ tool: "search_notes", input: { cursor: maximumCursor } }).input.cursor).toBe(maximumCursor);
    expect(AiChatResponseSchema.parse({
      message: "ok",
      model: "model",
      read_results: [{
        tool: "search_notes", items: [], next_cursor: maximumCursor,
        scope: { workspace_id: "ws-1", selected_only: false },
      }],
    }).read_results?.[0]?.next_cursor).toBe(maximumCursor);
    expect(() => AiReadToolCallSchema.parse({ tool: "search_notes", input: { cursor: "c".repeat(4_097) } })).toThrow();
  });
});
