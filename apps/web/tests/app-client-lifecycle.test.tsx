import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const apiLifecycle = vi.hoisted(() => ({ instances: 0 }));

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

    render(<App apiClient={apiClient as never} turnstileSiteKey="test" />);

    expect(apiClient.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/auth/session",
    }));
  });
});
