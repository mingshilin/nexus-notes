import { afterEach, describe, expect, it, vi } from "vitest";

import { AI_ACTION_PROPOSAL_TTL_MS, type AiActionExecutionResult, type WorkspaceContext } from "@nexus/contracts";

import {
  AiToolError,
  AiToolOrchestrator,
  D1AiToolRepository,
  D1DatabaseRepository,
  D1NoteRepository,
  D1TaxonomyRepository,
  NoteService,
} from "../src";
import { applyMigration, createTestD1, seedTenants } from "./helpers/d1";

const disposals: Array<() => Promise<void>> = [];
const now = new Date("2026-08-28T00:00:00.000Z");

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

function context(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    workspaceId: "ws-1",
    userId: "user-1",
    role: "owner",
    capabilities: new Set(["notes.write"]),
    ...overrides,
  };
}

async function setup() {
  const test = await createTestD1({ through: 21 });
  disposals.push(test.dispose);
  await seedTenants(test.db);
  await applyMigration(test.db, "../../migrations/0022_ai_note_actions.sql");

  let actionNumber = 0;
  let noteNumber = 0;
  const createActionId = () => `action-${++actionNumber}`;
  const createNoteId = () => `seed-note-${++noteNumber}`;
  const clock = () => now;
  const repository = new D1AiToolRepository(test.db);
  const noteService = new NoteService(new D1NoteRepository(test.db), { createId: createNoteId, clock });
  const databaseRepository = new D1DatabaseRepository(test.db, { clock, createId: () => "database-1" });
  const taxonomyRepository = new D1TaxonomyRepository(test.db, () => "folder-1");
  const orchestrator = new AiToolOrchestrator({
    repository,
    createId: createActionId,
    clock,
    assertFreshPermission: () => undefined,
  });
  const execution = {
    noteService,
    knowledgeService: { createReminder: async () => ({}) },
    collaborationRepository: { createNotification: async () => ({}) },
    emailOutboxRepository: { enqueue: async () => ({ id: "outbox-1", action_id: "action-1", to_email: "user@example.test", subject: "", body_text: "" }) },
  };
  return { test, repository, noteService, databaseRepository, taxonomyRepository, orchestrator, execution };
}

async function createSeedNote(noteService: NoteService, noteContext: WorkspaceContext = context(), input: { title?: string; content?: string; database_id?: string | null } = {}) {
  return noteService.create({ ...noteContext, targetId: input.title ? `seed-${input.title}` : undefined }, {
    title: input.title ?? "Original title",
    content: input.content ?? "Original body",
    database_id: input.database_id ?? null,
  });
}

