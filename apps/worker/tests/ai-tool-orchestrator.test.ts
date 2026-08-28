import { afterEach, describe, expect, it } from "vitest";

import type { WorkspaceContext } from "@nexus/contracts";

import {
  AI_ACTION_PROPOSAL_TTL_MS,
  AiToolOrchestrator,
  D1AiToolRepository,
} from "../src";
import { createTestD1, seedTenants } from "./helpers/d1";

const disposals: Array<() => Promise<void>> = [];
const baseNow = new Date("2026-08-25T00:00:00.000Z");

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

function context(workspaceId = "ws-1", userId = "user-1"): WorkspaceContext {
  return {
    workspaceId,
    userId,
    role: "owner",
    capabilities: new Set(["notes.write", "reminders.write", "notifications.write", "email.write"]),
  };
}

async function setupOrchestrator() {
  const testD1 = await createTestD1({ through: 22 });
  disposals.push(testD1.dispose);
  await seedTenants(testD1.db);

  let currentTime = new Date(baseNow);
  let nextId = 1;
  const clock = () => new Date(currentTime);
  const createId = () => `action-${nextId++}`;
  const seenProposals: Array<{ action_id: string; status: string }> = [];

  const repository = new D1AiToolRepository(testD1.db);
  const orchestrator = new AiToolOrchestrator({
    repository,
    assertFreshPermission: async (_context, proposal) => {
      seenProposals.push({ action_id: proposal.action_id, status: proposal.status });
    },
    createId,
    clock,
  });

  return {
    db: testD1.db,
    repository,
    orchestrator,
    seenProposals,
    advanceBy(ms: number) {
      currentTime = new Date(currentTime.getTime() + ms);
    },
    nowIso() {
      return currentTime.toISOString();
    },
  };
}

