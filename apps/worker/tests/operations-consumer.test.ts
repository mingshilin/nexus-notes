import { afterEach, describe, expect, it, vi } from "vitest";

import type { QueueJob } from "@nexus/contracts";

import { OperationsConsumer, QueueConsumerRouter } from "../src/operations/operations-consumer";
import { D1NoteRepository } from "../src/notes/d1-note-repository";
import { D1OperationsRepository } from "../src/operations/d1-operations-repository";
import { createTestD1, seedTenants } from "./helpers/d1";

const now = "2026-08-23T00:00:00.000Z";
const disposals: Array<() => Promise<void>> = [];

class FakeMessage {
  readonly ack = vi.fn();
  readonly retry = vi.fn();

  constructor(readonly body: unknown, readonly attempts = 1) {}
}

function operationJob(kind: "import" | "export"): QueueJob {
  return {
    job_id: `${kind}-1`,
    kind,
    idempotency_key: `${kind}:ws-1:1`,
    attempt: 1,
    deadline: "2026-08-23T00:15:00.000Z",
    payload: {
      workspace_id: "ws-1",
      user_id: "user-1",
      format: kind === "import" ? "markdown" : "markdown",
      filename: "meeting.md",
      content: "# Imported meeting\n\nKeep this note.",
    },
  };
}

