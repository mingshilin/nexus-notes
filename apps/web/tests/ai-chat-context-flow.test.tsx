import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccountAndAIDomain } from "../src/app/domains/AccountAndAIDomain";

describe("AccountAndAIDomain AI context flow", () => {
  it("passes the selected note and database ids into the exact workspace-scoped chat request", async () => {
    const request = vi.fn(async (input: { path: string }) => input.path === "/api/v2/ai/chat"
      ? { message: "已读取 facade 上下文。", model: "beta-model" }
      : { configured: true, source: "server_default" });

    render(<AccountAndAIDomain
      client={{ api: { request }, profile: {}, collaboration: {}, operations: {} } as never}
      workspaceId="ws-facade"
      role="owner"
      selectedEntity={{
        kind: "ai",
        readContext: {
          selected_note_ids: ["note-11", "note-12"],
          selected_database_ids: ["db-21"],
        },
      }}
      callbacks={{ onWorkspaceChange: vi.fn(), onDeleted: vi.fn() }}
    />);

    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "总结选中内容" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(request.mock.calls.some(([input]) => input.path === "/api/v2/ai/chat")).toBe(true));
    const chatRequest = request.mock.calls.find(([input]) => input.path === "/api/v2/ai/chat")?.[0];
    expect(chatRequest?.headers).toEqual({ "x-workspace-id": "ws-facade" });
    expect(chatRequest?.body).toEqual({
      messages: [{ role: "user", content: "总结选中内容" }],
      read_context: {
        selected_note_ids: ["note-11", "note-12"],
        selected_database_ids: ["db-21"],
        allow_workspace_search: false,
      },
    });
  });
});
