import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

type WebExports = Record<string, unknown>;

async function loadAuthGate() {
  const web = (await import("../src/index")) as WebExports;
  expect(web.AuthGate).toBeTypeOf("function");
  return web.AuthGate as any;
}

describe("AuthGate", () => {
  it("waits for session bootstrap before revealing authentication or workspace UI", async () => {
    const AuthGate = await loadAuthGate();
    let resolveSession!: (value: unknown) => void;
    const session = vi.fn(() => new Promise((resolve) => { resolveSession = resolve; }));

    render(
      <AuthGate client={{ session }} turnstileSiteKey="test-site-key">
        <p>Authenticated workspace</p>
      </AuthGate>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("正在检查登录状态");
    expect(screen.queryByText("Authenticated workspace")).not.toBeInTheDocument();
    expect(screen.queryByRole("main")).not.toBeInTheDocument();

    resolveSession({ user: { id: "user-1", email: "user@example.com" } });
    expect(await screen.findByText("Authenticated workspace")).toBeInTheDocument();
  });

  it("shows authentication only when the session endpoint confirms the user is signed out", async () => {
    const AuthGate = await loadAuthGate();
    const client = {
      session: vi.fn(async () => {
        throw Object.assign(new Error("Not authenticated"), { code: "UNAUTHENTICATED", status: 401 });
      }),
      login: vi.fn(),
    };

    render(
      <AuthGate client={client} turnstileSiteKey="test-site-key">
        <p>Authenticated workspace</p>
      </AuthGate>,
    );

    expect(await screen.findByRole("main")).toHaveClass("auth-page");
    expect(screen.getByText("普通登录无需人机验证；仅在风险升高时触发。")).toBeInTheDocument();
  });

  it("keeps a recoverable error state for network failures and retries session bootstrap", async () => {
    const AuthGate = await loadAuthGate();
    const session = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Network request failed"), { code: "NETWORK_ERROR" }))
      .mockResolvedValueOnce({ user: { id: "user-1", email: "user@example.com" } });

    render(
      <AuthGate client={{ session }} turnstileSiteKey="test-site-key">
        <p>Authenticated workspace</p>
      </AuthGate>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法确认登录状态");
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(session).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Authenticated workspace")).toBeInTheDocument();
  });
});
