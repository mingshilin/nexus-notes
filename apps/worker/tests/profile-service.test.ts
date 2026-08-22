import { describe, expect, it, vi } from "vitest";

import { ProfileService } from "../src/profile/profile-service";

const now = "2026-08-22T00:00:00.000Z";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

function profile() {
  return {
    id: "u1", email: "old@example.test", display_name: "User", biography: "", locale: "zh-CN",
    timezone: "Asia/Shanghai", avatar_url: null, avatar_key: null, password_hash: "hash", updated_at: now,
  };
}

function dependencies() {
  return {
    repository: {
      getProfile: vi.fn(async () => profile()),
      findActiveUserByEmail: vi.fn(async () => null),
      updateProfile: vi.fn(async () => undefined),
      replaceAvatar: vi.fn(async () => null),
      listSessions: vi.fn(async () => []),
      listOwnedTeamWorkspaces: vi.fn(async () => []),
      revokeOwnedSession: vi.fn(async () => true),
      createEmailChange: vi.fn(async () => undefined),
      consumeEmailChange: vi.fn(async () => true),
      changePasswordAndRevokeOthers: vi.fn(async () => undefined),
      deleteAccount: vi.fn(async () => null),
      appendAudit: vi.fn(async () => undefined),
    },
    password: { verify: vi.fn(async () => true), hash: vi.fn(async () => "new-hash") },
    tokens: { createEmailCode: vi.fn(() => "123456"), hash: vi.fn(async (value: string) => `hash:${value}`) },
    email: { sendEmailChange: vi.fn(async () => undefined) },
    avatars: { put: vi.fn(async () => undefined), get: vi.fn(async () => null), delete: vi.fn(async () => undefined) },
    logger: { log: vi.fn() },
    createId: () => "avatar-1",
    clock: () => new Date(now),
  };
}

