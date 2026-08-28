import { describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "@nexus/contracts";
import {
  AiOrganizationTools,
  AiToolOrchestrator,
  D1AiToolRepository,
  D1DatabaseRepository,
  D1KnowledgeRepository,
  D1ReminderRepository,
  D1TaxonomyRepository,
  KnowledgeService,
  NoteService,
  D1NoteRepository,
} from "../src";
import { applyMigration, createTestD1, seedTenants } from "./helpers/d1";

function context(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    workspaceId: "ws-1",
    userId: "user-1",
    role: "owner",
    capabilities: new Set(["notes.write", "databases.write"]),
    ...overrides,
  };
}

async function setup() {
  const test = await createTestD1({ through: 23 });
  await seedTenants(test.db);
  let actionNumber = 0;
  const repository = new D1AiToolRepository(test.db);
  const services = {
    knowledge: {
      createFolder: vi.fn(async () => ({ id: "folder-1", revision: 1 })),
      setNoteTags: vi.fn(async () => undefined),
      setNoteTagsBatch: vi.fn(async (_context, noteIds: string[]) => ({ entity_ids: noteIds })),
    },
    databases: {
      createRecord: vi.fn(async () => ({ id: "record-1", revision: 1 })),
      updateRecord: vi.fn(async () => ({ id: "record-1", revision: 2 })),
      applyTemplate: vi.fn(async () => ({ items: [{ id: "record-1", revision: 2 }] })),
    },
  };
  const organization = new AiOrganizationTools(services);
  const orchestrator = new AiToolOrchestrator({
    repository,
    createId: () => `action-${++actionNumber}`,
    clock: () => new Date("2026-08-28T00:00:00.000Z"),
    assertFreshPermission: () => undefined,
  });
  const execution = {
    noteService: {
      create: vi.fn(),
      update: vi.fn(),
      get: vi.fn(),
    },
    knowledgeService: {
      createReminder: vi.fn(),
    },
    collaborationRepository: {
      createNotification: vi.fn(),
    },
    emailOutboxRepository: {
      enqueue: vi.fn(),
    },
    organization,
    requestId: "request-1",
  };
  return { test, orchestrator, organization, services, execution };
}

