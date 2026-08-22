import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountCenter } from "../src/account/AccountCenter";

const profile = {
  id: "u1",
  email: "u@example.test",
  display_name: "用户",
  biography: "",
  locale: "zh-CN",
  timezone: "Asia/Shanghai",
  avatar_url: null,
  updated_at: "2026-08-22T00:00:00.000Z",
};

const currentSession = {
  id: "s1",
  current: true,
  user_agent: "Chrome on macOS",
  created_at: "2026-08-20T00:00:00.000Z",
  last_seen_at: "2026-08-23T00:00:00.000Z",
  expires_at: "2026-09-20T00:00:00.000Z",
};

const otherSession = {
  id: "s2",
  current: false,
  user_agent: "",
  created_at: "2026-08-21T00:00:00.000Z",
  last_seen_at: "2026-08-22T00:00:00.000Z",
  expires_at: "2026-09-21T00:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; });
  return { promise, resolve, reject };
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    getProfile: vi.fn(async () => profile),
    updateProfile: vi.fn(async () => profile),
    uploadAvatar: vi.fn(async () => profile),
    deleteAvatar: vi.fn(async () => profile),
    requestEmailChange: vi.fn(async () => ({ accepted: true as const })),
    confirmEmailChange: vi.fn(async () => profile),
    changePassword: vi.fn(async () => ({ changed: true as const })),
    listSessions: vi.fn(async () => [currentSession, otherSession]),
    revokeSession: vi.fn(async () => ({ revoked: true as const })),
    ...overrides,
  };
}

function renderCenter(overrides: Record<string, unknown> = {}) {
  return render(<AccountCenter client={client()} workspaces={[]} activeWorkspaceId={null} onWorkspaceChange={vi.fn()} onDeleted={vi.fn()} {...overrides} />);
}

