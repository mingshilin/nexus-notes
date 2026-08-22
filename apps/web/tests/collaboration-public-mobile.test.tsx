import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

const now = "2026-08-22T00:00:00.000Z";
const content = { share_id: "share-1", entity_type: "note", title: "Shared note", content: "Visible content", revision: 1, updated_at: now };

describe("public share and mobile collaboration", () => {
  it("uses a password POST form without persisting or logging the password or raw token", async () => {
    const { PublicSharePage } = await import("../src/index") as Record<string, any>;
    const unavailable = Object.assign(new Error("Unavailable"), { code: "PUBLIC_SHARE_UNAVAILABLE", status: 404 });
    const client = { getPublicShare: vi.fn(async () => { throw unavailable; }), accessPublicShare: vi.fn(async () => content) };
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const token = "s".repeat(43);
    render(createElement(PublicSharePage, { client, token }));

    expect(await screen.findByRole("heading", { name: "访问受保护的分享" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("访问密码"), { target: { value: "password-123" } });
    fireEvent.click(screen.getByRole("button", { name: "访问分享" }));
    expect(await screen.findByRole("heading", { name: "Shared note" })).toBeInTheDocument();
    expect(screen.getByText("Visible content")).toBeInTheDocument();
    expect(client.accessPublicShare).toHaveBeenCalledWith(token, { password: "password-123" }, expect.any(AbortSignal));
    expect(storageSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    storageSpy.mockRestore();
  });

  it("keeps a 390px keyboard-safe one-time dialog focus-contained with one scroll owner", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: { height: 500, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() } });
    const { AdaptiveWorkbench, CollaborationCenter } = await import("../src/index") as Record<string, any>;
    const share = { id: "share-1", entity_type: "note", entity_id: "note-1", status: "active", password_required: false, expires_at: null, revision: 1, created_at: now, updated_at: now };
    const client = {
      listMembers: vi.fn(async () => []), listInvitations: vi.fn(async () => []),
      listShares: vi.fn(async () => []), createShare: vi.fn(async () => ({ share, token: "s".repeat(43) })),
      connectPresence: vi.fn(({ onStatus, onParticipants }) => { onStatus("connected"); onParticipants([]); return { sendPresence: vi.fn(), sendTyping: vi.fn(), disconnect: vi.fn() }; }),
    };
    render(createElement(AdaptiveWorkbench, {
      mode: "mobile", navigation: "", contextualList: "", inspectorOpen: false, onInspectorClose: vi.fn(),
    }, createElement(CollaborationCenter, {
      client, workspaceId: "ws-1", userId: "user-1", role: "owner", initialSection: "shares",
      shareTargets: [{ type: "note", id: "note-1", label: "Public Beta 重写计划" }],
    })));

    await screen.findByText("尚未创建公开分享。" );
    expect(screen.getByLabelText("分享对象")).toHaveValue("note:note-1");
    const trigger = screen.getByRole("button", { name: "创建分享" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "一次性分享链接" });
    const close = within(dialog).getByRole("button", { name: "关闭" });
    expect(close).toHaveFocus();
    expect(document.querySelector(".workbench-canvas")).toHaveAttribute("inert");
    expect(document.querySelector(".mobile-bottom-nav")).toHaveAttribute("inert");
    expect(document.querySelectorAll('[data-scroll-owner="page"]')).toHaveLength(0);
    expect(document.querySelectorAll("[data-scroll-owner]")).toHaveLength(1);
    expect(dialog).toHaveAttribute("data-scroll-owner", "dialog");
    expect(document.documentElement.style.getPropertyValue("--collaboration-keyboard")).toBe("344px");
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "一次性分享链接" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("uses the same keyboard-safe focus-contained modal state for mobile notifications", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: { height: 500, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() } });
    const { AdaptiveWorkbench, NotificationCenter } = await import("../src/index") as Record<string, any>;
    const notification = { id: "notification-1", workspace_id: "ws-1", user_id: "user-1", type: "mention", deep_link: "/notes/note-1?comment=comment-1", payload: {}, read_at: null, revision: 1, created_at: now };
    const client = {
      listNotifications: vi.fn(async () => ({ items: [notification], next_cursor: null })),
      readNotification: vi.fn(async () => ({ notification_ids: [notification.id], read_at: now })),
      readNotifications: vi.fn(), readAllNotifications: vi.fn(),
    };

    function Harness() {
      const [open, setOpen] = useState(false);
      const opener = useRef<HTMLButtonElement>(null);
      return createElement(AdaptiveWorkbench, {
        mode: "mobile", navigation: "", contextualList: "", inspectorOpen: false, onInspectorClose: vi.fn(),
      }, createElement("div", null,
        createElement("button", { ref: opener, type: "button", onClick: () => setOpen(true) }, "打开通知"),
        createElement(NotificationCenter, { client, open, opener: opener.current, onClose: () => setOpen(false) })));
    }

    render(createElement(Harness));
    const trigger = screen.getByRole("button", { name: "打开通知" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "通知中心" });
    const close = within(dialog).getByRole("button", { name: "关闭通知中心" });
    expect(close).toHaveFocus();
    expect(document.querySelector(".workbench-canvas")).toHaveAttribute("inert");
    expect(document.querySelector(".mobile-bottom-nav")).toHaveAttribute("inert");
    expect(document.querySelectorAll('[data-scroll-owner="page"]')).toHaveLength(0);
    expect(document.querySelectorAll("[data-scroll-owner]")).toHaveLength(1);
    expect(dialog).toHaveAttribute("data-scroll-owner", "dialog");
    expect(document.documentElement.style.getPropertyValue("--collaboration-keyboard")).toBe("344px");
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "通知中心" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
