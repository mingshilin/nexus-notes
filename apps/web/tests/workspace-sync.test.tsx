import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkspaceSync } from "../src/data/use-workspace-sync";

function Probe({ apiClient, store, workspaceId = "ws-1" }: { apiClient: unknown; store: unknown; workspaceId?: string }) {
  const state = useWorkspaceSync({ apiClient: apiClient as any, store: store as any, workspaceId });
  return <div><span data-testid="sync-status">{state.status}</span><button type="button" onClick={state.retry}>retry</button></div>;
}

describe("useWorkspaceSync", () => {
  it("automatically pushes queued operations and pulls the workspace cursor", async () => {
    const apiClient = { request: vi.fn(async (request: { path: string }) => request.path === "/api/v2/sync/push"
      ? { operations: [], next_cursor: "2" }
      : { changes: [], next_cursor: "2" }) };
    const store = {
      listOperations: vi.fn(async () => []), removeOperation: vi.fn(async () => undefined),
      getSyncCursor: vi.fn(async () => null), setSyncCursor: vi.fn(async () => undefined),
    };

    render(<Probe apiClient={apiClient} store={store} />);

    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("synced"));
    expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/sync/pull" }));
    expect(store.setSyncCursor).toHaveBeenCalledWith("ws-1", "2");
  });

  it("exposes a retryable error when the sync endpoint is unavailable", async () => {
    const apiClient = { request: vi.fn(async () => { throw new Error("offline"); }) };
    const store = {
      listOperations: vi.fn(async () => []), removeOperation: vi.fn(async () => undefined),
      getSyncCursor: vi.fn(async () => null), setSyncCursor: vi.fn(async () => undefined),
    };

    render(<Probe apiClient={apiClient} store={store} />);
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("error"));
    expect(screen.getByRole("button", { name: "retry" })).toBeInTheDocument();
  });
});