describe("AiToolOrchestrator", () => {
  it("rejects a tool call for another workspace before persisting a proposal", async () => {
    const { db, orchestrator } = await setupOrchestrator();

    await expect(orchestrator.propose(context("ws-1"), {
      name: "create_note",
      arguments: { workspace_id: "ws-2", title: "x", content: "y" },
    })).rejects.toMatchObject({ code: "AI_ACTION_WORKSPACE_DENIED" });

    const count = await db.prepare("SELECT COUNT(*) AS count FROM ai_action_proposals").first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("rejects proposals before persistence when the actor lacks the action capability", async () => {
    const { db, orchestrator } = await setupOrchestrator();
    const editor: WorkspaceContext = {
      ...context(),
      role: "editor",
      capabilities: new Set(["email.write"]),
    };

    await expect(orchestrator.propose(editor, {
      name: "create_note",
      arguments: { title: "Should not be proposed", content: "No access" },
    })).rejects.toMatchObject({ code: "AI_ACTION_PERMISSION_DENIED", status: 403 });

    const count = await db.prepare("SELECT COUNT(*) AS count FROM ai_action_proposals").first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("rejects unsupported tools and unknown proposal input keys before persistence", async () => {
    const { db, orchestrator } = await setupOrchestrator();

    await expect(orchestrator.propose(context(), {
      name: "execute_sql",
      arguments: { sql: "DROP TABLE notes" },
    })).rejects.toMatchObject({ code: "AI_ACTION_TOOL_INVALID" });

    await expect(orchestrator.propose(context(), {
      name: "send_email",
      arguments: {
        workspace_id: "ws-1",
        to_email: "user@example.test",
        subject: "Planning",
        body_text: "Sensitive body",
        ignored: "do-not-persist",
      },
    })).rejects.toMatchObject({ code: "AI_ACTION_TOOL_INVALID" });

    const proposal = await orchestrator.propose(context(), {
      name: "send_email",
      arguments: {
        to_email: "user@example.test",
        subject: "Planning",
        body_text: "Sensitive body",
      },
    });

    expect(proposal).toMatchObject({
      action_id: "action-1",
      tool: "send_email",
      requires_confirmation: true,
    });
    expect(Date.parse(proposal.expires_at) - baseNow.getTime()).toBe(AI_ACTION_PROPOSAL_TTL_MS);

    const stored = await db.prepare(
      "SELECT input_json FROM ai_action_proposals WHERE id = ?",
    ).bind("action-1").first<{ input_json: string }>();

    expect(JSON.parse(stored?.input_json ?? "null")).toEqual({
      to_email: "user@example.test",
      subject: "Planning",
      body_text: "Sensitive body",
    });
  });

  it("calls fresh permission checks before confirming and returns the claimed proposal", async () => {
    const { repository, orchestrator, seenProposals } = await setupOrchestrator();
    const proposal = await orchestrator.propose(context(), {
      name: "create_note",
      arguments: {
        title: "Roadmap",
        content: "Outline",
      },
    });

    await expect(orchestrator.confirm(context(), proposal.action_id, 1)).resolves.toMatchObject({
      action_id: proposal.action_id,
      tool: "create_note",
      status: "confirmed",
      revision: 2,
    });

    await expect(orchestrator.confirm(context(), proposal.action_id, 1)).rejects.toMatchObject({
      code: "AI_ACTION_CONFLICT",
    });

    expect(seenProposals).toEqual([
      { action_id: proposal.action_id, status: "proposed" },
    ]);

    await expect(repository.getOwned("user-1", "ws-1", proposal.action_id)).resolves.toMatchObject({
      status: "confirmed",
      revision: 2,
    });
  });

  it("rejects stale and expired confirmations using repository-backed state", async () => {
    const { db, orchestrator, advanceBy, nowIso } = await setupOrchestrator();
    const stale = await orchestrator.propose(context(), {
      name: "create_note",
      arguments: { title: "Roadmap", content: "Outline" },
    });

    await expect(orchestrator.confirm(context(), stale.action_id, 2)).rejects.toMatchObject({
      code: "AI_ACTION_CONFLICT",
    });

    const expired = await orchestrator.propose(context(), {
      name: "create_notification",
      arguments: { title: "Rotate", body_text: "Check the schedule." },
    });
    advanceBy(AI_ACTION_PROPOSAL_TTL_MS + 1);

    await expect(orchestrator.confirm(context(), expired.action_id, 1)).rejects.toMatchObject({
      code: "AI_ACTION_EXPIRED",
    });

    const expiredRow = await db.prepare(
      "SELECT status, updated_at FROM ai_action_proposals WHERE id = ?",
    ).bind(expired.action_id).first<{ status: string; updated_at: string }>();
    expect(expiredRow).toEqual({ status: "expired", updated_at: nowIso() });
  });

  it("denies confirmation when the fresh permission check fails", async () => {
    const testD1 = await createTestD1({ through: 22 });
    disposals.push(testD1.dispose);
    await seedTenants(testD1.db);

    const repository = new D1AiToolRepository(testD1.db);
    let freshPermissionCalls = 0;
    const orchestrator = new AiToolOrchestrator({
      repository,
      assertFreshPermission: async () => {
        freshPermissionCalls += 1;
        throw Object.assign(new Error("fresh permission denied"), { code: "AI_ACTION_PERMISSION_DENIED" });
      },
      createId: () => "action-1",
      clock: () => baseNow,
    });

    const proposal = await orchestrator.propose(context(), {
      name: "create_reminder",
      arguments: {
        title: "Follow up",
        remind_at: "2026-08-25T09:00:00.000Z",
        timezone: "Asia/Shanghai",
      },
    });

    await expect(orchestrator.confirm(context(), proposal.action_id, 1)).rejects.toMatchObject({
      code: "AI_ACTION_PERMISSION_DENIED",
    });
    expect(freshPermissionCalls).toBe(1);
    await expect(repository.getOwned("user-1", "ws-1", proposal.action_id)).resolves.toMatchObject({
      status: "proposed",
      revision: 1,
    });
  });

  it("marks a proposal rejected with the owned revision", async () => {
    const { db, orchestrator, repository } = await setupOrchestrator();
    const proposal = await orchestrator.propose(context(), {
      name: "create_reminder",
      arguments: {
        title: "Follow up",
        remind_at: "2026-08-25T09:00:00.000Z",
        timezone: "Asia/Shanghai",
      },
    });

    await expect(orchestrator.reject(context(), proposal.action_id, 1)).resolves.toEqual({ rejected: true });

    await expect(repository.getOwned("user-1", "ws-1", proposal.action_id)).resolves.toMatchObject({
      status: "rejected",
      revision: 2,
    });
  });
});
