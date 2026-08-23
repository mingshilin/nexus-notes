import { describe, expect, it } from "vitest";

type ContractExports = Record<string, unknown>;

async function loadContracts() {
  return (await import("../src/index")) as ContractExports;
}

const note = {
  id: "note-1",
  workspace_id: "ws-1",
  folder_id: null,
  database_id: null,
  created_by: "user-1",
  updated_by: "user-1",
  title: "Draft",
  content: "Body",
  status: "active",
  is_favorite: false,
  is_pinned: false,
  daily_date: null,
  revision: 1,
  created_at: "2026-08-21T00:00:00.000Z",
  updated_at: "2026-08-21T00:00:00.000Z",
};

describe("note contracts", () => {
  it("accepts only a calendar date when opening a daily note", async () => {
    const contracts = await loadContracts();
    expect(contracts.DailyNoteInputSchema).toBeDefined();
    const schema = contracts.DailyNoteInputSchema as { safeParse(value: unknown): { success: boolean } };

    expect(schema.safeParse({ daily_date: "2026-08-23" }).success).toBe(true);
    expect(schema.safeParse({ daily_date: "2026-8-23" }).success).toBe(false);
    expect(schema.safeParse({ daily_date: "2026-08-23", title: "ignored" }).success).toBe(false);
  });

  it("validates tenant-scoped notes and immutable revision snapshots", async () => {
    const contracts = await loadContracts();
    expect(contracts.NoteSchema).toBeDefined();
    expect(contracts.NoteRevisionSchema).toBeDefined();
    const NoteSchema = contracts.NoteSchema as { safeParse(value: unknown): { success: boolean } };
    const NoteRevisionSchema = contracts.NoteRevisionSchema as { safeParse(value: unknown): { success: boolean } };

    expect(NoteSchema.safeParse(note).success).toBe(true);
    expect(NoteSchema.safeParse({ ...note, workspace_id: "", revision: 0 }).success).toBe(false);
    expect(NoteRevisionSchema.safeParse({
      id: "version-1",
      workspace_id: "ws-1",
      note_id: "note-1",
      revision: 1,
      title: "Draft",
      content: "Body",
      source: "autosave",
      created_by: "user-1",
      created_at: "2026-08-21T00:00:00.000Z",
    }).success).toBe(true);
  });

  it("requires optimistic concurrency and a real change for note updates", async () => {
    const contracts = await loadContracts();
    expect(contracts.UpdateNoteInputSchema).toBeDefined();
    const schema = contracts.UpdateNoteInputSchema as { safeParse(value: unknown): { success: boolean } };

    expect(schema.safeParse({ base_revision: 2, title: "Updated", source: "autosave" }).success).toBe(true);
    expect(schema.safeParse({ base_revision: 2 }).success).toBe(false);
    expect(schema.safeParse({ title: "Missing revision" }).success).toBe(false);
    expect(schema.safeParse({ base_revision: 2, content: "x".repeat(200_001) }).success).toBe(false);
  });

  it("requires a positive integer revision for permanent note deletion", async () => {
    const contracts = await loadContracts();
    expect(contracts.DeleteNoteInputSchema).toBeDefined();
    const schema = contracts.DeleteNoteInputSchema as { safeParse(value: unknown): { success: boolean } };

    expect(schema.safeParse({ base_revision: 2 }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ base_revision: 0 }).success).toBe(false);
    expect(schema.safeParse({ base_revision: 1.5 }).success).toBe(false);
  });

  it("bounds create, restore, and quick-capture payloads", async () => {
    const contracts = await loadContracts();
    expect(contracts.CreateNoteInputSchema).toBeDefined();
    expect(contracts.RestoreNoteInputSchema).toBeDefined();
    expect(contracts.QuickCaptureInputSchema).toBeDefined();
    const create = contracts.CreateNoteInputSchema as { safeParse(value: unknown): { success: boolean } };
    const restore = contracts.RestoreNoteInputSchema as { safeParse(value: unknown): { success: boolean } };
    const capture = contracts.QuickCaptureInputSchema as { safeParse(value: unknown): { success: boolean } };

    expect(create.safeParse({ title: "Inbox", content: "Captured", daily_date: "2026-08-21" }).success).toBe(true);
    expect(create.safeParse({ title: "x".repeat(161) }).success).toBe(false);
    expect(restore.safeParse({ base_revision: 3 }).success).toBe(true);
    expect(restore.safeParse({ base_revision: 0 }).success).toBe(false);
    expect(capture.safeParse({ content: "A quick thought" }).success).toBe(true);
    expect(capture.safeParse({ content: "" }).success).toBe(false);
  });
});
