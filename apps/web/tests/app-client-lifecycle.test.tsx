import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiLifecycle = vi.hoisted(() => ({
  instances: 0,
  clients: [] as unknown[],
  requests: [] as Array<{ client: unknown; path: string }>,
}));

vi.mock("../src/data/api-client", () => {
  class ApiClientError extends Error {
    readonly code: string;
    readonly status?: number;

    constructor(error: { code: string; message: string }, status?: number) {
      super(error.message);
      this.code = error.code;
      this.status = status;
    }
  }

  class ApiClient {
    constructor() {
      apiLifecycle.instances += 1;
      apiLifecycle.clients.push(this);
    }

    request(options: { path: string }) {
      apiLifecycle.requests.push({ client: this, path: options.path });
      return Promise.reject(Object.assign(new Error("signed out"), { code: "UNAUTHENTICATED", status: 401 }));
    }
  }

  return { ApiClient, ApiClientError };
});

import { App } from "../src/app/App";

describe("App client lifecycle", () => {
  it("keeps the default API client stable across parent rerenders", () => {
    const pendingSession = new Promise<never>(() => undefined);
    const authClient = { session: vi.fn(() => pendingSession) };
    const baseline = apiLifecycle.instances;
    const view = render(<App authClient={authClient as never} turnstileSiteKey="test" />);

    expect(apiLifecycle.instances).toBe(baseline);

    view.rerender(<App authClient={authClient as never} turnstileSiteKey="test" />);
    expect(apiLifecycle.instances).toBe(baseline);
  });

  it("uses an injected API client for default authentication when no auth client is supplied", () => {
    const pendingSession = new Promise<never>(() => undefined);
    const apiClient = { request: vi.fn(() => pendingSession) };

    const view = render(<App apiClient={apiClient as never} turnstileSiteKey="test" />);

    expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/auth/session",
    }));

    view.rerender(<App apiClient={apiClient as never} turnstileSiteKey="test" />);
    expect(apiClient.request).toHaveBeenCalledOnce();
  });

  it("pairs the module defaults and keeps explicit authentication injection authoritative", async () => {
    const baseline = apiLifecycle.instances;
    const view = render(<App turnstileSiteKey="test" />);

    await waitFor(() => expect(apiLifecycle.requests.some((request) => request.path === "/api/v2/auth/session")).toBe(true));
    expect(apiLifecycle.requests.find((request) => request.path === "/api/v2/auth/session")?.client).toBe(apiLifecycle.clients[0]);
    view.rerender(<App turnstileSiteKey="test" />);
    expect(apiLifecycle.instances).toBe(baseline);
    expect(apiLifecycle.requests.filter((request) => request.path === "/api/v2/auth/session")).toHaveLength(1);

    const explicitAuth = { session: vi.fn(() => new Promise<never>(() => undefined)) };
    const injectedApi = { request: vi.fn() };
    const explicit = render(<App authClient={explicitAuth as never} apiClient={injectedApi as never} turnstileSiteKey="test" />);
    await waitFor(() => expect(explicitAuth.session).toHaveBeenCalledOnce());
    expect(injectedApi.request).not.toHaveBeenCalled();
    explicit.unmount();
  });
});
