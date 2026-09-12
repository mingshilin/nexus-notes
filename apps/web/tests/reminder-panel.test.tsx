import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Reminder } from "@nexus/contracts";

import { ReminderPanel } from "../src/reminders/ReminderPanel";

const base = {
  workspace_id: "ws-1",
  note_id: null,
  user_id: "user-1",
  title: "",
  timezone: "Asia/Shanghai",
  channels: ["in_app"] as const,
  recurrence: null,
  recurrence_anchor_local: null,
  occurrence_count: 0,
  delivery_enabled_at: "2026-08-25T00:00:00.000Z",
  snoozed_until: null,
  last_delivered_at: null,
  status: "pending" as const,
  revision: 1,
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:00:00.000Z",
};

function reminder(id: string, title: string, remindAt: string, status: Reminder["status"] = "pending"): Reminder {
  return { ...base, id, title, remind_at: remindAt, status } as Reminder;
}

const reminders = [
  reminder("overdue", "逾期复盘", "2026-08-25T06:00:00.000Z"),
  reminder("today", "今日会议", "2026-08-25T10:00:00.000Z"),
  reminder("future", "未来计划", "2026-08-27T10:00:00.000Z"),
  reminder("done", "已完成事项", "2026-08-24T10:00:00.000Z", "dismissed"),
];

function createClient() {
  return {
    listReminderPage: vi.fn(async () => ({ items: reminders, next_cursor: null })),
    createReminder: vi.fn(async (input: Record<string, unknown>) => ({ ...reminders[1], ...input, id: "created", revision: 1 })),
    updateReminder: vi.fn(async (id: string, input: Record<string, unknown>) => ({ ...reminders.find((item) => item.id === id)!, ...input, revision: 2 })),
    snoozeReminder: vi.fn(async (id: string) => ({ ...reminders.find((item) => item.id === id)!, snoozed_until: "2026-08-25T08:10:00.000Z", revision: 2 })),
    deleteReminder: vi.fn(async () => ({ deleted: true })),
  };
}

