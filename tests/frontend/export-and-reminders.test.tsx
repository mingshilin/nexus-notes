import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/api/client";
import { downloadAll } from "@/api/export";
import { ReminderCenterPage } from "@/components/notes/ReminderCenterPage";

describe("export api", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses native anchor download flow after successful preflight", async () => {
    vi.useFakeTimers();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const appendSpy = vi.spyOn(document.body, "append");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("ok", {
          status: 200,
          headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="notes.zip"' },
        }),
      ),
    );

    await downloadAll("zip");
    vi.runAllTimers();

    expect(appendSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("maps 403 export failure to ApiClientError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: { code: "FORBIDDEN", message: "forbidden" } }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(downloadAll("zip")).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe("ReminderCenterPage", () => {
  it("submits edited reminder payload", async () => {
    const onUpdate = vi.fn();
    render(
      <ReminderCenterPage
        reminders={[
          {
            id: "r1",
            user_id: "u1",
            workspace_id: "w1",
            note_id: "n1",
            note_title: "Note 1",
            title: "Pay bill",
            description: "old desc",
            due_at: "2026-05-08T08:00:00.000Z",
            completed_at: null,
            notified_at: null,
            created_at: "2026-05-01T00:00:00.000Z",
            updated_at: "2026-05-01T00:00:00.000Z",
          },
        ]}
        notes={[
          {
            id: "n1",
            title: "Note 1",
            content: "body",
            folder_id: null,
            is_favorite: false,
            is_pinned: false,
            is_daily: false,
            daily_date: null,
            created_at: "2026-05-01T00:00:00.000Z",
            updated_at: "2026-05-01T00:00:00.000Z",
            deleted_at: null,
            archived_at: null,
            last_opened_at: null,
            tags: [],
            folder: null,
          },
        ]}
        onOpenNote={vi.fn()}
        onCreate={vi.fn()}
        onToggleComplete={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getAllByPlaceholderText("提醒标题")[1], { target: { value: "Pay tax" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({
          title: "Pay tax",
          note_id: "n1",
        }),
      );
    });
  });
});