describe("ProfileService", () => {
  it("requires the current password before sending an email-change code", async () => {
    const deps = dependencies();
    deps.password.verify.mockResolvedValue(false);
    const service = new ProfileService(deps as any);

    await expect(service.requestEmailChange("u1", { new_email: "new@example.test", current_password: "wrong" }, "req-1"))
      .rejects.toMatchObject({ code: "CURRENT_PASSWORD_INVALID", status: 403 });
    expect(deps.email.sendEmailChange).not.toHaveBeenCalled();
    expect(deps.repository.createEmailChange).not.toHaveBeenCalled();
  });

  it("normalizes and binds an email-change code to its user and new email", async () => {
    const deps = dependencies();
    const service = new ProfileService(deps as any);

    await expect(service.requestEmailChange("u1", { new_email: " New@Example.Test ", current_password: "password" }, "req-2"))
      .resolves.toEqual({ accepted: true });
    expect(deps.tokens.hash).toHaveBeenCalledWith("email_change:u1:new@example.test:123456");
    expect(deps.repository.createEmailChange).toHaveBeenCalledWith(
      "u1", "new@example.test", "hash:email_change:u1:new@example.test:123456", "2026-08-22T00:15:00.000Z", now,
    );
    expect(deps.email.sendEmailChange).toHaveBeenCalledWith("new@example.test", "123456");
  });

  it("rejects an email change to the current or another active account email", async () => {
    const deps = dependencies();
    const service = new ProfileService(deps as any);

    await expect(service.requestEmailChange("u1", { new_email: "OLD@example.test", current_password: "password" }, "req-current"))
      .rejects.toMatchObject({ code: "EMAIL_UNCHANGED", status: 400 });
    deps.repository.findActiveUserByEmail.mockResolvedValue({ id: "u2" });
    await expect(service.requestEmailChange("u1", { new_email: "used@example.test", current_password: "password" }, "req-used"))
      .rejects.toMatchObject({ code: "EMAIL_EXISTS", status: 409 });
  });

  it("rejects invalid email-change confirmations without auditing an email change", async () => {
    const deps = dependencies();
    deps.repository.consumeEmailChange.mockResolvedValue(false);
    const service = new ProfileService(deps as any);

    await expect(service.confirmEmailChange("u1", { new_email: "new@example.test", code: "123456" }, "req-confirm"))
      .rejects.toMatchObject({ code: "EMAIL_CHANGE_CODE_INVALID", status: 400 });
    expect(deps.repository.appendAudit).not.toHaveBeenCalled();
  });

  it("accepts only real PNG, JPEG, and WebP avatar bytes", async () => {
    for (const [declaredType, bytes] of [["image/png", png], ["image/jpeg", jpeg], ["image/webp", webp]] as const) {
      const deps = dependencies();
      await expect(new ProfileService(deps as any).uploadAvatar("u1", declaredType, bytes, "req-avatar"))
        .resolves.toMatchObject({ id: "u1" });
      expect(deps.avatars.put).toHaveBeenCalledWith("profiles/u1/avatar-1", bytes, declaredType);
    }
  });

  it.each([
    ["near-miss RIFF/WebP", "image/webp", new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x58])],
    ["SVG masquerading as PNG", "image/png", new TextEncoder().encode("<svg/>")],
    ["empty bytes", "image/png", new Uint8Array()],
    ["more than 2 MiB", "image/png", new Uint8Array((2 * 1024 * 1024) + 1)],
  ])("rejects %s avatar input", async (_caseName, declaredType, bytes) => {
    const deps = dependencies();
    await expect(new ProfileService(deps as any).uploadAvatar("u1", declaredType, bytes, "req-avatar-bad"))
      .rejects.toMatchObject({ code: _caseName === "empty bytes" || _caseName === "more than 2 MiB" ? "AVATAR_SIZE_INVALID" : "AVATAR_TYPE_INVALID" });
    expect(deps.avatars.put).not.toHaveBeenCalled();
  });

  it("compensates by deleting a newly stored private avatar when replacement fails", async () => {
    const deps = dependencies();
    deps.repository.replaceAvatar.mockRejectedValue(new Error("D1 unavailable"));
    await expect(new ProfileService(deps as any).uploadAvatar("u1", "image/png", png, "req-compensate"))
      .rejects.toThrow("D1 unavailable");
    expect(deps.avatars.delete).toHaveBeenCalledWith("profiles/u1/avatar-1");
  });

  it("keeps success and emits a request-id-only log when old avatar cleanup fails", async () => {
    const deps = dependencies();
    deps.repository.replaceAvatar.mockResolvedValue("profiles/u1/old-private-key");
    deps.avatars.delete.mockRejectedValueOnce(new Error("R2 unavailable"));
    await expect(new ProfileService(deps as any).uploadAvatar("u1", "image/png", png, "req-cleanup"))
      .resolves.toMatchObject({ id: "u1" });
    expect(deps.logger.log).toHaveBeenCalledWith(JSON.stringify({ type: "profile.avatar_cleanup_failed", request_id: "req-cleanup" }));
    expect(deps.logger.log.mock.calls.flat().join(" ")).not.toContain("u1");
    expect(deps.logger.log.mock.calls.flat().join(" ")).not.toContain("old-private-key");
  });

  it("changes password and revokes other sessions", async () => {
    const deps = dependencies();
    const service = new ProfileService(deps as any);
    await service.changePassword("u1", "session-1", { current_password: "old-password", new_password: "new-password-123" }, "req-3");
    expect(deps.repository.changePasswordAndRevokeOthers).toHaveBeenCalledWith("u1", "session-1", "new-hash", now);
  });

  it("rejects invalid current passwords and weak replacement passwords", async () => {
    const deps = dependencies();
    deps.password.verify.mockResolvedValue(false);
    const service = new ProfileService(deps as any);
    await expect(service.changePassword("u1", "session-1", { current_password: "wrong", new_password: "new-password-123" }, "req-password"))
      .rejects.toMatchObject({ code: "CURRENT_PASSWORD_INVALID", status: 403 });
    deps.password.verify.mockResolvedValue(true);
    await expect(service.changePassword("u1", "session-1", { current_password: "old", new_password: "short" }, "req-password"))
      .rejects.toThrow("PASSWORD_TOO_SHORT");
  });

  it("blocks account deletion until owned team workspaces are transferred", async () => {
    const deps = dependencies();
    deps.repository.listOwnedTeamWorkspaces.mockResolvedValue([{ id: "team-1", name: "团队空间" }]);
    const service = new ProfileService(deps as any);
    await expect(service.deleteAccount("u1", { current_password: "old-password", confirmation: "永久删除我的账户" }, "req-delete"))
      .rejects.toMatchObject({ code: "OWNERSHIP_TRANSFER_REQUIRED", status: 409, message: expect.stringContaining("团队空间") });
    expect(deps.repository.deleteAccount).not.toHaveBeenCalled();
  });

  it("uses only the allowed audit event names and never records credentials", async () => {
    const deps = dependencies();
    const service = new ProfileService(deps as any);
    await service.updateProfile("u1", { display_name: "New" }, "req-profile");
    await service.uploadAvatar("u1", "image/png", png, "req-avatar");
    await service.deleteAvatar("u1", "req-avatar-delete");
    await service.requestEmailChange("u1", { new_email: "new@example.test", current_password: "old-password" }, "req-email-request");
    await service.confirmEmailChange("u1", { new_email: "new@example.test", code: "123456" }, "req-email-confirm");
    await service.changePassword("u1", "session-1", { current_password: "old-password", new_password: "new-password-123" }, "req-password");
    await service.revokeSession("u1", "session-1", "session-2", "req-session");
    await service.deleteAccount("u1", { current_password: "old-password", confirmation: "永久删除我的账户" }, "req-delete");
    expect(deps.repository.appendAudit.mock.calls.map((call: unknown[]) => call[1]).sort()).toEqual([
      "account.deleted", "avatar.deleted", "avatar.updated", "email.change_requested", "email.changed", "password.changed", "profile.updated", "session.revoked",
    ]);
    expect(JSON.stringify(deps.repository.appendAudit.mock.calls)).not.toContain("old-password");
    expect(JSON.stringify(deps.repository.appendAudit.mock.calls)).not.toContain("new-password-123");
    expect(JSON.stringify(deps.repository.appendAudit.mock.calls)).not.toContain("123456");
  });
});
