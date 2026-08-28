import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExternalCalendarPanel } from "../src/knowledge/ExternalCalendarPanel";

function client(connections: Array<{ id: string; provider: "google" | "outlook"; status: "active" | "error" | "revoked" }> = []) {
  return {
    listCalendarConnections: vi.fn(async () => connections.map((item) => ({ ...item, last_synced_at: null, last_error_code: null }))),
    startCalendarConnection: vi.fn(async () => ({ provider: "google" as const, status: "unconfigured" as const })),
    listCalendarEvents: vi.fn(async () => []),
    syncCalendarConnection: vi.fn(async () => ({ connection: { id: "connection-1", provider: "google" as const, status: "active" as const, last_synced_at: "2026-08-28T00:00:00.000Z", last_error_code: null }, imported_count: 3 })),
    disconnectCalendarConnection: vi.fn(async () => ({ deleted: true as const })),
  };
}

describe("ExternalCalendarPanel", () => {
  it("shows explicit provider configuration state and does not pretend to connect", async () => {
    const api = client();
    render(<ExternalCalendarPanel client={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "连接 Google 日历" }));
    expect(await screen.findByText(/Google 日历尚未配置/)).toBeInTheDocument();
    expect(api.startCalendarConnection).toHaveBeenCalledWith("google");
  });

  it("syncs an active connection and renders imported read-only events", async () => {
    const api = client([{ id: "connection-1", provider: "google", status: "active" }]);
    api.listCalendarEvents.mockResolvedValueOnce([]);
    api.listCalendarEvents.mockResolvedValueOnce([{
      id: "event-1", connection_id: "connection-1", provider: "google", provider_event_id: "evt-1",
      title: "项目评审", starts_at: "2026-08-28T01:00:00.000Z", ends_at: "2026-08-28T02:00:00.000Z",
      timezone: "UTC", all_day: false, status: "confirmed", updated_at: "2026-08-28T00:00:00.000Z",
    }]);
    render(<ExternalCalendarPanel client={api} />);
    const connection = await screen.findByRole("listitem", { name: /Google/ });
    fireEvent.click(within(connection).getByRole("button", { name: "同步" }));
    await waitFor(() => expect(api.syncCalendarConnection).toHaveBeenCalledWith("connection-1", expect.objectContaining({ from: expect.any(String), to: expect.any(String) })));
    expect(await screen.findByText("项目评审")).toBeInTheDocument();
    expect(screen.getAllByText(/只读导入/).length).toBeGreaterThan(0);
  });
});
