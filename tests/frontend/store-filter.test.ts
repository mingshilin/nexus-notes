import { describe, expect, it } from "vitest";
import { selectFilteredNotes, type FilterableNotesState } from "@/store/useAppStore";

const baseState: FilterableNotesState = {
  notes: [
    {
      id: "1",
      title: "React Notes",
      content: "Use Cloudflare D1",
      folder_id: null,
      is_favorite: true,
      is_pinned: false,
      is_daily: false,
      daily_date: null,
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-01T00:00:00Z",
      deleted_at: null,
      archived_at: null,
      last_opened_at: null,
      tags: [{ id: "t1", name: "work", color: "#6B9EFF", created_at: "", updated_at: "" }],
      folder: null,
    },
    {
      id: "2",
      title: "Personal",
      content: "Shopping list",
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
      tags: [{ id: "t2", name: "life", color: "#45B49A", created_at: "", updated_at: "" }],
      folder: null,
    },
  ],
  searchQuery: "",
  favoriteOnly: false,
  selectedTagId: null,
};

describe("selectFilteredNotes", () => {
  it("filters case-insensitively by keyword", () => {
    const result = selectFilteredNotes({ ...baseState, searchQuery: "react" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("filters favorites only", () => {
    const result = selectFilteredNotes({ ...baseState, favoriteOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("filters by tag id", () => {
    const result = selectFilteredNotes({ ...baseState, selectedTagId: "t2" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });
});