describe("AccountCenter", () => {
  it("loads profile and sessions independently and retries only the failed resource", async () => {
    const profileRequest = deferred<typeof profile>();
    const sessionsRequest = deferred<typeof currentSession[]>();
    const retrySessions = deferred<typeof currentSession[]>();
    const api = client({
      getProfile: vi.fn()
        .mockReturnValueOnce(profileRequest.promise),
      listSessions: vi.fn()
        .mockReturnValueOnce(sessionsRequest.promise)
        .mockReturnValueOnce(retrySessions.promise),
    });
    renderCenter({ client: api });

    expect(screen.getByRole("status", { name: "正在加载个人资料" })).toBeInTheDocument();
    profileRequest.resolve(profile);
    sessionsRequest.reject(new Error("offline"));
    await waitFor(() => expect(screen.getByLabelText("昵称")).toHaveValue("用户"));
    fireEvent.click(screen.getByRole("tab", { name: "安全" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("会话加载失败");
    expect(api.getProfile).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "重试会话加载" }));
    retrySessions.resolve([currentSession]);
    expect(await screen.findByText("当前会话")).toBeInTheDocument();
    expect(api.getProfile).toHaveBeenCalledOnce();
  });

  it("keeps a loaded sessions panel visible when profile loading fails and retries profile only", async () => {
    const api = client({
      getProfile: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(profile),
      listSessions: vi.fn(async () => [currentSession]),
    });
    renderCenter({ client: api });
    expect(await screen.findByRole("alert")).toHaveTextContent("个人资料加载失败");
    fireEvent.click(screen.getByRole("tab", { name: "安全" }));
    expect(await screen.findByText("当前会话")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "个人资料" }));
    fireEvent.click(screen.getByRole("button", { name: "重试个人资料加载" }));
    await waitFor(() => expect(screen.getByLabelText("昵称")).toHaveValue("用户"));
    expect(api.listSessions).toHaveBeenCalledOnce();
  });

  it("keeps controlled dirty profile values across tabs and command failure", async () => {
    const api = client({ updateProfile: vi.fn(async () => { throw new Error("offline"); }) });
    renderCenter({ client: api });
    const name = await screen.findByLabelText("昵称");
    fireEvent.change(name, { target: { value: "新昵称" } });
    fireEvent.click(screen.getByRole("tab", { name: "安全" }));
    fireEvent.click(screen.getByRole("tab", { name: "个人资料" }));
    fireEvent.click(screen.getByRole("button", { name: "保存个人资料" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
    expect(name).toHaveValue("新昵称");
  });

  it("does not let a late profile refresh overwrite dirty input", async () => {
    const request = deferred<typeof profile>();
    const api = client({ getProfile: vi.fn(() => request.promise) });
    renderCenter({ client: api });
    const name = screen.getByLabelText("昵称");
    fireEvent.change(name, { target: { value: "本地草稿" } });
    request.resolve(profile);
    await waitFor(() => expect(name).toHaveValue("本地草稿"));
  });

  it("reports the returned profile so navigation identity can update", async () => {
    const returned = { ...profile, display_name: "新身份", avatar_url: "/avatar?v=2", updated_at: "2026-08-23T00:00:00.000Z" };
    const onProfileChange = vi.fn();
    const api = client({ updateProfile: vi.fn(async () => returned) });
    renderCenter({ client: api, onProfileChange });
    fireEvent.change(await screen.findByLabelText("昵称"), { target: { value: "新身份" } });
    fireEvent.click(screen.getByRole("button", { name: "保存个人资料" }));
    await waitFor(() => expect(onProfileChange).toHaveBeenCalledWith(returned));
  });

  it("rejects avatar type and size in the browser before upload", async () => {
    const uploadAvatar = vi.fn(async () => profile);
    const api = client({ uploadAvatar });
    renderCenter({ client: api });
    const input = await screen.findByLabelText("头像文件");
    fireEvent.change(input, { target: { files: [new File(["svg"], "avatar.svg", { type: "image/svg+xml" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("仅支持 PNG、JPEG 或 WebP");
    expect(uploadAvatar).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("头像大小必须不超过 2 MiB");
    expect(uploadAvatar).not.toHaveBeenCalled();
  });

  it("keeps avatar retry state after upload/delete failure and applies returned profiles on success", async () => {
    const uploaded = { ...profile, avatar_url: "/avatar", updated_at: "2026-08-23T00:00:00.000Z" };
    const uploadAvatar = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(uploaded);
    const deleteAvatar = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ...uploaded, avatar_url: null, updated_at: "2026-08-24T00:00:00.000Z" });
    const onProfileChange = vi.fn();
    const api = client({ uploadAvatar, deleteAvatar });
    renderCenter({ client: api, onProfileChange });
    const input = await screen.findByLabelText("头像文件");
    const file = new File(["png"], "头像.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText(/头像\.png/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上传头像" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("头像上传失败");
    expect(screen.getByText(/头像\.png/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上传头像" }));
    await waitFor(() => expect(onProfileChange).toHaveBeenCalledWith(uploaded));
    fireEvent.click(screen.getByRole("button", { name: "删除头像" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("头像删除失败");
    fireEvent.click(screen.getByRole("button", { name: "删除头像" }));
    await waitFor(() => expect(onProfileChange).toHaveBeenCalledWith(expect.objectContaining({ avatar_url: null })));
  });

  it("uses an explicit two-step email flow with relevant field clearing", async () => {
    const requested = deferred<{ accepted: true }>();
    const confirmed = { ...profile, email: "new@example.test" };
    const requestEmailChange = vi.fn(() => requested.promise);
    const confirmEmailChange = vi.fn(async () => confirmed);
    const onProfileChange = vi.fn();
    const api = client({ requestEmailChange, confirmEmailChange });
    renderCenter({ client: api, onProfileChange });
    fireEvent.click(await screen.findByRole("tab", { name: "安全" }));
    const email = screen.getByLabelText("新邮箱");
    const password = screen.getByLabelText("邮箱变更当前密码");
    fireEvent.change(email, { target: { value: "new@example.test" } });
    fireEvent.change(password, { target: { value: "current-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "请求邮箱变更" }));
    requested.resolve({ accepted: true });
    expect(await screen.findByLabelText("验证码")).toBeInTheDocument();
    expect(password).toHaveValue("");
    expect(email).toHaveValue("new@example.test");
    const code = screen.getByLabelText("验证码");
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "确认邮箱变更" }));
    await waitFor(() => expect(onProfileChange).toHaveBeenCalledWith(confirmed));
    expect(code).toHaveValue("");
  });

  it("preserves email fields when either email step fails", async () => {
    const api = client({
      requestEmailChange: vi.fn(async () => { throw new Error("wrong password"); }),
      confirmEmailChange: vi.fn(async () => { throw new Error("bad code"); }),
    });
    renderCenter({ client: api });
    fireEvent.click(await screen.findByRole("tab", { name: "安全" }));
    fireEvent.change(screen.getByLabelText("新邮箱"), { target: { value: "new@example.test" } });
    fireEvent.change(screen.getByLabelText("邮箱变更当前密码"), { target: { value: "bad-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "请求邮箱变更" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("邮箱变更请求失败");
    expect(screen.getByLabelText("新邮箱")).toHaveValue("new@example.test");
    expect(screen.getByLabelText("邮箱变更当前密码")).toHaveValue("bad-secret");
  });

  it("preserves the email and code when the explicit confirmation fails", async () => {
    const api = client({ confirmEmailChange: vi.fn(async () => { throw new Error("bad code"); }) });
    renderCenter({ client: api });
    fireEvent.click(await screen.findByRole("tab", { name: "安全" }));
    fireEvent.change(screen.getByLabelText("新邮箱"), { target: { value: "new@example.test" } });
    fireEvent.change(screen.getByLabelText("邮箱变更当前密码"), { target: { value: "current-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "请求邮箱变更" }));
    expect(await screen.findByLabelText("验证码")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "确认邮箱变更" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("邮箱确认失败");
    expect(screen.getByLabelText("新邮箱")).toHaveValue("new@example.test");
    expect(screen.getByLabelText("验证码")).toHaveValue("123456");
  });

  it("validates password confirmation, preserves failures, and refreshes sessions after success", async () => {
    const changePassword = vi.fn().mockRejectedValueOnce(new Error("wrong password")).mockResolvedValueOnce({ changed: true as const });
    const listSessions = vi.fn().mockResolvedValue([currentSession]);
    const api = client({ changePassword, listSessions });
    renderCenter({ client: api });
    fireEvent.click(await screen.findByRole("tab", { name: "安全" }));
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "current-secret" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-secret-123" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "different-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("两次输入的新密码不一致");
    expect(changePassword).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new-secret-123" } });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("密码修改失败");
    expect(screen.getByLabelText("当前密码")).toHaveValue("current-secret");
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
    expect(await screen.findByRole("status")).toHaveTextContent("密码已修改");
    expect(screen.getByLabelText("当前密码")).toHaveValue("");
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
  });

  it("protects the current session and confirms, deduplicates, and restores focus for revocation", async () => {
    const revoke = deferred<{ revoked: true }>();
    const revokeSession = vi.fn(() => revoke.promise);
    const api = client({ listSessions: vi.fn(async () => [currentSession, otherSession]), revokeSession });
    renderCenter({ client: api });
    fireEvent.click(await screen.findByRole("tab", { name: "安全" }));
    expect(within(screen.getByRole("listitem", { name: /当前会话/ })).queryByRole("button", { name: "撤销此会话" })).not.toBeInTheDocument();
    const revokeButton = screen.getByRole("button", { name: "撤销此会话" });
    fireEvent.click(revokeButton);
    expect(await screen.findByRole("dialog", { name: "确认撤销会话" })).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "确认撤销" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(revokeSession).toHaveBeenCalledOnce();
    revoke.reject(new Error("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent("撤销会话失败");
    expect(screen.getByRole("listitem", { name: "其他会话 未知设备" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消撤销" }));
    expect(revokeButton).toHaveFocus();
  });

  it("removes another session only after a successful confirmed revoke", async () => {
    const revokeSession = vi.fn(async () => ({ revoked: true as const }));
    const api = client({ revokeSession });
    renderCenter({ client: api });
    fireEvent.click(await screen.findByRole("tab", { name: "安全" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销此会话" }));
    fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "撤销此会话" })).not.toBeInTheDocument());
    expect(revokeSession).toHaveBeenCalledWith("s2");
  });

  it("implements the four-tab ARIA and keyboard contract without resetting panels", async () => {
    renderCenter();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["个人资料", "安全", "工作区", "数据与隐私"]);
    expect(tabs[0]).toHaveAttribute("aria-controls", "account-panel-profile");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    await waitFor(() => expect(screen.getByLabelText("昵称")).toHaveValue("用户"));
    fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "跨标签草稿" } });
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(tabs[1]).toHaveFocus();
    fireEvent.keyDown(tabs[1]!, { key: "End" });
    expect(tabs[3]).toHaveFocus();
    fireEvent.keyDown(tabs[3]!, { key: "Home" });
    expect(tabs[0]).toHaveFocus();
    fireEvent.click(tabs[2]!);
    expect(screen.getByText("工作区设置将在后续任务中提供。" )).toBeInTheDocument();
    fireEvent.click(tabs[0]!);
    expect(screen.getByLabelText("昵称")).toHaveValue("跨标签草稿");
  });

  it("does not persist secrets in browser storage", async () => {
    renderCenter();
    fireEvent.click(await screen.findByRole("tab", { name: "安全" }));
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "never-store-this" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "another-secret-123" } });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem("never-store-this")).toBeNull();
    expect(sessionStorage.getItem("another-secret-123")).toBeNull();
  });

  it("ignores a profile command completion after the center unmounts", async () => {
    const update = deferred<typeof profile>();
    const onProfileChange = vi.fn();
    const api = client({ updateProfile: vi.fn(() => update.promise) });
    const view = renderCenter({ client: api, onProfileChange });
    await waitFor(() => expect(screen.getByLabelText("昵称")).toHaveValue("用户"));
    fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "卸载前编辑" } });
    fireEvent.click(screen.getByRole("button", { name: "保存个人资料" }));
    view.unmount();
    update.resolve({ ...profile, display_name: "过期结果" });
    await Promise.resolve();
    expect(onProfileChange).not.toHaveBeenCalled();
  });
});
