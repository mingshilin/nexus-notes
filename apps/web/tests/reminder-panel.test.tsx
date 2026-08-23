import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Reminder } from "@nexus/contracts";
import { ReminderPanel } from "../src/reminders/ReminderPanel";

const reminder: Reminder = {
  id: "reminder-1",
  workspace_id: "ws-1",
  note_id: "note-1",
  user_id: "user-1",
  remind_at: "2026-08-24T09:00:00.000Z",
  status: "pending",
  revision: 1,
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:00:00.000Z",
};

function createClient() {
  return {
    listReminders: vi.fn(async () => [reminder]),
    createReminder: vi.fn(async () => ({ ...reminder, id: "reminder-2" })),
    updateReminder: vi.fn(async (_id: string, input: { base_revision: number; status?: "dismissed" }) => ({ ...reminder, ...input })),
  };
}

describe("ReminderPanel", () => {
  it("loads reminders, creates one, and dismisses an existing reminder", async () => {
    const client = createClient();
    render(<ReminderPanel client={client} />);

    expect(await screen.findByRole("listitem", { name: "reminder-1" })).toHaveTextContent("待处理");
    fireEvent.change(screen.getByLabelText("提醒时间"), { target: { value: "2026-08-25T10:30" } });
    fireEvent.change(screen.getByRole("textbox", { name: "关联笔记 ID" }), { target: { value: "note-2" } });
    fireEvent.click(screen.getByRole("button", { name: "创建提醒" }));

    await waitFor(() => expect(client.createReminder).toHaveBeenCalledWith({ note_id: "note-2", remind_at: expect.any(String) }));
    fireEvent.click(screen.getByRole("button", { name: "完成 reminder-1" }));
    await waitFor(() => expect(client.updateReminder).toHaveBeenCalledWith("reminder-1", { base_revision: 1, status: "dismissed" }));
  });
});