describe("AI note lifecycle actions", () => {
  it("normalizes lifecycle proposals and keeps non-create actions confirmation-gated", async () => {
    const { orchestrator, noteService } = await setup();
    const note = await createSeedNote(noteService);

    const update = await orchestrator.propose(context(), {
      name: "update_note",
      arguments: {
        target_note_id: note.id,
        base_revision: note.revision,
        patch: { title: "  Renamed  ", content: "Updated body" },
      },
    });
    const archive = await orchestrator.propose(context(), {
      name: "archive_note",
      arguments: { target_note_id: note.id, base_revision: note.revision },
    });

    expect(update).toMatchObject({
      tool: "update_note",
      requires_confirmation: true,
      input: {
        target_note_id: note.id,
        base_revision: 1,
        patch: { title: "Renamed", content: "Updated body" },
      },
    });
    expect(archive).toMatchObject({
      tool: "archive_note",
      requires_confirmation: true,
      input: { target_note_id: note.id, base_revision: 1, patch: { status: "archived" } },
    });
  });

  it("keeps trusted reminders and notifications confirmation-gated", async () => {
    const { orchestrator } = await setup();
    const reminder = await orchestrator.propose(context(), {
      name: "create_reminder",
      arguments: { title: "Follow up", remind_at: "2026-08-29T09:00:00.000Z" },
    }, { trusted: true });
    const notification = await orchestrator.propose(context(), {
      name: "create_notification",
      arguments: { title: "Notice", body_text: "Review this" },
    }, { trusted: true });

    expect(reminder.requires_confirmation).toBe(true);
    expect(notification.requires_confirmation).toBe(true);
  });

  it("rejects unknown top-level and patch fields instead of silently dropping them", async () => {
    const { orchestrator, noteService } = await setup();
    const note = await createSeedNote(noteService);

    await expect(orchestrator.propose(context(), {
      name: "update_note",
      arguments: {
        target_note_id: note.id,
        base_revision: note.revision,
        patch: { title: "Renamed", ignored: "drop-me" },
      },
    })).rejects.toMatchObject({ code: "AI_ACTION_TOOL_INVALID", status: 400 });

    await expect(orchestrator.propose(context(), {
      name: "delete_note",
      arguments: { target_note_id: note.id, base_revision: note.revision, ignored: true },
    })).rejects.toMatchObject({ code: "AI_ACTION_TOOL_INVALID", status: 400 });

    await expect(orchestrator.propose(context(), {
      name: "create_note",
      arguments: null,
    })).rejects.toMatchObject({ code: "AI_ACTION_TOOL_INVALID", status: 400 });
  });

  it("executes a trusted create once and returns a deterministic replay result", async () => {
    const { orchestrator, execution, test } = await setup();
    const proposal = await orchestrator.propose(context(), {
      name: "create_note",
      arguments: { title: "Trusted note", content: "Created without a confirmation dialog" },
    }, { trusted: true });

    expect(proposal.requires_confirmation).toBe(false);
    const first = await orchestrator.execute(context(), proposal.action_id, execution);
    const replay = await orchestrator.execute(context(), proposal.action_id, execution);

    const expected: AiActionExecutionResult = {
      action_id: proposal.action_id,
      status: "executed",
      entity_id: `create-note:${proposal.action_id}`,
      revision: 1,
    };
    expect(first).toEqual(expected);
    expect(replay).toEqual(expected);
    const count = await test.db.prepare("SELECT COUNT(*) AS count FROM notes WHERE id = ?")
      .bind(`create-note:${proposal.action_id}`).first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("replays an immutable update result after the note changes again", async () => {
    const { noteService } = await setup();
    const note = await createSeedNote(noteService);

    const first = await noteService.update(
      { ...context(), targetId: "ai-update-replay" },
      note.id,
      { base_revision: 1, title: "AI title" },
    );
    await noteService.update(context(), note.id, { base_revision: 2, title: "Human title" });

    await expect(noteService.update(
      { ...context(), targetId: "ai-update-replay" },
      note.id,
      { base_revision: 1, title: "AI title" },
    )).resolves.toEqual(first);
  });

  it("rejects an idempotency key reused with a different base revision", async () => {
    const { noteService } = await setup();
    const note = await createSeedNote(noteService);

    await noteService.update(
      { ...context(), targetId: "ai-update-revision-mismatch" },
      note.id,
      { base_revision: 1, title: "AI title" },
    );

    await expect(noteService.update(
      { ...context(), targetId: "ai-update-revision-mismatch" },
      note.id,
      { base_revision: 2, title: "AI title" },
    )).rejects.toMatchObject({ code: "NOTE_IDEMPOTENCY_CONFLICT", status: 409 });
  });

  it("replays an update when the same patch fields arrive in a different order", async () => {
    const { noteService } = await setup();
    const note = await createSeedNote(noteService);
    const input = { title: "AI title", content: "AI body" };

    const first = await noteService.update(
      { ...context(), targetId: "ai-update-key-order" },
      note.id,
      { base_revision: 1, content: input.content, title: input.title },
    );
    await noteService.update(context(), note.id, { base_revision: 2, title: "Human title" });

    await expect(noteService.update(
      { ...context(), targetId: "ai-update-key-order" },
      note.id,
      { base_revision: 1, ...input },
    )).resolves.toEqual(first);
  });

  it("replays an immutable create result after its folder is removed", async () => {
    const { noteService, taxonomyRepository, test } = await setup();
    const folder = await taxonomyRepository.createFolder("ws-1", { name: "Temporary" }, now.toISOString());
    expect(folder).not.toBeNull();
    const input = { title: "AI created", content: "Original body", folder_id: folder!.id };

    const first = await noteService.create({ ...context(), targetId: "ai-create-replay" }, input);
    await test.db.prepare("DELETE FROM folders WHERE workspace_id = ? AND id = ?").bind("ws-1", folder!.id).run();

    await expect(noteService.create({ ...context(), targetId: "ai-create-replay" }, input)).resolves.toEqual(first);
  });

  it("retains an update replay snapshot after the note is permanently deleted", async () => {
    const { noteService, test } = await setup();
    const note = await createSeedNote(noteService);
    const targetId = "ai-update-retained-after-delete";
    const first = await noteService.update(
      { ...context(), targetId },
      note.id,
      { base_revision: 1, title: "AI title" },
    );
    const trashed = await noteService.update(context(), note.id, { base_revision: 2, status: "trashed" });
    expect(trashed.status).toBe("trashed");
    await expect(noteService.deletePermanently(context(), note.id, { base_revision: 3 })).resolves.toEqual({ deleted: true });

    await expect(noteService.update(
      { ...context(), targetId },
      note.id,
      { base_revision: 1, title: "AI title" },
    )).resolves.toEqual(first);
    await expect(test.db.prepare(
      "SELECT note_id FROM ai_note_action_idempotency WHERE idempotency_key = ?",
    ).bind(targetId).first()).resolves.toEqual({ note_id: note.id });
  });

  it("updates and moves a note through NoteService with CAS and deterministic replay", async () => {
    const { orchestrator, execution, noteService, taxonomyRepository, test } = await setup();
    const note = await createSeedNote(noteService);
    const folder = await taxonomyRepository.createFolder("ws-1", { name: "Projects" }, now.toISOString());
    expect(folder).not.toBeNull();

    const update = await orchestrator.propose(context(), {
      name: "update_note",
      arguments: {
        target_note_id: note.id,
        base_revision: note.revision,
        patch: { title: "Updated title", content: "Updated body" },
      },
    });
    await orchestrator.confirm(context(), update.action_id, 1);
    const updated = await orchestrator.execute(context(), update.action_id, execution);
    expect(updated).toEqual({ action_id: update.action_id, status: "executed", entity_id: note.id, revision: 2 });
    expect(await orchestrator.execute(context(), update.action_id, execution)).toEqual(updated);
    const revision = await test.db.prepare(
      "SELECT source FROM note_revisions WHERE workspace_id = ? AND note_id = ? AND revision = 2",
    ).bind("ws-1", note.id).first<{ source: string }>();
    expect(revision?.source).toBe("manual");

    const move = await orchestrator.propose(context(), {
      name: "move_note",
      arguments: {
        target_note_id: note.id,
        base_revision: 2,
        patch: { folder_id: folder!.id },
      },
    });
    await orchestrator.confirm(context(), move.action_id, 1);
    const moved = await orchestrator.execute(context(), move.action_id, execution);
    expect(moved).toEqual({ action_id: move.action_id, status: "executed", entity_id: note.id, revision: 3 });
    await expect(noteService.get(context(), note.id)).resolves.toMatchObject({
      title: "Updated title", content: "Updated body", folder_id: folder!.id, revision: 3,
    });
  });

  it("supports archive, trash, restore, and preserves note content and database membership", async () => {
    const { orchestrator, execution, noteService, databaseRepository } = await setup();
    const database = await databaseRepository.createDatabase(context(), { name: "Projects", description: "" });
    const note = await createSeedNote(noteService, context(), { database_id: database.id, content: "Keep this body" });

    const archive = await orchestrator.propose(context(), { name: "archive_note", arguments: { target_note_id: note.id, base_revision: 1 } });
    await orchestrator.confirm(context(), archive.action_id, 1);
    expect(await orchestrator.execute(context(), archive.action_id, execution)).toEqual({ action_id: archive.action_id, status: "executed", entity_id: note.id, revision: 2 });

    const restoreArchived = await orchestrator.propose(context(), { name: "restore_note", arguments: { target_note_id: note.id, base_revision: 2 } });
    await orchestrator.confirm(context(), restoreArchived.action_id, 1);
    expect(await orchestrator.execute(context(), restoreArchived.action_id, execution)).toEqual({ action_id: restoreArchived.action_id, status: "executed", entity_id: note.id, revision: 3 });

    const trash = await orchestrator.propose(context(), { name: "delete_note", arguments: { target_note_id: note.id, base_revision: 3 } });
    await orchestrator.confirm(context(), trash.action_id, 1);
    expect(await orchestrator.execute(context(), trash.action_id, execution)).toEqual({ action_id: trash.action_id, status: "executed", entity_id: note.id, revision: 4 });
    await expect(noteService.get(context(), note.id)).resolves.toMatchObject({ status: "trashed", content: "Keep this body", database_id: database.id, revision: 4 });

    const restoreTrashed = await orchestrator.propose(context(), { name: "restore_note", arguments: { target_note_id: note.id, base_revision: 4 } });
    await orchestrator.confirm(context(), restoreTrashed.action_id, 1);
    expect(await orchestrator.execute(context(), restoreTrashed.action_id, execution)).toEqual({ action_id: restoreTrashed.action_id, status: "executed", entity_id: note.id, revision: 5 });
    await expect(noteService.get(context(), note.id)).resolves.toMatchObject({ status: "active", content: "Keep this body", database_id: database.id, revision: 5 });
  });

  it("records a stable conflict when the target revision changes before execution", async () => {
    const { orchestrator, execution, noteService, repository, test } = await setup();
    const note = await createSeedNote(noteService);
    const update = await orchestrator.propose(context(), {
      name: "update_note",
      arguments: { target_note_id: note.id, base_revision: 1, patch: { title: "AI title" } },
    });
    await orchestrator.confirm(context(), update.action_id, 1);
    await noteService.update(context(), note.id, { base_revision: 1, title: "Human title" });

    await expect(orchestrator.execute(context(), update.action_id, execution)).resolves.toMatchObject({
      action_id: update.action_id,
      status: "conflict",
      error: { code: "AI_ACTION_NOTE_CONFLICT", status: 409 },
    });
    await expect(repository.getOwned("user-1", "ws-1", update.action_id)).resolves.toMatchObject({ status: "conflict" });
    await expect(orchestrator.execute(context(), update.action_id, execution)).resolves.toMatchObject({
      action_id: update.action_id,
      status: "conflict",
      error: { code: "AI_ACTION_NOTE_CONFLICT", status: 409 },
    });
  });

  it("executes one concurrent lifecycle claim and replays the final result for the duplicate", async () => {
    const { orchestrator, execution, noteService, repository, test } = await setup();
    const note = await createSeedNote(noteService);
    const update = await orchestrator.propose(context(), {
      name: "update_note",
      arguments: { target_note_id: note.id, base_revision: 1, patch: { title: "AI title" } },
    });
    await orchestrator.confirm(context(), update.action_id, 1);

    const results = await Promise.allSettled([
      orchestrator.execute(context(), update.action_id, execution),
      orchestrator.execute(context(), update.action_id, execution),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(results.map((result) => result.status === "fulfilled" ? result.value : null)).toEqual([
      { action_id: update.action_id, status: "executed", entity_id: note.id, revision: 2 },
      { action_id: update.action_id, status: "executed", entity_id: note.id, revision: 2 },
    ]);
    await expect(repository.getOwned("user-1", "ws-1", update.action_id)).resolves.toMatchObject({ status: "executed" });
    await expect(noteService.get(context(), note.id)).resolves.toMatchObject({ title: "AI title", revision: 2 });
    await expect(test.db.prepare(
      "SELECT COUNT(*) AS count FROM sync_changes WHERE entity_type = 'note' AND entity_id = ? AND revision = 2",
    ).bind(note.id).first()).resolves.toEqual({ count: 1 });
    await expect(test.db.prepare(
      "SELECT COUNT(*) AS count FROM activity_logs WHERE request_id = ? AND action = 'note.updated'",
    ).bind(update.action_id).first()).resolves.toEqual({ count: 1 });
    await expect(test.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE request_id = ? AND action = 'note.updated'",
    ).bind(update.action_id).first()).resolves.toEqual({ count: 1 });
  });

  it("replays a committed lifecycle side effect while another execution is in progress", async () => {
    const { orchestrator, execution, noteService, repository } = await setup();
    const note = await createSeedNote(noteService);
    const update = await orchestrator.propose(context(), {
      name: "update_note",
      arguments: { target_note_id: note.id, base_revision: 1, patch: { title: "AI title" } },
    });
    await orchestrator.confirm(context(), update.action_id, 1);

    const gatedExecution = {
      ...execution,
      noteService: {
        ...execution.noteService,
        update: async (...args: Parameters<typeof execution.noteService.update>) => {
          const result = await execution.noteService.update(...args);
          if (result.note) await new Promise((resolve) => setTimeout(resolve, 100));
          return result;
        },
      },
    };

    const results = await Promise.allSettled([
      orchestrator.execute(context(), update.action_id, gatedExecution),
      orchestrator.execute(context(), update.action_id, gatedExecution),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(results.map((result) => result.status === "fulfilled" ? result.value : null)).toEqual([
      { action_id: update.action_id, status: "executed", entity_id: note.id, revision: 2 },
      { action_id: update.action_id, status: "executed", entity_id: note.id, revision: 2 },
    ]);
    await expect(repository.getOwned("user-1", "ws-1", update.action_id)).resolves.toMatchObject({ status: "executed" });
  });

  it("persists a fresh-permission conflict raised after confirmation", async () => {
    const { execution, noteService, repository } = await setup();
    const note = await createSeedNote(noteService);
    let stale = false;
    const orchestrator = new AiToolOrchestrator({
      repository,
      createId: () => "fresh-conflict-action",
      clock: () => now,
      assertFreshPermission: () => {
        if (stale) throw new AiToolError("AI_ACTION_NOTE_CONFLICT", "stale target", 409);
      },
    });
    const update = await orchestrator.propose(context(), {
      name: "update_note",
      arguments: { target_note_id: note.id, base_revision: 1, patch: { title: "AI title" } },
    });
    await orchestrator.confirm(context(), update.action_id, 1);
    stale = true;

    await expect(orchestrator.execute(context(), update.action_id, execution)).resolves.toMatchObject({
      action_id: update.action_id,
      status: "conflict",
      error: { code: "AI_ACTION_NOTE_CONFLICT", status: 409 },
    });
    await expect(repository.getOwned("user-1", "ws-1", update.action_id)).resolves.toMatchObject({ status: "conflict" });
  });

  it("rechecks the server-derived write capability before confirmation", async () => {
    const { noteService, repository } = await setup();
    const note = await createSeedNote(noteService);
    const editor = context({ role: "editor", capabilities: new Set(["notes.write"]) });
    const orchestrator = new AiToolOrchestrator({
      repository,
      assertFreshPermission: () => {
        throw Object.assign(new Error("fresh permission denied"), { code: "AI_ACTION_PERMISSION_DENIED", status: 403 });
      },
      clock: () => now,
    });
    const update = await orchestrator.propose(editor, {
      name: "update_note",
      arguments: { target_note_id: note.id, base_revision: 1, patch: { title: "AI title" } },
    });

    await expect(orchestrator.confirm(editor, update.action_id, 1)).rejects.toMatchObject({
      code: "AI_ACTION_PERMISSION_DENIED",
      status: 403,
    });
    await expect(repository.getOwned("user-1", "ws-1", update.action_id)).resolves.toMatchObject({
      status: "proposed",
      revision: 1,
    });
  });

  it("stores only a safe error message for failed note actions", async () => {
    const { orchestrator, execution, repository } = await setup();
    const proposal = await orchestrator.propose(context(), {
      name: "create_note",
      arguments: { title: "Fail safely", content: "Body" },
    });
    await orchestrator.confirm(context(), proposal.action_id, 1);

    await expect(orchestrator.execute(context(), proposal.action_id, {
      ...execution,
      noteService: {
        ...execution.noteService,
        create: async () => { throw Object.assign(new Error("SQLITE private-body-value"), { code: "NOTE_STORAGE_FAILED", status: 500 }); },
      },
    })).resolves.toMatchObject({
      action_id: proposal.action_id,
      status: "failed",
      error: { code: "NOTE_STORAGE_FAILED", status: 500 },
    });

    const stored = await repository.getOwned("user-1", "ws-1", proposal.action_id);
    expect(stored).toMatchObject({ status: "failed", error_code: "NOTE_STORAGE_FAILED" });
    expect(stored?.error_message).toBe("AI action execution failed");
    expect(stored?.error_message).not.toContain("private-body-value");
  });

  it("returns a stable conflict execution result instead of throwing a business error", async () => {
    const { orchestrator, execution, noteService } = await setup();
    const note = await createSeedNote(noteService);
    const proposal = await orchestrator.propose(context(), {
      name: "update_note",
      arguments: { target_note_id: note.id, base_revision: 1, patch: { title: "AI title" } },
    });
    await orchestrator.confirm(context(), proposal.action_id, 1);
    await noteService.update(context(), note.id, { base_revision: 1, title: "Human title" });

    await expect(orchestrator.execute(context(), proposal.action_id, execution)).resolves.toMatchObject({
      action_id: proposal.action_id,
      status: "conflict",
      error: { code: "AI_ACTION_NOTE_CONFLICT", status: 409 },
    });
  });

  it("reports a lease wait timeout as retryable in-progress work", async () => {
    vi.useFakeTimers({ now });
    try {
      const proposal = {
        action_id: "action-in-progress",
        user_id: "user-1",
        workspace_id: "ws-1",
        tool: "update_note" as const,
        input: { target_note_id: "note-1", base_revision: 1, patch: { title: "AI title" } },
        status: "executing" as const,
        requires_confirmation: true,
        idempotency_key: "ai-action:user-1:action-in-progress",
        revision: 3,
        expires_at: "2099-08-29T00:00:00.000Z",
        created_at: now,
        updated_at: now,
        execution_result: null,
        error_code: null,
        error_message: null,
        error_status: null,
        execution_claim_token: "claim-token",
        execution_lease_until: "2099-08-29T00:00:00.000Z",
      };
      const repository = { getOwned: vi.fn(async () => proposal) };
      const orchestrator = new AiToolOrchestrator({
        repository: repository as never,
        assertFreshPermission: () => undefined,
        clock: () => new Date(now),
      });

      const pending = orchestrator.execute(context(), proposal.action_id, {} as never);
      const result = expect(pending).rejects.toMatchObject({ code: "AI_ACTION_IN_PROGRESS", retryable: true });
      await vi.advanceTimersByTimeAsync(8_001);

      await result;
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an expired trusted create as expired instead of conflicted", async () => {
    const { repository, execution } = await setup();
    let current = new Date(now);
    const orchestrator = new AiToolOrchestrator({
      repository,
      assertFreshPermission: () => undefined,
      createId: () => "expired-trusted-create",
      clock: () => new Date(current),
    });
    const proposal = await orchestrator.propose(context(), {
      name: "create_note",
      arguments: { title: "Expired", content: "Body" },
    }, { trusted: true });
    current = new Date(now.getTime() + AI_ACTION_PROPOSAL_TTL_MS + 1);

    await expect(orchestrator.execute(context(), proposal.action_id, execution)).rejects.toMatchObject({
      code: "AI_ACTION_EXPIRED",
      status: 409,
    });
    await expect(repository.getOwned("user-1", "ws-1", proposal.action_id)).resolves.toMatchObject({ status: "expired" });
  });

  it("keeps a completion CAS miss retryable while the action is still executing", async () => {
    vi.useFakeTimers({ now });
    try {
      const confirmed = {
        action_id: "completion-cas-miss",
        user_id: "user-1",
        workspace_id: "ws-1",
        tool: "create_note" as const,
        input: { title: "Roadmap", content: "Body" },
        status: "confirmed" as const,
        requires_confirmation: true,
        idempotency_key: "ai-action:user-1:completion-cas-miss",
        revision: 2,
        expires_at: "2099-08-29T00:00:00.000Z",
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        execution_result: null,
        error_code: null,
        error_message: null,
        error_status: null,
        execution_claim_token: null,
        execution_lease_until: null,
      };
      const executing = {
        ...confirmed,
        status: "executing" as const,
        revision: 3,
        execution_claim_token: "claim-token",
        execution_lease_until: "2099-08-29T00:00:00.000Z",
      };
      const repository = {
        getOwned: vi.fn(async () => executing),
        claimExecution: vi.fn(async () => executing),
        markCompleted: vi.fn(async () => null),
      };
      repository.getOwned.mockResolvedValueOnce(confirmed).mockResolvedValue(executing);
      const orchestrator = new AiToolOrchestrator({
        repository: repository as never,
        assertFreshPermission: () => undefined,
        clock: () => new Date(now),
      });
      const pending = orchestrator.execute(context(), confirmed.action_id, {
        noteService: {
          create: async () => ({ id: "create-note:completion-cas-miss", revision: 1 }),
        },
      } as never);
      const result = expect(pending).rejects.toMatchObject({ code: "AI_ACTION_IN_PROGRESS", retryable: true });
      await vi.advanceTimersByTimeAsync(8_001);

      await result;
    } finally {
      vi.useRealTimers();
    }
  });
});