describe("operations queue consumer", () => {
  afterEach(async () => {
    await Promise.all(disposals.splice(0).map((dispose) => dispose()));
  });

  it("routes import and export messages to operations without sending them to OCR", async () => {
    const operations = {
      consume: vi.fn(async () => ({ outcome: "ack" as const })),
    };
    const ocr = { consume: vi.fn(async () => ({ outcome: "ack" as const })) };
    const router = new QueueConsumerRouter(ocr, operations);
    const importMessage = new FakeMessage(operationJob("import"));
    const exportMessage = new FakeMessage(operationJob("export"));

    await expect(router.consume(importMessage)).resolves.toEqual({ outcome: "ack" });
    await expect(router.consume(exportMessage)).resolves.toEqual({ outcome: "ack" });

    expect(operations.consume).toHaveBeenCalledTimes(2);
    expect(ocr.consume).not.toHaveBeenCalled();
  });

  it("acknowledges malformed messages while allowing a valid peer to run", async () => {
    const operations = {
      consume: vi.fn(async () => ({ outcome: "ack" as const })),
    };
    const ocr = { consume: vi.fn(async () => ({ outcome: "ack" as const })) };
    const router = new QueueConsumerRouter(ocr, operations);
    const malformed = new FakeMessage({ kind: "export" });
    const valid = new FakeMessage(operationJob("export"));

    await expect(router.consumeBatch([malformed, valid])).resolves.toEqual([
      { outcome: "ack" },
      { outcome: "ack" },
    ]);

    expect(malformed.ack).toHaveBeenCalledOnce();
    expect(valid.ack).not.toHaveBeenCalled();
    expect(operations.consume).toHaveBeenCalledOnce();
  });

  it("marks an export job complete with a private result file", async () => {
    const repository = {
      claimJob: vi.fn(async () => ({ id: "export-1", workspace_id: "ws-1", user_id: "user-1", kind: "export" as const })),
      completeJob: vi.fn(async () => true),
      failJob: vi.fn(async () => true),
      listNotes: vi.fn(async () => ({ items: [{ id: "note-1", title: "One", content: "Body", revision: 1 }], nextCursor: null })),
    };
    const files = { put: vi.fn(async () => undefined) };
    const consumer = new OperationsConsumer(repository, files, { clock: () => new Date(now) });
    const message = new FakeMessage(operationJob("export"));

    await expect(consumer.consume(message)).resolves.toEqual({ outcome: "ack" });
    expect(files.put).toHaveBeenCalledWith(
      "workspaces/ws-1/operations/export-1.md",
      expect.stringContaining("# One"),
      expect.objectContaining({ httpMetadata: expect.objectContaining({ contentType: "text/markdown; charset=utf-8" }) }),
    );
    expect(repository.completeJob).toHaveBeenCalledWith("ws-1", "export-1", "workspaces/ws-1/operations/export-1.md", now);
    expect(message.ack).toHaveBeenCalledOnce();
  });

  it("imports through the real D1 job claim and creates a tenant-scoped note", async () => {
    const resource = await createTestD1();
    disposals.push(resource.dispose);
    await seedTenants(resource.db);
    const repository = new D1OperationsRepository(resource.db, () => "job-import-1");
    const notes = new D1NoteRepository(resource.db, () => "revision-import-1");
    await repository.createJob({ workspaceId: "ws-1", userId: "user-1" }, {
      kind: "import",
      idempotency_key: "import-1",
      payload: { format: "markdown", filename: "meeting.md", content: "# Meeting\n\nPrivate body" },
    }, now);
    const persisted = await resource.db.prepare("SELECT payload_json FROM queue_outbox WHERE job_kind = 'import'").first<{ payload_json: string }>();
    if (!persisted) throw new Error("Expected import outbox message");
    const message = new FakeMessage(JSON.parse(persisted.payload_json));
    const consumer = new OperationsConsumer(repository, { put: vi.fn(async () => undefined) }, { clock: () => new Date(now), createNote: (input) => notes.createNote(input) });

    await expect(consumer.consume(message)).resolves.toEqual({ outcome: "ack" });
    expect(await resource.db.prepare("SELECT title, content FROM notes WHERE workspace_id = 'ws-1'").first()).toEqual({ title: "Meeting", content: "# Meeting\n\nPrivate body" });
    expect(await resource.db.prepare("SELECT status, error_code FROM beta_jobs WHERE id = 'job-import-1'").first()).toEqual({ status: "complete", error_code: null });
  });

  it("creates one note per non-empty markdown block and derives an ordered title", async () => {
    const created: Array<{ title: string; content: string }> = [];
    const repository = {
      claimJob: vi.fn(async () => ({ id: "import-many", workspace_id: "ws-1", user_id: "user-1", kind: "import" as const })),
      completeJob: vi.fn(async () => true),
      failJob: vi.fn(async () => true),
      listNotes: vi.fn(async () => ({ items: [], nextCursor: null })),
    };
    const job = operationJob("import");
    job.payload.content = "# First note\nFirst body\n\n---\n\n## Second note\nSecond body\n\n---\n\n#\nUntitled body\n\n---\n\n   ";
    const consumer = new OperationsConsumer(repository, { put: vi.fn(async () => undefined) }, {
      clock: () => new Date(now),
      createNote: vi.fn(async (input) => {
        created.push({ title: input.title, content: input.content });
        return input;
      }),
    });

    await expect(consumer.consume(new FakeMessage(job))).resolves.toEqual({ outcome: "ack" });

    expect(created).toEqual([
      { title: "First note", content: "# First note\nFirst body" },
      { title: "Second note", content: "## Second note\nSecond body" },
      { title: "Imported 3", content: "#\nUntitled body" },
    ]);
    expect(repository.completeJob).toHaveBeenCalledWith("ws-1", "import-many", null, now);
    expect(repository.failJob).not.toHaveBeenCalled();
  });

  it("marks a multi-note import failed when a later note cannot be created", async () => {
    const repository = {
      claimJob: vi.fn(async () => ({ id: "import-fails", workspace_id: "ws-1", user_id: "user-1", kind: "import" as const })),
      completeJob: vi.fn(async () => true),
      failJob: vi.fn(async () => true),
      listNotes: vi.fn(async () => ({ items: [], nextCursor: null })),
    };
    const job = operationJob("import");
    job.payload.content = "# First\nbody\n---\n# Second\nbody";
    let attempts = 0;
    const consumer = new OperationsConsumer(repository, { put: vi.fn(async () => undefined) }, {
      clock: () => new Date(now),
      createNote: vi.fn(async (input) => {
        attempts += 1;
        if (attempts === 2) throw Object.assign(new Error("write failed"), { code: "NOTE_CREATE_FAILED" });
        return input;
      }),
    });

    await expect(consumer.consume(new FakeMessage(job))).resolves.toEqual({ outcome: "ack" });

    expect(attempts).toBe(2);
    expect(repository.completeJob).not.toHaveBeenCalled();
    expect(repository.failJob).toHaveBeenCalledWith("ws-1", "import-fails", "NOTE_CREATE_FAILED", now);
  });
});
