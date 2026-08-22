import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src/index")) as WorkerExports;
}

const principal = { userId: "u1", sessionId: "s1" };
const profile = {
  id: "u1", email: "user@example.test", display_name: "User", biography: "", locale: "zh-CN",
  timezone: "Asia/Shanghai", avatar_url: null, updated_at: "2026-08-22T00:00:00.000Z",
};

function service(overrides: Record<string, unknown> = {}) {
  return {
    getProfile: vi.fn(async () => profile),
    updateProfile: vi.fn(async () => profile),
    getAvatar: vi.fn(async () => null),
    uploadAvatar: vi.fn(async () => profile),
    deleteAvatar: vi.fn(async () => profile),
    requestEmailChange: vi.fn(async () => ({ accepted: true })),
    confirmEmailChange: vi.fn(async () => profile),
    changePassword: vi.fn(async () => ({ changed: true })),
    listSessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => ({ revoked: true })),
    deleteAccount: vi.fn(async () => ({ deleted: true })),
    ...overrides,
  };
}

function registry(worker: WorkerExports, profileService = service(), options: Record<string, unknown> = {}) {
  const createRouteRegistry = worker.createRouteRegistry as (options: Record<string, unknown>) => {
    fetch(request: Request, env: unknown): Promise<Response>;
  };
  const registerProfileRoutes = worker.registerProfileRoutes as (registry: unknown, createService: () => unknown) => void;
  const value = createRouteRegistry({
    requestId: () => "req-profile",
    authenticate: vi.fn(async () => principal),
    ...options,
  });
  registerProfileRoutes(value, () => profileService);
  return { value, profileService };
}

