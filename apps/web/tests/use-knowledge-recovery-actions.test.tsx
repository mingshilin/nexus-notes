import { act, renderHook, waitFor } from "@testing-library/react";
import type { KnowledgeDiagnostic, Note } from "@nexus/contracts";
import { describe, expect, it, vi } from "vitest";

import { mergeDuplicateContent, useKnowledgeRecoveryActions } from "../src/app/use-knowledge-recovery-actions";

const note = (id: string, title = "未整理笔记"): Note => ({
  id,
  workspace_id: "ws-1",
  folder_id: null,
  database_id: null,
  created_by: "user-1",
  updated_by: "user-1",
  title,
  content: `${id} content`,
  status: "active",
  is_favorite: false,
  is_pinned: false,
  daily_date: null,
  revision: 1,
  created_at: "2026-08-31T00:00:00.000Z",
  updated_at: "2026-08-31T00:00:00.000Z",
});

const diagnostic = (kind: KnowledgeDiagnostic["kind"], entityId: string, title: string): KnowledgeDiagnostic => ({
  kind,
  entity_id: entityId,
  title,
  count: 1,
});

function baseProps(overrides: Record<string, unknown> = {}) {
  const notes = [note("note-1")];
  const diagnostics = [diagnostic("unfiled_note", "note-1", "未整理笔记")];
  return {
    notesClient: {
      get: vi.fn(async () => notes[0]!),
      update: vi.fn(async (id: string, input: Record<string, unknown>) => ({ ...notes[0], id, ...input, revision: 2 })),
      list: vi.fn(async () => ({ items: notes, next_cursor: null })),
    },
    workspaceId: "ws-1",
    role: "editor",
    diagnostics,
    installedNotesRef: { current: new Map<string, Note>() },
    setNotes: vi.fn(),
    setDiagnostics: vi.fn(),
    setRetryFeedback: vi.fn(),
    setDiagnosticError: vi.fn(),
    refreshRecovery: vi.fn(),
    ...overrides,
  };
}

