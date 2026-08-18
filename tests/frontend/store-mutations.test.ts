import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import type { NoteWithTags } from "@/types/note";

function note(id: string, overrides: Partial<NoteWithTags> = {}) {
  return {
    ...baseNote(id),
    ...overrides,
  };
}

function baseNote(id: string): NoteWithTags {
  return {
    id,
    title: `Note ${id}`,
    content: "content",
    folder_id: null,
    is_favorite: false,
    is_pinned: false,
    is_daily: false,
    daily_date: null,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    deleted_at: null,
    archived_at: null,
    last_opened_at: null,
    tags: [],
    folder: null,
  };
}

describe("app store mutations", () => {
  beforeEach(() => {
    useAppStore.getState().resetUserScopedState();
  });

  it("removes note from notes, trash, recent and opened tabs together", () => {
    const store = useAppStore.getState();
    store.setNotes([note("n1"), note("n2")]);
    store.setTrashNotes([note("n3", { deleted_at: "2026-05-02T00:00:00Z" })]);
    store.setRecentNotes([note("n1"), note("n3")]);
    store.openTab("n1");
    store.openTab("n3");
    store.setSelectedNoteId("n1");

    store.removeNote("n1");

    const next = useAppStore.getState();
    expect(next.notes.map((item) => item.id)).toEqual(["n2"]);
    expect(next.trashNotes.map((item) => item.id)).toEqual(["n3"]);
    expect(next.recentNotes.map((item) => item.id)).toEqual(["n3"]);
    expect(next.openedTabs).not.toContain("n1");
    expect(next.selectedNoteId).not.toBe("n1");
  });

  it("tracks pending mutations without duplicates", () => {
    const store = useAppStore.getState();
    store.setPendingMutation("note:create", true);
    store.setPendingMutation("note:create", true);
    store.setPendingMutation("note:delete:n1", true);

    let next = useAppStore.getState();
    expect(next.pendingMutations).toEqual(["note:create", "note:delete:n1"]);

    store.setPendingMutation("note:create", false);
    next = useAppStore.getState();
    expect(next.pendingMutations).toEqual(["note:delete:n1"]);
  });

  it("moves deleted note into trash bucket on upsert", () => {
    const store = useAppStore.getState();
    store.setNotes([note("n1")]);

    store.upsertNote(note("n1", { deleted_at: "2026-05-03T00:00:00Z", updated_at: "2026-05-03T00:00:00Z" }));

    const next = useAppStore.getState();
    expect(next.notes).toHaveLength(0);
    expect(next.trashNotes).toHaveLength(1);
    expect(next.trashNotes[0].id).toBe("n1");
  });
});
