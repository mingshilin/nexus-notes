import { describe, expect, it } from "vitest";

import {
  createAiTrustedMode,
  evaluateAiToolPolicy,
  isAiTrustedModeActive,
  normalizeAiTrustedModeExpiry,
} from "../src";
import { AI_TOOL_CATALOG } from "@nexus/contracts";

describe("AI tool policy", () => {
  it("classifies every catalog risk and only auto-runs trusted safe writes", () => {
    expect(evaluateAiToolPolicy({
      tool: "search_notes", trusted: false, target: "workspace", externalRecipient: false,
    })).toEqual({ risk: "read", requiresConfirmation: false });
    expect(evaluateAiToolPolicy({
      tool: "create_note", trusted: false, target: "workspace", externalRecipient: false,
    })).toEqual({ risk: "safe_write", requiresConfirmation: true });
    expect(evaluateAiToolPolicy({
      tool: "create_note", trusted: true, target: "workspace", externalRecipient: false,
    })).toEqual({ risk: "safe_write", requiresConfirmation: false });
    expect(evaluateAiToolPolicy({
      tool: "update_note", trusted: true, target: "selected", externalRecipient: false,
    })).toEqual({ risk: "confirmed_write", requiresConfirmation: true });
    expect(evaluateAiToolPolicy({
      tool: "create_folder", trusted: true, target: "workspace", externalRecipient: false,
    })).toEqual({ risk: "confirmed_write", requiresConfirmation: true });
    expect(evaluateAiToolPolicy({
      tool: "send_email", trusted: true, target: "workspace", externalRecipient: false,
    })).toEqual({ risk: "external_or_destructive", requiresConfirmation: true });
  });

  it("requires explicit current or selected context for entity-bound tools", () => {
    expect(() => evaluateAiToolPolicy({
      tool: "get_note", trusted: false, target: "workspace", externalRecipient: false,
    })).toThrowError(expect.objectContaining({ code: "AI_TOOL_SELECTED_CONTEXT_REQUIRED" }));
    expect(evaluateAiToolPolicy({
      tool: "get_note", trusted: false, target: "current", externalRecipient: false,
    })).toEqual({ risk: "read", requiresConfirmation: false });
    expect(evaluateAiToolPolicy({
      tool: "update_database_record", trusted: true, target: "selected", externalRecipient: false,
    }).requiresConfirmation).toBe(true);
  });

  it("never relaxes confirmation for external recipients", () => {
    expect(evaluateAiToolPolicy({
      tool: "send_email", trusted: true, target: "workspace", externalRecipient: true,
    })).toEqual({ risk: "external_or_destructive", requiresConfirmation: true });
    expect(evaluateAiToolPolicy({
      tool: "create_note", trusted: true, target: "workspace", externalRecipient: true,
    })).toEqual({ risk: "safe_write", requiresConfirmation: true });
  });

  it("expires trusted mode at the boundary and isolates it by workspace", () => {
    const mode = {
      workspace_id: "ws-1",
      enabled: true,
      expires_at: "2026-08-29T00:00:00.000Z",
      revision: 1,
    };
    expect(isAiTrustedModeActive(mode, new Date("2026-08-28T23:59:59.999Z"), "ws-1")).toBe(true);
    expect(isAiTrustedModeActive(mode, new Date("2026-08-29T00:00:00.000Z"), "ws-1")).toBe(false);
    expect(isAiTrustedModeActive(mode, new Date("2026-08-28T00:00:00.000Z"), "ws-2")).toBe(false);
    expect(isAiTrustedModeActive(mode, new Date("2026-08-28T00:00:00.000Z"), "")).toBe(false);
    expect(isAiTrustedModeActive({ ...mode, enabled: false, expires_at: null }, new Date("2026-08-28T00:00:00.000Z"), "ws-1")).toBe(false);
  });

  it("normalizes trusted mode to a maximum 24-hour expiry", () => {
    const now = new Date("2026-08-28T00:00:00.000Z");
    expect(normalizeAiTrustedModeExpiry(true, now)).toBe("2026-08-29T00:00:00.000Z");
    expect(createAiTrustedMode({ workspaceId: "ws-1", enabled: true, revision: 1, now })).toEqual({
      workspace_id: "ws-1",
      enabled: true,
      expires_at: "2026-08-29T00:00:00.000Z",
      revision: 1,
    });
    expect(normalizeAiTrustedModeExpiry(false, now, "2026-08-29T00:00:00.000Z")).toBeNull();
    expect(() => normalizeAiTrustedModeExpiry(true, now, "2026-08-29T00:00:00.001Z")).toThrowError(expect.objectContaining({ code: "AI_TRUSTED_MODE_EXPIRY_INVALID" }));
    expect(() => normalizeAiTrustedModeExpiry(true, now, "2026-08-27T23:59:59.000Z")).toThrowError(expect.objectContaining({ code: "AI_TRUSTED_MODE_EXPIRY_INVALID" }));
  });

  it("keeps the policy mapping synchronized with every catalog entry", () => {
    for (const entry of AI_TOOL_CATALOG) {
      const target = ["get_note", "get_database_record", "update_note", "move_note", "archive_note", "restore_note", "delete_note", "apply_tag", "create_database_record", "update_database_record", "apply_template", "complete_reminder"].includes(entry.name) ? "selected" as const : "workspace" as const;
      expect(evaluateAiToolPolicy({ tool: entry.name, trusted: true, target, externalRecipient: false }).risk).toBe(entry.risk);
    }
  });
});
