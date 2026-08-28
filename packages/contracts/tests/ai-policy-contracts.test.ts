import { describe, expect, it } from "vitest";

import {
  AI_TOOL_CATALOG,
  AI_TRUSTED_MODE_TTL_MS,
  AiActionToolNameSchema,
  AiToolNameSchema,
  AiToolRiskSchema,
  AiToolTargetSchema,
  AiTrustedModeSchema,
  UpdateAiTrustedModeInputSchema,
} from "../src";

describe("AI policy contracts", () => {
  it("exports one unique catalog spanning every policy risk", () => {
    expect(new Set(AI_TOOL_CATALOG.map((entry) => entry.name)).size).toBe(AI_TOOL_CATALOG.length);
    expect(new Set(AiToolNameSchema.options)).toEqual(new Set(AI_TOOL_CATALOG.map((entry) => entry.name)));
    expect(new Set(AI_TOOL_CATALOG.map((entry) => entry.risk))).toEqual(new Set([
      "read", "safe_write", "confirmed_write", "external_or_destructive",
    ]));
    for (const entry of AI_TOOL_CATALOG) {
      expect(AiToolNameSchema.parse(entry.name)).toBe(entry.name);
      expect(AiToolRiskSchema.parse(entry.risk)).toBe(entry.risk);
    }
    expect(() => AiToolNameSchema.parse("execute_sql")).toThrow();
    expect(AI_TOOL_CATALOG.filter((entry) => entry.risk === "safe_write").map((entry) => entry.name)).toEqual([
      "create_note", "create_reminder", "create_notification",
    ]);
  });

  it("keeps the current action proposal allowlist separate from the complete catalog", () => {
    expect(AiActionToolNameSchema.options).toEqual([
      "create_note", "create_reminder", "create_notification", "send_email",
      "update_note", "move_note", "archive_note", "restore_note", "delete_note",
    ]);
    expect(() => AiActionToolNameSchema.parse("search_notes")).toThrow();
    expect(AiToolNameSchema.parse("search_notes")).toBe("search_notes");
  });

  it("validates workspace-scoped trusted mode and revision CAS input", () => {
    expect(AI_TRUSTED_MODE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(AiTrustedModeSchema.parse({
      workspace_id: "ws-1",
      enabled: true,
      expires_at: "2026-08-29T00:00:00.000Z",
      revision: 1,
    })).toEqual({
      workspace_id: "ws-1",
      enabled: true,
      expires_at: "2026-08-29T00:00:00.000Z",
      revision: 1,
    });
    expect(AiTrustedModeSchema.parse({
      workspace_id: "ws-1",
      enabled: false,
      expires_at: null,
      revision: 2,
    }).enabled).toBe(false);
    expect(() => AiTrustedModeSchema.parse({
      workspace_id: "ws-1",
      enabled: true,
      expires_at: null,
      revision: 1,
    })).toThrow();
    expect(() => AiTrustedModeSchema.parse({
      workspace_id: "ws-1",
      enabled: false,
      expires_at: "2026-08-29T00:00:00.000Z",
      revision: 1,
    })).toThrow();

    expect(UpdateAiTrustedModeInputSchema.parse({
      enabled: true,
      expires_at: "2026-08-29T00:00:00.000Z",
      base_revision: 3,
    }).base_revision).toBe(3);
    expect(() => UpdateAiTrustedModeInputSchema.parse({ enabled: false, expires_at: null, base_revision: 0 })).toThrow();
    expect(AiToolTargetSchema.options).toEqual(["current", "selected", "workspace"]);
  });
});
