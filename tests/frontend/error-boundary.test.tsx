import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary, PageErrorBoundary } from "@/components/error/AppErrorBoundary";

function Broken({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("boom");
  return <div>content ok</div>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("error boundaries", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("renders a full-screen fallback with refresh action at the app root", () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload },
      writable: true,
    });

    render(
      <AppErrorBoundary title="Root failed">
        <Broken shouldThrow />
      </AppErrorBoundary>,
    );

    expect(screen.getByText("Root failed")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新页面" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("lets page-level fallbacks retry without forcing a page reload", () => {
    const { rerender } = render(
      <PageErrorBoundary title="Page failed">
        <Broken shouldThrow />
      </PageErrorBoundary>,
    );

    expect(screen.getByText("Page failed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "刷新页面" })).not.toBeInTheDocument();

    rerender(
      <PageErrorBoundary title="Page failed">
        <Broken shouldThrow={false} />
      </PageErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(screen.getByText("content ok")).toBeInTheDocument();
  });

  it("resets automatically when resetKey changes", () => {
    const { rerender } = render(
      <PageErrorBoundary title="Chunk failed" resetKey="a">
        <Broken shouldThrow />
      </PageErrorBoundary>,
    );

    expect(screen.getByText("Chunk failed")).toBeInTheDocument();

    rerender(
      <PageErrorBoundary title="Chunk failed" resetKey="b">
        <Broken shouldThrow={false} />
      </PageErrorBoundary>,
    );

    expect(screen.getByText("content ok")).toBeInTheDocument();
  });
});
