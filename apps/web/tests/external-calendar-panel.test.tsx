import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(api.startCalendarConnection).toHaveBeenCalledWith("google", expect.any(AbortSignal));
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
    await waitFor(() => expect(api.syncCalendarConnection).toHaveBeenCalledWith("connection-1", expect.objectContaining({ from: expect.any(String), to: expect.any(String) }), expect.any(AbortSignal)));
    expect(await screen.findByText("项目评审")).toBeInTheDocument();
    expect(screen.getAllByText(/只读导入/).length).toBeGreaterThan(0);
  });

  it("ignores a late connection response after the panel switches clients", async () => {
    let resolveOld!: (value: any[]) => void;
    const old = client();
    old.listCalendarConnections.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const next = client();
    next.listCalendarConnections.mockResolvedValueOnce([]);
    const view = render(<ExternalCalendarPanel client={old} />);
    view.rerender(<ExternalCalendarPanel client={next} />);
    await waitFor(() => expect(next.listCalendarConnections).toHaveBeenCalled());
    await act(async () => {
      resolveOld([{ id: "old", provider: "google", status: "active", last_synced_at: null, last_error_code: null }]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole("listitem", { name: /Google/ })).not.toBeInTheDocument();
    view.unmount();
  });

  it("ignores a late sync response after the calendar client changes", async () => {
    let resolveSync!: (value: any) => void;
    const old = client([{ id: "connection-1", provider: "google", status: "active" }]);
    old.syncCalendarConnection.mockImplementationOnce(() => new Promise((resolve) => { resolveSync = resolve; }));
    const next = client();
    const view = render(<ExternalCalendarPanel client={old} />);
    const connection = await screen.findByRole("listitem", { name: /Google/ });
    fireEvent.click(within(connection).getByRole("button", { name: "同步" }));
    await waitFor(() => expect(old.syncCalendarConnection).toHaveBeenCalled());
    view.rerender(<ExternalCalendarPanel client={next} />);
    await waitFor(() => expect(next.listCalendarConnections).toHaveBeenCalled());
    await act(async () => {
      resolveSync({ connection: { id: "connection-1", provider: "google", status: "active", last_synced_at: null, last_error_code: null }, imported_count: 99 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText(/已导入 99 条/)).not.toBeInTheDocument();
    view.unmount();
  });
});
