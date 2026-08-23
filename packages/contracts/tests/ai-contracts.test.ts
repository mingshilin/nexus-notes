import { describe, expect, it } from "vitest";
import { AiChatInputSchema, AiChatResponseSchema } from "../src/ai";

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
  });
});
