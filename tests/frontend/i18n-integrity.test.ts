import { describe, expect, it } from "vitest";
import { zh } from "@/i18n/messages";
import { decodeEscapedUnicode, normalizeDisplayIcon } from "@/lib/utils";

// 常见乱码片段（UTF-8/GBK 混码）
const mojibakeFragments = ["绗旇", "鍥炴", "淇濆", "鏃犳", "鐧诲", "銆?"];

describe("i18n integrity", () => {
  it("does not contain replacement characters", () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(value, key).not.toContain("\uFFFD");
    }
  });

  it("does not contain common mojibake glyphs", () => {
    for (const [key, value] of Object.entries(zh)) {
      for (const fragment of mojibakeFragments) {
        expect(value, `${key}:${fragment}`).not.toContain(fragment);
      }
    }
  });

  it("keeps critical Chinese labels readable", () => {
    expect(zh.appName).toContain("笔记");
    expect(zh.noteList).toContain("笔记");
    expect(zh.trash).toContain("回收站");
    expect(zh.save).toContain("保存");
  });

  it("normalizes broken icon placeholders without removing real emoji", () => {
    expect(normalizeDisplayIcon("??")).toBe("");
    expect(normalizeDisplayIcon("\\uD83E\\uDDEA")).toBe("🧪");
    expect(decodeEscapedUnicode("\\u7B14\\u8BB0")).toBe("笔记");
  });
});
