import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeLifecycle = vi.hoisted(() => ({ instances: [] as string[] }));

vi.mock("../src/data/collaboration-client", () => {
  class CollaborationClient {
    constructor(_apiClient: unknown, scope: string) {
      routeLifecycle.instances.push(scope);
    }

    getPublicShare() {
      return new Promise<never>(() => undefined);
    }

    previewInvitation() {
      return new Promise<never>(() => undefined);
    }

    accessPublicShare() {
      return new Promise<never>(() => undefined);
    }
  }

  return { CollaborationClient };
});

import { App } from "../src/app/App";

const token = "t".repeat(43);

afterEach(() => window.history.replaceState(null, "", "/"));
beforeEach(() => { routeLifecycle.instances.length = 0; });

describe("route collaboration client lifecycle", () => {
  it.each([
    [`/share/${token}`, "public-share"],
    [`/invite/${token}`, "invite-redemption"],
  ])("reuses the %s client across App rerenders", (pathname, scope) => {
    window.history.replaceState(null, "", pathname);
    const apiClient = { request: vi.fn() };
    const authClient = { session: vi.fn(() => new Promise<never>(() => undefined)) };
    const view = render(<App apiClient={apiClient as never} authClient={authClient as never} turnstileSiteKey="test" />);

    expect(routeLifecycle.instances).toEqual([scope]);
    view.rerender(<App apiClient={apiClient as never} authClient={authClient as never} turnstileSiteKey="test" />);

    expect(routeLifecycle.instances).toEqual([scope]);
  });
});