function delivery(id: string, status: "failed" | "queued" | "sent") {
  return {
    id,
    workspace_id: "ws-1",
    reminder_id: "future",
    occurrence_at: "2026-08-27T10:00:00.000Z",
    channel: "email" as const,
    status,
    attempt_count: status === "failed" ? 2 : 1,
    last_error_code: status === "failed" ? "EMAIL_RETRYABLE" : null,
    created_at: base.created_at,
    updated_at: base.updated_at,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

const notesClient = {
  list: vi.fn(async () => ({
    items: [{
      id: "note-2", workspace_id: "ws-1", folder_id: null, database_id: null, created_by: "user-1", updated_by: "user-1",
      title: "项目计划", content: "", status: "active", is_favorite: false, is_pinned: false, daily_date: null,
      revision: 1, created_at: base.created_at, updated_at: base.updated_at,
    }],
    next_cursor: null,
  })),
};

describe("ReminderPanel", () => {
  it("groups reminders and creates a typed weekly reminder from a searchable note", async () => {
    const client = createClient();
    render(<ReminderPanel client={client} notesClient={notesClient} defaultTimezone="Asia/Shanghai" now={() => new Date("2026-08-25T08:00:00.000Z")} />);

    expect(await screen.findByRole("heading", { name: "逾期" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "今天" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "未来" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "已完成" })).toBeVisible();

    fireEvent.change(screen.getByLabelText("提醒标题"), { target: { value: "双周复盘" } });
    fireEvent.change(screen.getByLabelText("提醒时间"), { target: { value: "2026-08-28T10:30" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索关联笔记" }), { target: { value: "项目" } });
    await waitFor(() => expect(notesClient.list).toHaveBeenCalledWith(expect.objectContaining({ query: "项目" })));
    fireEvent.change(await screen.findByRole("combobox", { name: "关联笔记" }), { target: { value: "note-2" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Push" }));
    fireEvent.change(screen.getByRole("combobox", { name: "重复规则" }), { target: { value: "weekly" } });
    fireEvent.change(screen.getByLabelText("重复间隔"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "周一" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "周三" }));
    fireEvent.change(screen.getByRole("combobox", { name: "结束方式" }), { target: { value: "count" } });
    fireEvent.change(screen.getByLabelText("重复次数"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "创建提醒" }));

    await waitFor(() => expect(client.createReminder).toHaveBeenCalledWith(expect.objectContaining({
      title: "双周复盘",
      note_id: "note-2",
      timezone: "Asia/Shanghai",
      channels: ["in_app", "push"],
      recurrence: { frequency: "weekly", interval: 2, weekdays: ["MO", "WE"], ends: { type: "count", count: 6 } },
      delivery_enabled: true,
    })));
  });

  it("supports bulk completion, snooze, edit, and delete without dropping current data", async () => {
    const client = createClient();
    render(<ReminderPanel client={client} notesClient={notesClient} defaultTimezone="Asia/Shanghai" now={() => new Date("2026-08-25T08:00:00.000Z")} />);
    const overdue = await screen.findByRole("listitem", { name: "逾期复盘" });
    const today = screen.getByRole("listitem", { name: "今日会议" });

    fireEvent.click(within(overdue).getByRole("checkbox", { name: "选择逾期复盘" }));
    fireEvent.click(within(today).getByRole("checkbox", { name: "选择今日会议" }));
    fireEvent.click(screen.getByRole("button", { name: "完成所选" }));
    await waitFor(() => expect(client.updateReminder).toHaveBeenCalledTimes(2));

    fireEvent.click(within(screen.getByRole("listitem", { name: "未来计划" })).getByRole("button", { name: "稍后 10 分钟" }));
    await waitFor(() => expect(client.snoozeReminder).toHaveBeenCalledWith("future", { base_revision: 1, minutes: 10 }));

    fireEvent.click(within(screen.getByRole("listitem", { name: "未来计划" })).getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("提醒标题")).toHaveValue("未来计划");
    fireEvent.click(screen.getByRole("button", { name: "保存提醒" }));
    await waitFor(() => expect(client.updateReminder).toHaveBeenCalledWith("future", expect.objectContaining({ base_revision: 2 })));

    fireEvent.click(within(screen.getByRole("listitem", { name: "未来计划" })).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(client.deleteReminder).toHaveBeenCalled());
  });

  it("keeps a reminder visible when single completion fails", async () => {
    const client = createClient();
    client.updateReminder.mockRejectedValueOnce(new Error("offline"));
    render(<ReminderPanel client={client} notesClient={notesClient} defaultTimezone="Asia/Shanghai" now={() => new Date("2026-08-25T08:00:00.000Z")} />);
    const item = await screen.findByRole("listitem", { name: "未来计划" });

    fireEvent.click(within(item).getByRole("button", { name: "完成" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("提醒状态更新失败");
    expect(screen.getByRole("listitem", { name: "未来计划" })).toBeInTheDocument();
  });

  it("loads delivery status on demand and retries a failed delivery", async () => {
    const client = createClient() as ReturnType<typeof createClient> & {
      listReminderDeliveries: ReturnType<typeof vi.fn>;
      retryReminderDelivery: ReturnType<typeof vi.fn>;
    };
    client.listReminderDeliveries = vi.fn(async () => [delivery("delivery-1", "failed")]);
    client.retryReminderDelivery = vi.fn(async () => delivery("delivery-1", "queued"));
    render(<ReminderPanel client={client} notesClient={notesClient} defaultTimezone="Asia/Shanghai" now={() => new Date("2026-08-25T08:00:00.000Z")} />);

    const item = await screen.findByRole("listitem", { name: "未来计划" });
    fireEvent.click(within(item).getByRole("button", { name: "查看投递状态" }));
    expect(await screen.findByRole("region", { name: "未来计划投递状态" })).toHaveTextContent("EMAIL_RETRYABLE");
    expect(client.listReminderDeliveries).toHaveBeenCalledWith("future", expect.any(AbortSignal));

    fireEvent.click(screen.getByRole("button", { name: "重试 Email 投递" }));
    await waitFor(() => expect(client.retryReminderDelivery).toHaveBeenCalledWith("future", "delivery-1", expect.any(AbortSignal)));
    expect(screen.getByRole("region", { name: "未来计划投递状态" })).toHaveTextContent("已排队");
  });

  it("does not let a previous workspace mutation reset the current form", async () => {
    const oldCreate = deferred<Reminder>();
    const oldClient = createClient();
    oldClient.createReminder = vi.fn(() => oldCreate.promise);
    const newClient = createClient();
    const view = render(<ReminderPanel client={oldClient} cacheScope="user-1:workspace-old" defaultTimezone="Asia/Shanghai" now={() => new Date("2026-08-25T08:00:00.000Z")} />);
    await screen.findByRole("listitem", { name: "未来计划" });
    fireEvent.change(screen.getByLabelText("提醒标题"), { target: { value: "旧工作区提交" } });
    fireEvent.change(screen.getByLabelText("提醒时间"), { target: { value: "2026-08-28T10:30" } });
    fireEvent.click(screen.getByRole("button", { name: "创建提醒" }));
    await waitFor(() => expect(oldClient.createReminder).toHaveBeenCalledOnce());

    view.rerender(<ReminderPanel client={newClient} cacheScope="user-1:workspace-new" defaultTimezone="Asia/Shanghai" now={() => new Date("2026-08-25T08:00:00.000Z")} />);
    fireEvent.change(screen.getByLabelText("提醒标题"), { target: { value: "新工作区草稿" } });
    act(() => oldCreate.resolve({ ...reminders[1]!, id: "old-created", title: "旧工作区提交" }));
    await act(async () => { await oldCreate.promise; });

    expect(screen.getByLabelText("提醒标题")).toHaveValue("新工作区草稿");
    expect(screen.queryByText("提醒已创建。")).not.toBeInTheDocument();
  });
});
