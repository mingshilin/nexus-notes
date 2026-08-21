import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";

describe("App authentication bootstrap", () => {
  it("gates the workspace behind the server session result", async () => {
    const authClient = {
      session: vi.fn(async () => {
        throw Object.assign(new Error("Not authenticated"), { code: "UNAUTHENTICATED", status: 401 });
      }),
      login: vi.fn(),
    };

    render(<App authClient={authClient as any} turnstileSiteKey="test-site-key" />);

    await waitFor(() => expect(authClient.session).toHaveBeenCalledOnce());
    expect(await screen.findByRole("main")).toHaveClass("auth-page");
    expect(screen.queryByText("Public Beta 重写计划")).not.toBeInTheDocument();
  });

  it("renders the existing workspace after session bootstrap succeeds", async () => {
    const authClient = {
      session: vi.fn(async () => ({ user: { id: "user-1", email: "user@example.com" } })),
    };

    render(<App authClient={authClient as any} turnstileSiteKey="test-site-key" />);

    expect(await screen.findByRole("heading", { name: "Public Beta 重写计划", level: 1 })).toBeInTheDocument();
    expect(authClient.session).toHaveBeenCalledOnce();
  });
});