function jsonRequest(path: string, method: string, body: unknown) {
  return new Request(`https://beta.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("profile routes", () => {
  it("registers each approved session route with principal-scoped service calls", async () => {
    const worker = await loadWorker();
    expect(worker.registerProfileRoutes).toBeTypeOf("function");
    const { value, profileService } = registry(worker);

    const responses = await Promise.all([
      value.fetch(new Request("https://beta.test/api/v2/profile"), {}),
      value.fetch(jsonRequest("/api/v2/profile", "PATCH", { display_name: "Updated" }), {}),
      value.fetch(new Request("https://beta.test/api/v2/profile/avatar"), {}),
      value.fetch(new Request("https://beta.test/api/v2/profile/avatar", { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array([1]) }), {}),
      value.fetch(new Request("https://beta.test/api/v2/profile/avatar", { method: "DELETE" }), {}),
      value.fetch(jsonRequest("/api/v2/profile/email/change", "POST", { new_email: "next@example.test", current_password: "old-password" }), {}),
      value.fetch(jsonRequest("/api/v2/profile/email/confirm", "POST", { new_email: "next@example.test", code: "123456" }), {}),
      value.fetch(jsonRequest("/api/v2/profile/password/change", "POST", { current_password: "old-password", new_password: "new-password-123" }), {}),
      value.fetch(new Request("https://beta.test/api/v2/profile/sessions"), {}),
      value.fetch(new Request("https://beta.test/api/v2/profile/sessions/s2", { method: "DELETE" }), {}),
      value.fetch(jsonRequest("/api/v2/profile", "DELETE", { current_password: "old-password", confirmation: "永久删除我的账户" }), {}),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 404, 200, 200, 200, 200, 200, 200, 200, 200]);
    expect(profileService.getProfile).toHaveBeenCalledWith("u1");
    expect(profileService.updateProfile).toHaveBeenCalledWith("u1", { display_name: "Updated" }, "req-profile");
    expect(profileService.getAvatar).toHaveBeenCalledWith("u1");
    expect(profileService.uploadAvatar).toHaveBeenCalledWith("u1", "image/png", expect.any(Uint8Array), "req-profile");
    expect(profileService.deleteAvatar).toHaveBeenCalledWith("u1", "req-profile");
    expect(profileService.requestEmailChange).toHaveBeenCalledWith("u1", expect.anything(), "req-profile");
    expect(profileService.confirmEmailChange).toHaveBeenCalledWith("u1", expect.anything(), "req-profile");
    expect(profileService.changePassword).toHaveBeenCalledWith("u1", "s1", expect.anything(), "req-profile");
    expect(profileService.listSessions).toHaveBeenCalledWith("u1", "s1");
    expect(profileService.revokeSession).toHaveBeenCalledWith("u1", "s1", "s2", "req-profile");
    expect(profileService.deleteAccount).toHaveBeenCalledWith("u1", expect.anything(), "req-profile");
  });

  it("rejects unauthenticated profile access before calling the service", async () => {
    const worker = await loadWorker();
    const profileService = service();
    const { value } = registry(worker, profileService, { authenticate: vi.fn(async () => null) });

    const response = await value.fetch(new Request("https://beta.test/api/v2/profile"), {});

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false, error: { code: "UNAUTHENTICATED" } });
    expect(profileService.getProfile).not.toHaveBeenCalled();
  });

  it("uses the exact IP rate-limit policies for profile routes", async () => {
    const worker = await loadWorker();
    const enforceRateLimit = vi.fn(async () => undefined);
    const { value } = registry(worker, service(), { enforceRateLimit });

    await value.fetch(new Request("https://beta.test/api/v2/profile"), {});
    await value.fetch(jsonRequest("/api/v2/profile", "PATCH", { display_name: "Updated" }), {});
    await value.fetch(new Request("https://beta.test/api/v2/profile/avatar"), {});
    await value.fetch(new Request("https://beta.test/api/v2/profile/avatar", { method: "POST", headers: { "content-type": "image/png" }, body: new Uint8Array([1]) }), {});
    await value.fetch(new Request("https://beta.test/api/v2/profile/avatar", { method: "DELETE" }), {});
    await value.fetch(new Request("https://beta.test/api/v2/profile/sessions"), {});
    await value.fetch(new Request("https://beta.test/api/v2/profile/sessions/s2", { method: "DELETE" }), {});
    await value.fetch(jsonRequest("/api/v2/profile/email/change", "POST", { new_email: "next@example.test", current_password: "old-password" }), {});
    await value.fetch(jsonRequest("/api/v2/profile/email/confirm", "POST", { new_email: "next@example.test", code: "123456" }), {});
    await value.fetch(jsonRequest("/api/v2/profile/password/change", "POST", { current_password: "old-password", new_password: "new-password-123" }), {});
    await value.fetch(jsonRequest("/api/v2/profile", "DELETE", { current_password: "old-password", confirmation: "永久删除我的账户" }), {});

    expect(enforceRateLimit.mock.calls.map(([policy]) => policy)).toEqual([
      { bucket: "ip", limit: 30, windowSeconds: 60 }, { bucket: "ip", limit: 30, windowSeconds: 60 },
      { bucket: "ip", limit: 30, windowSeconds: 60 }, { bucket: "ip", limit: 30, windowSeconds: 60 },
      { bucket: "ip", limit: 30, windowSeconds: 60 }, { bucket: "ip", limit: 30, windowSeconds: 60 },
      { bucket: "ip", limit: 30, windowSeconds: 60 }, { bucket: "ip", limit: 5, windowSeconds: 30 * 60 },
      { bucket: "ip", limit: 10, windowSeconds: 30 * 60 }, { bucket: "ip", limit: 5, windowSeconds: 30 * 60 },
      { bucket: "ip", limit: 5, windowSeconds: 30 * 60 },
    ]);
  });

  it("rejects invalid JSON schemas before calling profile mutations", async () => {
    const worker = await loadWorker();
    const { value, profileService } = registry(worker);

    const response = await value.fetch(jsonRequest("/api/v2/profile/password/change", "POST", { current_password: "old-password", new_password: "short" }), {});

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
    expect(profileService.changePassword).not.toHaveBeenCalled();
  });

  it("cancels streamed avatar uploads immediately when they exceed 2 MiB", async () => {
    const worker = await loadWorker();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array((2 * 1024 * 1024) + 1));
      },
      cancel() { cancelled = true; },
    });
    const { value, profileService } = registry(worker);

    const response = await value.fetch(new Request("https://beta.test/api/v2/profile/avatar", {
      method: "POST", headers: { "content-type": "image/png" }, body, duplex: "half",
    } as RequestInit), {});

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(profileService.uploadAvatar).not.toHaveBeenCalled();
  });

  it("rejects declared oversize avatars without reading their body", async () => {
    const worker = await loadWorker();
    const { value, profileService } = registry(worker);

    const response = await value.fetch(new Request("https://beta.test/api/v2/profile/avatar", {
      method: "POST",
      headers: { "content-type": "image/png", "content-length": String((2 * 1024 * 1024) + 1) },
    }), {});

    expect(response.status).toBe(413);
    expect(profileService.uploadAvatar).not.toHaveBeenCalled();
  });

  it("returns private avatar content without exposing object keys", async () => {
    const worker = await loadWorker();
    const object = { body: new TextEncoder().encode("private-avatar"), httpMetadata: { contentType: "image/webp" } };
    const { value } = registry(worker, service({ getAvatar: vi.fn(async () => object) }));

    const response = await value.fetch(new Request("https://beta.test/api/v2/profile/avatar"), {});

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("private-avatar");
  });

  it("does not allow the current session to be revoked", async () => {
    const worker = await loadWorker();
    const ProfileServiceError = worker.ProfileServiceError as new (code: string, message: string, status: number) => Error;
    const { value, profileService } = registry(worker, service({
      revokeSession: vi.fn(async () => { throw new ProfileServiceError("SESSION_NOT_FOUND", "Session is unavailable", 404); }),
    }));

    const response = await value.fetch(new Request("https://beta.test/api/v2/profile/sessions/s1", { method: "DELETE" }), {});

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false, error: { code: "SESSION_NOT_FOUND" } });
    expect(profileService.revokeSession).toHaveBeenCalledWith("u1", "s1", "s1", "req-profile");
  });

  it("clears the secure session cookie after account deletion", async () => {
    const worker = await loadWorker();
    const { value } = registry(worker);

    const response = await value.fetch(jsonRequest("/api/v2/profile", "DELETE", {
      current_password: "old-password", confirmation: "永久删除我的账户",
    }), {});

    expect(response.headers.get("set-cookie")).toBe("nexus_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  });

  it("serializes unexpected storage failures as a safe error envelope", async () => {
    const worker = await loadWorker();
    const { value } = registry(worker, service({ getProfile: vi.fn(async () => { throw new Error("D1 SQL failed for profiles/u1/private-key"); }) }));

    const response = await value.fetch(new Request("https://beta.test/api/v2/profile"), {});
    const payload = await response.json() as { error: { code: string; message: string } };

    expect(response.status).toBe(500);
    expect(payload.error).toEqual({ code: "INTERNAL_ERROR", message: "Unexpected request failure", retryable: true, request_id: "req-profile" });
    expect(JSON.stringify(payload)).not.toContain("private-key");
  });
});
