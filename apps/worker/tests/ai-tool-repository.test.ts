import { afterEach, describe, expect, it } from "vitest";

import { D1AiToolRepository } from "../src";
import { createTestD1, seedTenants } from "./helpers/d1";

const disposals: Array<() => Promise<void>> = [];
const now = "2026-08-25T00:00:00.000Z";
const later = "2026-08-25T00:05:00.000Z";
const future = "2026-08-25T00:10:00.000Z";

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

async function setupRepository() {
  const testD1 = await createTestD1({ through: 22 });
  disposals.push(testD1.dispose);
  await seedTenants(testD1.db);
  const repository = new D1AiToolRepository(testD1.db);
  return { db: testD1.db, repository };
}

describe("D1AiToolRepository", () => {
  it("stores proposals with the exact idempotency key and binds ownership on reads", async () => {
    const { db, repository } = await setupRepository();

    await repository.insertProposal({
      actionId: "action-1",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "send_email",
      input: {
        to_email: "user@example.test",
        subject: "Quarterly update",
        body_text: "Only the outbox may persist this body.",
      },
      expiresAt: future,
      now,
    });

    const owned = await repository.getOwned("user-1", "ws-1", "action-1");
    expect(owned).toMatchObject({
      action_id: "action-1",
      tool: "send_email",
      status: "proposed",
      revision: 1,
      input: {
        to_email: "user@example.test",
        subject: "Quarterly update",
        body_text: "Only the outbox may persist this body.",
      },
    });
    await expect(repository.getOwned("user-2", "ws-1", "action-1")).resolves.toBeNull();
    await expect(repository.getOwned("user-1", "ws-2", "action-1")).resolves.toBeNull();

    const row = await db.prepare(
      `SELECT idempotency_key, input_json
       FROM ai_action_proposals
       WHERE id = ? AND user_id = ? AND workspace_id = ?`,
    ).bind("action-1", "user-1", "ws-1").first<{ idempotency_key: string; input_json: string }>();

    expect(row).toEqual({
      idempotency_key: "ai-action:user-1:action-1",
      input_json: JSON.stringify({
        to_email: "user@example.test",
        subject: "Quarterly update",
        body_text: "Only the outbox may persist this body.",
      }),
    });
  });

  it("claims confirmation only once for the owned pending proposal revision", async () => {
    const { db, repository } = await setupRepository();

    await repository.insertProposal({
      actionId: "action-2",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "create_notification",
      input: { title: "System", body_text: "Rotate the on-call owner." },
      expiresAt: future,
      now,
    });

    await expect(repository.claimConfirmation({
      userId: "user-1",
      workspaceId: "ws-1",
      actionId: "action-2",
      baseRevision: 1,
      now: later,
    })).resolves.toMatchObject({ action_id: "action-2", status: "confirmed", revision: 2 });

    await expect(repository.claimConfirmation({
      userId: "user-1",
      workspaceId: "ws-1",
      actionId: "action-2",
      baseRevision: 1,
      now: later,
    })).resolves.toBeNull();

    await repository.insertProposal({
      actionId: "action-3",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "create_note",
      input: { title: "Old note", content: "expired" },
      expiresAt: now,
      now,
    });

    await expect(repository.claimConfirmation({
      userId: "user-1",
      workspaceId: "ws-1",
      actionId: "action-3",
      baseRevision: 1,
      now: later,
    })).resolves.toMatchObject({ action_id: "action-3", status: "expired", revision: 2 });

    await expect(repository.claimConfirmation({
      userId: "user-1",
      workspaceId: "ws-1",
      actionId: "action-3",
      baseRevision: 1,
      now: later,
    })).resolves.toBeNull();

    const rows = await db.prepare(
      `SELECT id, status, revision
       FROM ai_action_proposals
       WHERE id IN ('action-2', 'action-3')
       ORDER BY id`,
    ).all<{ id: string; status: string; revision: number }>();

    expect(rows.results).toEqual([
      { id: "action-2", status: "confirmed", revision: 2 },
      { id: "action-3", status: "expired", revision: 2 },
    ]);
  });

  it("claims execution exclusively and can recover an expired execution lease", async () => {
    const { db, repository } = await setupRepository();
    await repository.insertProposal({
      actionId: "action-execution-lease",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "create_note",
      input: { title: "Lease", content: "Body" },
      expiresAt: future,
      now,
    });
    await repository.claimConfirmation({
      userId: "user-1", workspaceId: "ws-1", actionId: "action-execution-lease", baseRevision: 1, now,
    });

    const first = await repository.claimExecution({
      userId: "user-1", workspaceId: "ws-1", actionId: "action-execution-lease", baseRevision: 2, now,
    });
    expect(first).toMatchObject({ status: "executing", revision: 3 });
    expect(first?.execution_claim_token).toEqual(expect.any(String));
    await expect(repository.claimExecution({
      userId: "user-1", workspaceId: "ws-1", actionId: "action-execution-lease", baseRevision: 3, now,
    })).resolves.toBeNull();

    await db.prepare(
      "UPDATE ai_action_proposals SET execution_lease_until = ? WHERE id = ?",
    ).bind("2020-01-01T00:00:00.000Z", "action-execution-lease").run();
    const recovered = await repository.claimExecution({
      userId: "user-1", workspaceId: "ws-1", actionId: "action-execution-lease", baseRevision: 3, now: later,
    });
    expect(recovered).toMatchObject({ status: "executing", revision: 4 });
    expect(recovered?.execution_claim_token).not.toBe(first?.execution_claim_token);
  });

  it("rejects owned proposals with the expected revision", async () => {
    const { repository } = await setupRepository();

    await repository.insertProposal({
      actionId: "action-4",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "create_note",
      input: { title: "Draft", content: "Body" },
      expiresAt: future,
      now,
    });

    await expect(repository.markRejected({
      userId: "user-1",
      workspaceId: "ws-1",
      actionId: "action-4",
      baseRevision: 1,
      now: later,
    })).resolves.toMatchObject({
      status: "rejected",
      revision: 2,
    });

    await expect(repository.markRejected({
      userId: "user-1",
      workspaceId: "ws-1",
      actionId: "action-4",
      baseRevision: 1,
      now: later,
    })).resolves.toBeNull();
  });

  it("does not insert an email outbox row when the action CAS misses", async () => {
    const { db, repository } = await setupRepository();
    await repository.insertProposal({
      actionId: "action-email-cas",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "send_email",
      input: { to_email: "user@example.test", subject: "Status", body_text: "Body" },
      expiresAt: future,
      now,
    });
    await repository.claimConfirmation({
      userId: "user-1",
      workspaceId: "ws-1",
      actionId: "action-email-cas",
      baseRevision: 1,
      now: later,
    });
    await db.prepare(
      "UPDATE ai_action_proposals SET revision = 3 WHERE id = 'action-email-cas' AND revision = 2",
    ).run();

    await expect(repository.completeEmailAction({
      userId: "user-1",
      workspaceId: "ws-1",
      actionId: "action-email-cas",
      baseRevision: 2,
      now: later,
    }, {
      actionId: "action-email-cas",
      userId: "user-1",
      workspaceId: "ws-1",
      toEmail: "user@example.test",
      subject: "Status",
      bodyText: "Body",
      now: later,
    })).resolves.toBeNull();
    await expect(db.prepare(
      "SELECT COUNT(*) AS count FROM ai_email_outbox WHERE action_id = 'action-email-cas'",
    ).first<{ count: number }>()).resolves.toEqual({ count: 0 });
  });
});
