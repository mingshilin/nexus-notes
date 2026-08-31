import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NoteDraftStore } from "../src/notes/note-draft-controller";
import { useNotesWorkspaceController } from "../src/app/use-notes-workspace-controller";

function createStore(): NoteDraftStore {
  return {
    saveDraft: vi.fn(async () => undefined),
    mutateDraft: vi.fn(async () => null),
    getDraft: vi.fn(async () => null),
    listDrafts: vi.fn(async () => []),
    removeDraft: vi.fn(async () => undefined),
  };
}

describe("useNotesWorkspaceController", () => {
  it("owns note data dependencies and keeps the draft controller stable until the workspace changes", async () => {
    const notesClient = { list: vi.fn(async () => ({ items: [], next_cursor: null })) };
    const knowledgeClient = {
      listFolders: vi.fn(async () => []),
      listTags: vi.fn(async () => []),
    };
    const databaseClient = { listDatabases: vi.fn(async () => []) };
    const draftControllerRef = { current: null };
    const store = createStore();
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useNotesWorkspaceController({
        notesClient: notesClient as never,
        knowledgeClient: knowledgeClient as never,
        databaseClient: databaseClient as never,
        workspaceId,
        refreshVersion: 0,
        localStore: store,
        draftControllerRef,
      }),
      { initialProps: { workspaceId: "ws-1" } },
    );

    await waitFor(() => expect(result.current.notesLoading).toBe(false));
    const firstController = result.current.draftController;
    expect(draftControllerRef.current).toBe(firstController);
    expect(result.current.noteListView).toBe("all");
    expect(result.current.selectedNoteId).toBeNull();

    rerender({ workspaceId: "ws-1" });
    expect(result.current.draftController).toBe(firstController);

    rerender({ workspaceId: "ws-2" });
    await waitFor(() => expect(result.current.notesLoading).toBe(false));
    expect(result.current.draftController).toBe(firstController);
    expect(result.current.notes).toEqual([]);
    expect(notesClient.list).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
});
