import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnstileWidget } from "../src/auth/TurnstileWidget";

describe("TurnstileWidget", () => {
  afterEach(() => {
    delete window.turnstile;
  });

  it("lets the user retry after Cloudflare reports a verification error", async () => {
    let challengeCallback!: (token: string) => void;
    let errorCallback!: (errorCode?: string) => void;
    const turnstile = {
      render: vi.fn((_container: unknown, options: {
        callback(token: string): void;
        "error-callback"(errorCode?: string): void;
      }) => {
        challengeCallback = options.callback;
        errorCallback = options["error-callback"];
        return "widget-1";
      }),
      remove: vi.fn(),
      reset: vi.fn(),
    };
    const onToken = vi.fn();
    window.turnstile = turnstile;

    render(
      <TurnstileWidget
        siteKey="test-site-key"
        action="register"
        onToken={onToken}
      />,
    );

    await waitFor(() => expect(turnstile.render).toHaveBeenCalledOnce());
    act(() => errorCallback("110200"));

    expect(onToken).toHaveBeenLastCalledWith("");
    expect(screen.getByRole("alert")).toHaveTextContent("110200");

    fireEvent.click(screen.getByRole("button", { name: "重新验证" }));

    expect(turnstile.reset).toHaveBeenCalledWith("widget-1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => challengeCallback("retry-token"));
    expect(onToken).toHaveBeenLastCalledWith("retry-token");
  });
});
