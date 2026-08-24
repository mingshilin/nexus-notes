import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeCalendarPanel } from "../src/knowledge/KnowledgeCalendarPanel";

describe("KnowledgeCalendarPanel", () => {
  it("loads and renders daily notes, reminders, and database records", async () => {
    const client = {
      getCalendarFeed: vi.fn(async () => ({ items: [
        { id: "daily-1", kind: "daily_note", date: "2026-08-21", title: "Daily Note", entity_id: "note-1", note_id: "note-1", status: "active" },
        { id: "reminder-1", kind: "reminder", date: "2026-08-22", title: "Reminder", entity_id: "reminder-1", note_id: "note-1", status: "pending" },
        { id: "record-1", kind: "database_record", date: "2026-08-23", title: "Record", entity_id: "record-1", note_id: null, database_id: "db-1", status: null },
      ] })),
    };

    render(<KnowledgeCalendarPanel client={client} initialRange={{ from: "2026-08-01", to: "2026-08-31" }} />);

    expect(await screen.findByText("Daily Note")).toBeInTheDocument();
    expect(screen.getByText("Reminder")).toBeInTheDocument();
    expect(screen.getByText("Record")).toBeInTheDocument();
    expect(client.getCalendarFeed).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-31" }, expect.any(AbortSignal));
  });

  it("keeps the selected range and exposes a retry after a feed failure", async () => {
    const client = { getCalendarFeed: vi.fn().mockRejectedValue(new Error("offline")) };
    render(<KnowledgeCalendarPanel client={client} initialRange={{ from: "2026-08-01", to: "2026-08-31" }} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("日历暂时无法加载");
    fireEvent.click(screen.getByRole("button", { name: "重试日历" }));
    await waitFor(() => expect(client.getCalendarFeed).toHaveBeenCalledTimes(2));
    expect(screen.getByDisplayValue("2026-08-01")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-08-31")).toBeInTheDocument();
  });
});