describe("AI organization and database actions", () => {
  it("upgrades populated AI action tables without losing proposals or email outbox rows", async () => {
    const test = await createTestD1({ through: 22 });
    try {
      await seedTenants(test.db);
      await test.db.prepare(
        `INSERT INTO ai_action_proposals
         (id, user_id, workspace_id, tool, input_json, status, idempotency_key, revision, expires_at, created_at, updated_at, requires_confirmation)
         VALUES ('action-existing', 'user-1', 'ws-1', 'create_note', '{"title":"Keep","content":""}', 'executed',
           'ai-action:user-1:action-existing', 3, '2026-08-29T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z', 1)`,
      ).run();
      await test.db.prepare(
        `INSERT INTO ai_email_outbox
         (id, action_id, user_id, workspace_id, to_email, subject, body_text, status, attempt_count, available_at, created_at, updated_at)
         VALUES ('outbox-existing', 'action-existing', 'user-1', 'ws-1', 'one@example.test', 'Keep', 'Body', 'sent', 1,
           '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z')`,
      ).run();

      await applyMigration(test.db, "../../migrations/0023_ai_organization_actions.sql");

      expect(await test.db.prepare("SELECT tool, status, revision FROM ai_action_proposals WHERE id = 'action-existing'").first())
        .toMatchObject({ tool: "create_note", status: "executed", revision: 3 });
      expect(await test.db.prepare("SELECT action_id, status FROM ai_email_outbox WHERE id = 'outbox-existing'").first())
        .toMatchObject({ action_id: "action-existing", status: "sent" });
      expect((await test.db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
      await expect(test.db.prepare(
        `INSERT INTO ai_action_proposals
         (id, user_id, workspace_id, tool, input_json, status, idempotency_key, revision, expires_at, created_at, updated_at, requires_confirmation)
         VALUES ('action-folder', 'user-1', 'ws-1', 'create_folder', '{"name":"Projects"}', 'proposed',
           'ai-action:user-1:action-folder', 1, '2026-08-29T00:00:00.000Z', '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:00.000Z', 1)`,
      ).run()).resolves.toBeDefined();
    } finally {
      await test.dispose();
    }
  });

  it("normalizes all organization tools and keeps them confirmation-gated in trusted mode", async () => {
    const { test, orchestrator } = await setup();
    try {
      const proposals = await orchestrator.proposeMany(context(), [
        { name: "create_folder", arguments: { name: " Projects ", parent_id: null } },
        { name: "apply_tag", arguments: { target_note_ids: ["note-1", "note-1"], tag_ids: ["tag-1"] } },
        { name: "create_database_record", arguments: { database_id: "db-1", base_revision: 1, note_id: null, values: { "prop-1": "One" } } },
        { name: "update_database_record", arguments: { database_id: "db-1", record_id: "record-1", base_revision: 3, values: { "prop-1": "Two" } } },
        { name: "apply_template", arguments: { database_id: "db-1", template_id: "template-1", base_revision: 1, records: [{ record_id: "record-1", base_revision: 3 }] } },
      ], { trusted: true });

      expect(proposals.map((proposal) => proposal.tool)).toEqual([
        "create_folder", "apply_tag", "create_database_record", "update_database_record", "apply_template",
      ]);
      expect(proposals.every((proposal) => proposal.requires_confirmation)).toBe(true);
      expect(proposals[1]?.input).toMatchObject({ target_note_ids: ["note-1"], tag_ids: ["tag-1"] });
      expect(proposals[3]?.input).toMatchObject({ database_id: "db-1", record_id: "record-1", base_revision: 3 });
    } finally {
      await test.dispose();
    }
  });

  it("executes confirmed organization actions through the scoped service port", async () => {
    const { test, orchestrator, services, execution } = await setup();
    try {
      const proposal = await orchestrator.propose(context(), {
        name: "create_database_record",
        arguments: { database_id: "db-1", base_revision: 1, values: { "prop-1": "One" } },
      });
      await orchestrator.confirm(context(), proposal.action_id, 1);
      await expect(orchestrator.execute(context(), proposal.action_id, execution)).resolves.toMatchObject({
        action_id: proposal.action_id,
        status: "executed",
        entity_id: "record-1",
        revision: 1,
      });
      expect(services.databases.createRecord).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "ws-1", userId: "user-1" }),
        "db-1",
        expect.objectContaining({ note_id: null, values: { "prop-1": "One" } }),
        1,
      );
    } finally {
      await test.dispose();
    }
  });

  it("rejects unknown organization fields and batches over one hundred entities", async () => {
    const { test, orchestrator } = await setup();
    try {
      await expect(orchestrator.propose(context(), {
        name: "update_database_record",
        arguments: { database_id: "db-1", record_id: "record-1", base_revision: 1, values: {}, surprise: true },
      })).rejects.toMatchObject({ code: "AI_ACTION_TOOL_INVALID", status: 400 });
      await expect(orchestrator.propose(context(), {
        name: "apply_template",
        arguments: {
          database_id: "db-1",
          template_id: "template-1",
          base_revision: 1,
          records: Array.from({ length: 101 }, (_, index) => ({ record_id: `record-${index}`, base_revision: 1 })),
        },
      })).rejects.toMatchObject({ code: "AI_ACTION_TOOL_INVALID", status: 400 });
    } finally {
      await test.dispose();
    }
  });

  it("keeps database type and field permissions authoritative during execution", async () => {
    const test = await createTestD1({ through: 23 });
    try {
      await seedTenants(test.db);
      const repository = new D1DatabaseRepository(test.db, {
        clock: () => new Date("2026-08-28T00:00:00.000Z"),
      });
      const owner = context();
      const editor = context({ userId: "user-2", role: "editor" });
      await test.db.prepare(
        "INSERT INTO workspace_members (workspace_id, user_id, role, joined_at, updated_at) VALUES ('ws-1', 'user-2', 'editor', ?, ?)",
      ).bind("2026-08-28T00:00:00.000Z", "2026-08-28T00:00:00.000Z").run();
      const database = await repository.createDatabase(owner, { name: "Projects", description: "" });
      const count = await repository.createProperty(owner, database.id, { name: "Count", type: "number", config: {}, position: 0 });
      await repository.setFieldPermission(owner, database.id, count.id, {
        subject_type: "user", subject_id: "user-2", can_read: true, can_write: false, base_revision: 1,
      });
      const organization = new AiOrganizationTools({
        knowledge: { createFolder: vi.fn(), setNoteTags: vi.fn(), setNoteTagsBatch: vi.fn() },
        databases: repository,
      });

      await expect(organization.execute(owner, "create_database_record", {
        database_id: database.id, base_revision: database.revision, values: { [count.id]: "not-a-number" },
      }, { actionId: "invalid-type" })).rejects.toMatchObject({ code: "INVALID_FIELD_VALUE", details: { property_id: count.id } });
      await expect(organization.execute(editor, "create_database_record", {
        database_id: database.id, base_revision: database.revision, values: { [count.id]: 2 },
      }, { actionId: "denied-field" })).rejects.toMatchObject({ code: "FIELD_WRITE_DENIED", details: { property_id: count.id } });
      await expect(organization.execute(owner, "create_database_record", {
        database_id: database.id, base_revision: database.revision + 1, values: { [count.id]: 2 },
      }, { actionId: "stale-database" })).rejects.toMatchObject({ code: "REVISION_CONFLICT", status: 409 });
      const stored = await test.db.prepare("SELECT COUNT(*) AS count FROM database_records WHERE workspace_id = 'ws-1'").first<{ count: number }>();
      expect(stored?.count).toBe(0);
    } finally {
      await test.dispose();
    }
  });

  it("rolls back an entire template action when one target revision is stale", async () => {
    const test = await createTestD1({ through: 23 });
    try {
      await seedTenants(test.db);
      const repository = new D1DatabaseRepository(test.db, { clock: () => new Date("2026-08-28T00:00:00.000Z") });
      const database = await repository.createDatabase(context(), { name: "Projects", description: "" });
      const status = await repository.createProperty(context(), database.id, {
        name: "Status", type: "select", config: { options: [{ id: "todo", name: "Todo", color: "" }, { id: "done", name: "Done", color: "" }] }, position: 0,
      });
      const first = await repository.createRecord(context(), database.id, { note_id: null, values: { [status.id]: "todo" } });
      const second = await repository.createRecord(context(), database.id, { note_id: null, values: { [status.id]: "todo" } });
      const template = await repository.createTemplate(context(), database.id, { name: "Done", default_values: { [status.id]: "done" } });
      const organization = new AiOrganizationTools({
        knowledge: { createFolder: vi.fn(), setNoteTags: vi.fn(), setNoteTagsBatch: vi.fn() },
        databases: repository,
      });

      await expect(organization.execute(context(), "apply_template", {
        database_id: database.id,
        template_id: template.id,
        base_revision: template.revision + 1,
        records: [{ record_id: first.id, base_revision: 1 }, { record_id: second.id, base_revision: 1 }],
      }, { actionId: "stale-template" })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      await test.db.prepare(
        `CREATE TRIGGER ai_template_race AFTER UPDATE ON database_records
         WHEN NEW.id = '${first.id}'
         BEGIN
           UPDATE database_templates SET revision = revision + 1 WHERE id = '${template.id}';
         END`,
      ).run();
      await expect(organization.execute(context(), "apply_template", {
        database_id: database.id,
        template_id: template.id,
        base_revision: template.revision,
        records: [{ record_id: first.id, base_revision: 1 }, { record_id: second.id, base_revision: 1 }],
      }, { actionId: "template-race" })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      await test.db.prepare("DROP TRIGGER ai_template_race").run();
      await expect(organization.execute(context(), "apply_template", {
        database_id: database.id,
        template_id: template.id,
        base_revision: template.revision,
        records: [{ record_id: first.id, base_revision: 1 }, { record_id: second.id, base_revision: 99 }],
      }, { actionId: "template-rollback" })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      expect((await repository.getRecord(context(), database.id, first.id)).values[status.id]).toBe("todo");
      expect((await repository.getRecord(context(), database.id, second.id)).values[status.id]).toBe("todo");
    } finally {
      await test.dispose();
    }
  });

  it("applies tags to a bounded note batch atomically", async () => {
    const test = await createTestD1({ through: 23 });
    try {
      await seedTenants(test.db);
      const taxonomy = new D1TaxonomyRepository(test.db);
      const knowledge = new KnowledgeService({
        search: (...args) => new D1KnowledgeRepository(test.db).search(...args),
        listSavedSearches: (...args) => new D1KnowledgeRepository(test.db).listSavedSearches(...args),
        createSavedSearch: (...args) => new D1KnowledgeRepository(test.db).createSavedSearch(...args),
        deleteSavedSearch: (...args) => new D1KnowledgeRepository(test.db).deleteSavedSearch(...args),
        getCalendarFeed: (...args) => new D1KnowledgeRepository(test.db).getCalendarFeed(...args),
        listFolders: (...args) => taxonomy.listFolders(...args), createFolder: (...args) => taxonomy.createFolder(...args),
        listTags: (...args) => taxonomy.listTags(...args), listNoteTags: (...args) => taxonomy.listNoteTags(...args),
        createTag: (...args) => taxonomy.createTag(...args), setNoteTags: (...args) => taxonomy.setNoteTags(...args),
        setNoteTagsBatch: (...args) => taxonomy.setNoteTagsBatch(...args),
        setNoteLinks: (...args) => taxonomy.setNoteLinks(...args), listNoteLinks: (...args) => taxonomy.listNoteLinks(...args),
        listBacklinks: (...args) => taxonomy.listBacklinks(...args), getGraph: vi.fn(),
        listReminders: (...args) => new D1ReminderRepository(test.db).listReminders(...args),
        listReminderPage: (...args) => new D1ReminderRepository(test.db).listReminderPage(...args),
        createReminder: (...args) => new D1ReminderRepository(test.db).createReminder(...args),
        updateReminder: (...args) => new D1ReminderRepository(test.db).updateReminder(...args),
        snoozeReminder: (...args) => new D1ReminderRepository(test.db).snoozeReminder(...args),
        deleteReminder: (...args) => new D1ReminderRepository(test.db).deleteReminder(...args),
        getReminder: (...args) => new D1ReminderRepository(test.db).getReminder(...args),
      });
      const notes = new NoteService(new D1NoteRepository(test.db));
      const first = await notes.create(context(), { title: "One", content: "" });
      const tag = await knowledge.createTag(context(), { name: "Project", color: "" });
      const organization = new AiOrganizationTools({ knowledge, databases: {} as never });

      await expect(organization.execute(context(), "apply_tag", {
        target_note_ids: [first.id, "missing-note"], tag_ids: [tag.id],
      }, { actionId: "tag-batch" })).rejects.toMatchObject({ code: "NOTE_NOT_FOUND" });
      expect(await knowledge.listNoteTags(context(), first.id)).toEqual([]);
    } finally {
      await test.dispose();
    }
  });

  it("replays a deterministic folder create without producing a duplicate", async () => {
    const test = await createTestD1({ through: 23 });
    try {
      await seedTenants(test.db);
      const taxonomy = new D1TaxonomyRepository(test.db);
      const knowledge = {
        createFolder: (folderContext: { workspaceId: string; userId: string; targetId?: string }, input: { name: string }) =>
          new KnowledgeService({
            search: vi.fn(), listSavedSearches: vi.fn(), createSavedSearch: vi.fn(), deleteSavedSearch: vi.fn(),
            listFolders: (...args) => taxonomy.listFolders(...args), createFolder: (...args) => taxonomy.createFolder(...args),
            listTags: vi.fn(), listNoteTags: vi.fn(), createTag: vi.fn(), setNoteTags: vi.fn(), setNoteTagsBatch: vi.fn(),
            setNoteLinks: vi.fn(), listNoteLinks: vi.fn(), listBacklinks: vi.fn(), getGraph: vi.fn(),
            listReminders: vi.fn(), listReminderPage: vi.fn(), createReminder: vi.fn(), updateReminder: vi.fn(),
            snoozeReminder: vi.fn(), deleteReminder: vi.fn(), getReminder: vi.fn(), getCalendarFeed: vi.fn(),
          }).createFolder(folderContext, input),
        setNoteTags: vi.fn(), setNoteTagsBatch: vi.fn(),
      };
      const organization = new AiOrganizationTools({ knowledge, databases: {} as never });

      const first = await organization.execute(context(), "create_folder", { name: "Projects" }, { actionId: "folder-replay" });
      const replay = await organization.execute(context(), "create_folder", { name: "Projects" }, { actionId: "folder-replay" });

      expect(replay).toEqual(first);
      expect(await taxonomy.listFolders("ws-1")).toHaveLength(1);
    } finally {
      await test.dispose();
    }
  });

  it("classifies stale database revisions as an AI action conflict", async () => {
    const { test, orchestrator, execution, organization } = await setup();
    try {
      const proposal = await orchestrator.propose(context(), {
        name: "update_database_record",
        arguments: { database_id: "db-1", record_id: "record-1", base_revision: 1, values: { "prop-1": "Two" } },
      });
      await orchestrator.confirm(context(), proposal.action_id, 1);
      const staleOrganization = {
        execute: vi.fn(async () => {
          throw Object.assign(new Error("stale"), { code: "REVISION_CONFLICT", status: 409 });
        }),
      } as unknown as typeof organization;

      await expect(orchestrator.execute(context(), proposal.action_id, {
        ...execution, organization: staleOrganization,
      })).resolves.toMatchObject({
        action_id: proposal.action_id,
        status: "conflict",
        error: { code: "AI_ACTION_DATABASE_CONFLICT", status: 409 },
      });
    } finally {
      await test.dispose();
    }
  });

  it("replays a deterministic database record create after the D1 commit", async () => {
    const test = await createTestD1({ through: 23 });
    try {
      await seedTenants(test.db);
      const repository = new D1DatabaseRepository(test.db, { clock: () => new Date("2026-08-28T00:00:00.000Z") });
      const database = await repository.createDatabase(context(), { name: "Projects", description: "" });
      const title = await repository.createProperty(context(), database.id, { name: "Title", type: "text", config: {}, position: 0 });
      const organization = new AiOrganizationTools({
        knowledge: { createFolder: vi.fn(), setNoteTags: vi.fn(), setNoteTagsBatch: vi.fn() },
        databases: repository,
      });
      const input = { database_id: database.id, base_revision: database.revision, values: { [title.id]: "One" } };

      const first = await organization.execute(context(), "create_database_record", input, { actionId: "record-replay", requestId: "request-1" });
      const replay = await organization.execute(context(), "create_database_record", input, { actionId: "record-replay", requestId: "request-1" });

      expect(replay).toEqual(first);
      const rows = await repository.listRecords(context(), database.id, { cursor: null, view_id: null, limit: 10 });
      expect(rows.items).toHaveLength(1);
    } finally {
      await test.dispose();
    }
  });
});