describe("useKnowledgeRecoveryActions", () => {
  it("classifies unfiled notes and reports a bounded result", async () => {
    const input = baseProps();
    const { result } = renderHook(() => useKnowledgeRecoveryActions(input as never));

    act(() => result.current.classifyUnfiledNotes("folder-1"));

    await waitFor(() => expect(input.setRetryFeedback).toHaveBeenCalledWith("已处理 1 篇笔记。"));
    expect(input.notesClient.update).toHaveBeenCalledWith("note-1", expect.objectContaining({
      base_revision: 1,
      folder_id: "folder-1",
      database_id: null,
      source: "manual",
    }));
    expect(input.refreshRecovery).toHaveBeenCalledOnce();
  });

  it("does not publish late mutation results after the workspace scope changes", async () => {
    let resolveNote!: (value: Note) => void;
    const pending = new Promise<Note>((resolve) => { resolveNote = resolve; });
    const input = baseProps({ notesClient: {
      get: vi.fn(() => pending),
      update: vi.fn(async () => note("note-1")),
      list: vi.fn(async () => ({ items: [note("note-1")], next_cursor: null })),
    } });
    const { result, rerender } = renderHook((props) => useKnowledgeRecoveryActions(props as never), { initialProps: input });

    act(() => result.current.classifyUnfiledNotes("folder-1"));
    rerender({ ...input, workspaceId: "ws-2" });
    resolveNote(note("note-1"));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(input.notesClient.update).not.toHaveBeenCalled();
    expect(input.setNotes).not.toHaveBeenCalled();
    expect(input.setRetryFeedback).not.toHaveBeenCalled();
    expect(input.refreshRecovery).not.toHaveBeenCalled();
  });

  it("lets ignore cancel an in-flight same-scope orphan action", async () => {
    let resolveUpdate!: (value: Note) => void;
    const update = new Promise<Note>((resolve) => { resolveUpdate = resolve; });
    const orphan = diagnostic("orphan_note", "note-1", "孤立笔记");
    const input = baseProps({
      diagnostics: [orphan],
      notesClient: {
        get: vi.fn(async () => note("note-1")),
        update: vi.fn(() => update),
        list: vi.fn(async () => ({ items: [note("note-1")], next_cursor: null })),
      },
    });
    const { result } = renderHook(() => useKnowledgeRecoveryActions(input as never));

    act(() => result.current.moveOrphansToInbox());
    await waitFor(() => expect(input.notesClient.update).toHaveBeenCalledOnce());
    expect(result.current.pending).toBe(true);
    act(() => result.current.ignoreOrphans());
    expect(result.current.pending).toBe(false);
    resolveUpdate(note("note-1"));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(input.setDiagnostics).toHaveBeenCalledOnce();
    expect(input.setRetryFeedback).toHaveBeenCalledTimes(1);
    expect(input.setRetryFeedback).toHaveBeenCalledWith("已暂时隐藏当前页面的孤立笔记诊断；刷新后仍可恢复查看。");
    expect(input.setNotes).not.toHaveBeenCalled();
    expect(input.refreshRecovery).not.toHaveBeenCalled();
  });

  it("rejects a cross-workspace note response before updating local state", async () => {
    const foreign = { ...note("foreign"), workspace_id: "ws-other" };
    const input = baseProps({
      notesClient: {
        get: vi.fn(async () => foreign),
        update: vi.fn(async () => foreign),
        list: vi.fn(async () => ({ items: [foreign], next_cursor: null })),
      },
    });
    const { result } = renderHook(() => useKnowledgeRecoveryActions(input as never));

    act(() => result.current.classifyUnfiledNotes("folder-1"));

    await waitFor(() => expect(input.setRetryFeedback).toHaveBeenCalledWith("已处理 0 篇，1 篇失败；失败项仍保留，可重试。"));
    expect(input.notesClient.update).not.toHaveBeenCalled();
    expect(input.setNotes).not.toHaveBeenCalled();
  });

  it("merges duplicate titles while retaining a recoverable failure path", async () => {
    const primary = note("primary", "同名");
    const duplicate = note("duplicate", "同名");
    const input = baseProps({
      notesClient: {
        get: vi.fn(),
        list: vi.fn(async () => ({ items: [primary, duplicate], next_cursor: null })),
        update: vi.fn(async (id: string, patch: Record<string, unknown>) => ({ ...(id === "primary" ? primary : duplicate), ...patch, id, revision: 2 })),
      },
      diagnostics: [diagnostic("duplicate_title", primary.id, "同名")],
    });
    const { result } = renderHook(() => useKnowledgeRecoveryActions(input as never));

    await act(async () => { await result.current.mergeDuplicateNotes(input.diagnostics[0]!); });

    expect(input.notesClient.update).toHaveBeenCalledTimes(2);
    expect(input.setRetryFeedback).toHaveBeenCalledWith("已合并 2 篇同名笔记，重复副本已归档，可在归档列表恢复。");
    expect(input.refreshRecovery).toHaveBeenCalledOnce();
  });

  it("keeps duplicate merge content idempotent and refreshes after a partial archive failure", async () => {
    const primary = note("primary", "同名");
    const duplicate = note("duplicate", "同名");
    const merged = mergeDuplicateContent(primary, [duplicate]);
    expect(mergeDuplicateContent({ ...primary, content: merged }, [duplicate])).toBe(merged);
    const savedPrimary = { ...primary, content: merged, revision: 2 };
    const input = baseProps({
      diagnostics: [diagnostic("duplicate_title", primary.id, "同名")],
      notesClient: {
        get: vi.fn(),
        list: vi.fn(async () => ({ items: [primary, duplicate], next_cursor: null })),
        update: vi.fn()
          .mockResolvedValueOnce(savedPrimary)
          .mockRejectedValueOnce(new Error("archive failed")),
      },
    });
    const { result } = renderHook(() => useKnowledgeRecoveryActions(input as never));

    await act(async () => { await result.current.mergeDuplicateNotes(input.diagnostics[0]!); });

    expect(input.setNotes).toHaveBeenCalledOnce();
    expect(input.refreshRecovery).toHaveBeenCalledOnce();
    expect(input.setDiagnosticError).toHaveBeenCalledWith("archive failed");
  });
});
