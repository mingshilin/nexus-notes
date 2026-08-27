import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiActionProposal, WorkspaceContext } from "@nexus/contracts";
import { AiChatService } from "../src/ai/ai-chat-service";
import { AiToolOrchestrator, D1AiToolRepository } from "../src";
import { createTestD1, seedTenants } from "./helpers/d1";

const disposals: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

function context(): WorkspaceContext {
  return {
    workspaceId: "ws-1",
    userId: "user-1",
    role: "viewer",
    capabilities: new Set(["notes.write", "reminders.write", "notifications.write", "email.write"]),
  };
}

describe("AI chat tool protocol", () => {
  it("executes bounded read tools before returning an answer with source-aware results", async () => {
    const responses = [
      Response.json({ choices: [{ message: {
        content: null,
        tool_calls: [{ id: "read-call-1", type: "function", function: {
          name: "search_notes",
          arguments: JSON.stringify({ query: "roadmap", limit: 10 }),
        } }],
      } }] }),
      Response.json({ choices: [{ message: { content: "我找到一条相关笔记。" } }] }),
    ];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual([
        "search_notes", "get_note", "list_reminders", "search_databases", "get_database_record",
        "create_note", "create_reminder", "create_notification", "send_email",
      ]);
      const searchNotesTool = body.tools.find((tool: { function: { name: string } }) => tool.function.name === "search_notes");
      expect(searchNotesTool.function.description).toContain("same query and selected-note scope");
      if (body.messages.some((message: { role: string; content?: string }) => message.role === "tool")) {
        expect(body.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "read-call-1" });
        expect(String(body.messages.at(-1).content)).toContain("note-1");
      }
      return responses.shift()!;
    });
    const readTools = {
      execute: vi.fn(async () => ({
        tool: "search_notes",
        items: [{ source_type: "note", source_id: "note-1", workspace_id: "ws-1", title: "Roadmap", excerpt: "Visible", revision: 2, updated_at: "2026-08-28T00:00:00.000Z" }],
        next_cursor: null,
        scope: { workspace_id: "ws-1", selected_only: true },
      })),
    };
    const service = new AiChatService({
      apiUrl: "https://ai.example.test/v1/chat/completions",
      apiKey: "server-only-key",
      model: "beta-model",
      fetchImpl,
    });

    await expect(service.chat(
      { messages: [{ role: "user", content: "查找 roadmap" }] },
      new AbortController().signal,
      {
        readTools,
        readContext: {
          workspaceId: "ws-1",
          userId: "user-1",
          selectedNoteIds: ["note-1"],
          selectedDatabaseIds: [],
          allowWorkspaceSearch: false,
          role: "viewer",
          capabilities: new Set<string>(),
        },
      },
    )).resolves.toMatchObject({
      message: "我找到一条相关笔记。",
      read_results: [expect.objectContaining({ tool: "search_notes" })],
    });
    expect(readTools.execute).toHaveBeenCalledWith(
      "search_notes",
      { query: "roadmap", limit: 10 },
      expect.objectContaining({ workspaceId: "ws-1" }),
      expect.any(AbortSignal),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not expose read tools or accept read calls without an explicit read executor and context", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual([
        "create_note", "create_reminder", "create_notification", "send_email",
      ]);
      return Response.json({ choices: [{ message: { content: "ok", tool_calls: [{ id: "read-1", type: "function", function: { name: "search_notes", arguments: "{}" } }] } }] });
    });
    const service = new AiChatService({ apiUrl: "https://ai.example.test/v1/chat/completions", apiKey: "key", model: "model", fetchImpl });
    await expect(service.chat({ messages: [{ role: "user", content: "查找" }] }, new AbortController().signal))
      .rejects.toMatchObject({ code: "AI_PROVIDER_INVALID_RESPONSE" });
  });

  it("bounds cumulative read results before issuing another provider request", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ choices: [{ message: {
      content: null,
      tool_calls: Array.from({ length: 4 }, (_, index) => ({
        id: `read-${index}`,
        type: "function",
        function: { name: "get_note", arguments: JSON.stringify({ note_id: `note-${index}` }) },
      })),
    } }] }));
    const readTools = {
      execute: vi.fn(async (_tool: string, _input: unknown, _context: unknown, _signal?: AbortSignal) => ({
        tool: "get_note" as const,
        items: [{
          source_type: "note" as const,
          source_id: "note-1",
          workspace_id: "ws-1",
          title: "Large",
          content: "x".repeat(20_000),
          revision: 1,
          updated_at: "2026-08-28T00:00:00.000Z",
        }],
        next_cursor: null,
        scope: { workspace_id: "ws-1", selected_only: true },
      })),
    };
    const service = new AiChatService({ apiUrl: "https://ai.example.test/v1/chat/completions", apiKey: "key", model: "model", fetchImpl });
    await expect(service.chat(
      { messages: [{ role: "user", content: "查找" }] },
      new AbortController().signal,
      {
        readTools,
        readContext: {
          workspaceId: "ws-1", userId: "user-1", selectedNoteIds: ["note-1"], selectedDatabaseIds: [], allowWorkspaceSearch: false,
          role: "viewer", capabilities: new Set<string>(),
        },
      },
    )).rejects.toMatchObject({ code: "AI_PROVIDER_INVALID_RESPONSE" });
    expect(readTools.execute).toHaveBeenCalledTimes(4);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects duplicate provider tool-call IDs before executing a read", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ choices: [{ message: {
      content: null,
      tool_calls: [
        { id: "same", type: "function", function: { name: "get_note", arguments: JSON.stringify({ note_id: "note-1" }) } },
        { id: "same", type: "function", function: { name: "get_note", arguments: JSON.stringify({ note_id: "note-1" }) } },
      ],
    } }] }));
    const service = new AiChatService({ apiUrl: "https://ai.example.test/v1/chat/completions", apiKey: "key", model: "model", fetchImpl });
    await expect(service.chat(
      { messages: [{ role: "user", content: "查找" }] },
      new AbortController().signal,
      {
        readTools: { execute: vi.fn() },
        readContext: {
          workspaceId: "ws-1", userId: "user-1", selectedNoteIds: ["note-1"], selectedDatabaseIds: [], allowWorkspaceSearch: false,
          role: "viewer", capabilities: new Set<string>(),
        },
      },
    )).rejects.toMatchObject({ code: "AI_PROVIDER_INVALID_RESPONSE" });
  });

  it("sends only the fixed tool declarations and no internal credentials to the provider", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "beta-model",
        messages: [{ role: "user", content: "整理我的任务" }],
        stream: false,
        tool_choice: "auto",
      });
      expect(body.tools).toHaveLength(4);
      expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual([
        "create_note",
        "create_reminder",
        "create_notification",
        "send_email",
      ]);
      expect(JSON.stringify(body)).not.toContain("server-only-key");
      return Response.json({ choices: [{ message: { content: "先列出三个最重要的任务。" } }] });
    });

    const service = new AiChatService({
      apiUrl: "https://ai.example.test/v1/chat/completions",
      apiKey: "server-only-key",
      model: "beta-model",
      fetchImpl,
    });

    await expect(service.chat({ messages: [{ role: "user", content: "整理我的任务" }] }, new AbortController().signal))
      .resolves.toEqual({ message: "先列出三个最重要的任务。", model: "beta-model" });
  });

  it("turns provider tool calls into action proposals without breaking legacy text responses", async () => {
    const proposal: AiActionProposal = {
      action_id: "action-1",
      tool: "create_note",
      summary: "创建笔记待确认",
      input: { title: "Roadmap", content: "Outline" },
      requires_confirmation: true,
      expires_at: "2026-08-25T00:10:00.000Z",
    };
    const proposeActions = vi.fn(async () => [proposal]);
    const fetchImpl = vi.fn(async () => Response.json({
      choices: [{
        message: {
          content: "已生成待确认操作。",
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: {
              name: "create_note",
              arguments: JSON.stringify({ title: "Roadmap", content: "Outline" }),
            },
          }],
        },
      }],
    }));

    const service = new AiChatService({
      apiUrl: "https://ai.example.test/v1/chat/completions",
      apiKey: "server-only-key",
      model: "beta-model",
      fetchImpl,
    });

    await expect(service.chat(
      { messages: [{ role: "user", content: "帮我整理" }] },
      new AbortController().signal,
      { proposeActions },
    )).resolves.toEqual({
      message: "已生成待确认操作。",
      model: "beta-model",
      action_proposals: [proposal],
    });
    expect(proposeActions).toHaveBeenCalledWith([{
      name: "create_note",
      arguments: { title: "Roadmap", content: "Outline" },
    }]);
  });

  it("rejects malformed provider tool calls", async () => {
    const proposeActions = vi.fn();
    const service = new AiChatService({
      apiUrl: "https://ai.example.test/v1/chat/completions",
      apiKey: "server-only-key",
      model: "beta-model",
      fetchImpl: vi.fn(async () => Response.json({
        choices: [{
          message: {
            content: "已生成待确认操作。",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "execute_sql",
                arguments: "{}",
              },
            }],
          },
        }],
      })),
    });

    await expect(service.chat({ messages: [{ role: "user", content: "帮我执行" }] }, new AbortController().signal, { proposeActions }))
      .rejects.toMatchObject({ code: "AI_PROVIDER_INVALID_RESPONSE" });
    expect(proposeActions).not.toHaveBeenCalled();
  });

  it("leaves no proposal behind when a later provider tool call is malformed", async () => {
    const testD1 = await createTestD1({ through: 18 });
    disposals.push(testD1.dispose);
    await seedTenants(testD1.db);
    const repository = new D1AiToolRepository(testD1.db);
    const orchestrator = new AiToolOrchestrator({
      repository,
      createId: () => "action-1",
      clock: () => new Date("2026-08-25T00:00:00.000Z"),
      assertFreshPermission: async () => undefined,
    });
    const service = new AiChatService({
      apiUrl: "https://ai.example.test/v1/chat/completions",
      apiKey: "server-only-key",
      model: "beta-model",
      fetchImpl: vi.fn(async () => Response.json({
        choices: [{
          message: {
            content: "已生成待确认操作。",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "create_note",
                  arguments: JSON.stringify({ title: "Roadmap", content: "Outline" }),
                },
              },
              {
                id: "call-2",
                type: "function",
                function: {
                  name: "execute_sql",
                  arguments: "{}",
                },
              },
            ],
          },
        }],
      })),
    });

    await expect(service.chat(
      { messages: [{ role: "user", content: "帮我整理" }] },
      new AbortController().signal,
      {
        proposeActions: async (toolCalls) => orchestrator.proposeMany(context(), toolCalls),
      },
    )).rejects.toMatchObject({ code: "AI_PROVIDER_INVALID_RESPONSE" });

    const count = await testD1.db.prepare("SELECT COUNT(*) AS count FROM ai_action_proposals").first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("surfaces storage failures from proposeActions as provider unavailability", async () => {
    const service = new AiChatService({
      apiUrl: "https://ai.example.test/v1/chat/completions",
      apiKey: "server-only-key",
      model: "beta-model",
      fetchImpl: vi.fn(async () => Response.json({
        choices: [{
          message: {
            content: "已生成待确认操作。",
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: {
                name: "create_note",
                arguments: JSON.stringify({ title: "Roadmap", content: "Outline" }),
              },
            }],
          },
        }],
      })),
    });

    await expect(service.chat(
      { messages: [{ role: "user", content: "帮我整理" }] },
      new AbortController().signal,
      {
        proposeActions: vi.fn(async () => {
          throw new Error("database unavailable");
        }),
      },
    )).rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE" });
  });
});
