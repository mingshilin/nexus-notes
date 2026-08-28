import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountCenter } from "../src/account/AccountCenter";
import { ApiClientError } from "../src/data/api-client";
import { ProfileClient } from "../src/data/profile-client";
import { AdaptiveWorkbench } from "../src/layout/AdaptiveWorkbench";

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
    deleteAccount: vi.fn(async () => ({ deleted: true as const })),
    ...overrides,
  };
}

const workspaces = [
  { id: "ws-1", name: "个人空间", slug: "personal", role: "owner" as const, revision: 1 },
  { id: "ws-2", name: "研究团队", slug: "research", role: "editor" as const, revision: 2 },
  { id: "ws-3", name: "只读资料", slug: "readonly", role: "viewer" as const, revision: 3 },
];

const ownerMember = {
  user_id: "u1", email: "u@example.test", display_name: "当前用户", role: "owner" as const, revision: 1,
  joined_at: "2026-08-20T00:00:00.000Z", updated_at: "2026-08-20T00:00:00.000Z",
};

const editorMember = {
  user_id: "u2", email: "editor@example.test", display_name: "协作者", role: "editor" as const, revision: 2,
  joined_at: "2026-08-21T00:00:00.000Z", updated_at: "2026-08-21T00:00:00.000Z",
};

function collaboration(overrides: Record<string, unknown> = {}) {
  return {
    listMembers: vi.fn(async () => [ownerMember, editorMember]),
    updateMemberRole: vi.fn(async () => ({ ...editorMember, role: "viewer" as const, revision: 3 })),
    removeMember: vi.fn(async () => ({ user_id: editorMember.user_id })),
    createInvitation: vi.fn(async () => ({ invitation: {}, token: "invite-token" })),
    ...overrides,
  };
}

const job = {
  id: "job-1", workspace_id: "ws-1", kind: "export" as const, status: "queued" as const, revision: 1,
  error_code: null, created_at: "2026-08-23T00:00:00.000Z", updated_at: "2026-08-23T00:00:00.000Z",
};

function operations(overrides: Record<string, unknown> = {}) {
  return {
    getUsage: vi.fn(async () => ({ notes: 1, databases: 2, attachment_bytes: 1024, queued_jobs: 0 })),
    getStatus: vi.fn(async () => ({ queue: "ready" as const, storage: "ready" as const, ocr: "ready" as const, version: "test" })),
    createJob: vi.fn(async () => job),
    ...overrides,
  };
}

function renderCenter(overrides: Record<string, unknown> = {}) {
  return render(<AccountCenter client={client()} workspaces={[]} activeWorkspaceId={null} onWorkspaceChange={vi.fn()} onDeleted={vi.fn()} {...overrides} />);
}

function realProfileClient(transport: ReturnType<typeof vi.fn>) {
  return new ProfileClient({ request: transport } as never);
}

function renderCenterInWorkbench(api: ReturnType<typeof client>, overrides: Record<string, unknown> = {}) {
  return render(<AdaptiveWorkbench navigation={<nav aria-label="测试导航" />} inspectorOpen={false} onInspectorClose={vi.fn()}>
    <AccountCenter client={api} workspaces={[]} activeWorkspaceId={null} onWorkspaceChange={vi.fn()} onDeleted={vi.fn()} {...overrides} />
  </AdaptiveWorkbench>);
}

describe("AccountCenter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    await waitFor(() => expect(name).toHaveValue("用户"));
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
    const name = await screen.findByLabelText("昵称");
    await waitFor(() => expect(name).toHaveValue("用户"));
    fireEvent.change(name, { target: { value: "新身份" } });
    fireEvent.click(screen.getByRole("button", { name: "保存个人资料" }));
    await waitFor(() => expect(onProfileChange).toHaveBeenCalledWith(returned));
  });

  it("keeps newer profile edits after a late save success while adopting the returned baseline", async () => {
    const update = deferred<typeof profile>();
    const returned = { ...profile, display_name: "服务端昵称", biography: "服务端简介" };
    const onProfileChange = vi.fn();
    const api = client({ updateProfile: vi.fn().mockReturnValueOnce(update.promise).mockRejectedValueOnce(new Error("offline")) });
    renderCenter({ client: api, onProfileChange });
    await waitFor(() => expect(screen.getByLabelText("昵称")).toHaveValue("用户"));
    fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "第一次编辑" } });
    fireEvent.click(screen.getByRole("button", { name: "保存个人资料" }));
    fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "提交后的更新" } });
    update.resolve(returned);
    await waitFor(() => expect(onProfileChange).toHaveBeenCalledWith(returned));
    expect(screen.getByLabelText("昵称")).toHaveValue("提交后的更新");
    fireEvent.click(screen.getByRole("button", { name: "保存个人资料" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
  });

  it("uses real ProfileClient schema boundaries without transport calls or stuck pending state", async () => {
    const transport = vi.fn(async (request: { path: string; method?: string }) => {
      if (request.path === "/api/v2/profile/sessions") return { items: [] };
      if (request.path === "/api/v2/profile") return profile;
      if (request.path.includes("email/change")) return { accepted: true };
      if (request.path.includes("email/confirm")) return profile;
      if (request.path.includes("password/change")) return { changed: true };
      throw new Error(`Unexpected ${request.method ?? "GET"} ${request.path}`);
    });
    const api = realProfileClient(transport);
    renderCenter({ client: api });
    await waitFor(() => expect(screen.getByLabelText("昵称")).toHaveValue("用户"));
    fireEvent.change(screen.getByLabelText("语言"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存个人资料" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("个人资料格式无效");
    expect(screen.getByRole("button", { name: "保存个人资料" })).toBeEnabled();
    fireEvent.click(screen.getByRole("tab", { name: "安全" }));
    const securityPanel = screen.getByRole("tabpanel", { name: "安全" });
    fireEvent.change(screen.getByLabelText("新邮箱"), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText("邮箱变更当前密码"), { target: { value: "current-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "请求邮箱变更" }));
    expect(await within(securityPanel).findByRole("alert")).toHaveTextContent("邮箱变更输入无效");
    expect(screen.getByRole("button", { name: "请求邮箱变更" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("新邮箱"), { target: { value: "new@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "请求邮箱变更" }));
    await screen.findByLabelText("验证码");
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "确认邮箱变更" }));
    expect(await within(securityPanel).findByRole("alert")).toHaveTextContent("验证码格式无效");
    expect(screen.getByRole("button", { name: "确认邮箱变更" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "current-secret" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
    await waitFor(() => expect(within(securityPanel).getAllByRole("alert").at(-1)).toHaveTextContent("密码格式无效"));
    expect(screen.getByRole("button", { name: "修改密码" })).toBeEnabled();
    expect(transport.mock.calls.filter(([request]) => request.path === "/api/v2/profile" && request.method === "PATCH")).toHaveLength(0);
    expect(transport.mock.calls.filter(([request]) => request.path === "/api/v2/profile/email/change")).toHaveLength(1);
    expect(transport.mock.calls.filter(([request]) => request.path === "/api/v2/profile/email/confirm")).toHaveLength(0);
    expect(transport.mock.calls.filter(([request]) => request.path === "/api/v2/profile/password/change")).toHaveLength(0);
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

  it("freezes the normalized requested email and supports a safe restart", async () => {
    const requestEmailChange = vi.fn(async () => ({ accepted: true as const }));
    const confirmEmailChange = vi.fn(async () => profile);
    const api = client({ requestEmailChange, confirmEmailChange });
    renderCenter({ client: api });
    fireEvent.click(await screen.findByRole("tab", { name: "安全" }));
    fireEvent.change(screen.getByLabelText("新邮箱"), { target: { value: "  NEW@EXAMPLE.TEST " } });
    fireEvent.change(screen.getByLabelText("邮箱变更当前密码"), { target: { value: "current-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "请求邮箱变更" }));
    expect(await screen.findByLabelText("验证码")).toBeInTheDocument();
    const frozenEmail = screen.getByLabelText("新邮箱");
    expect(frozenEmail).toHaveValue("new@example.test");
    expect(frozenEmail).toBeDisabled();
    fireEvent.change(frozenEmail, { target: { value: "attacker@example.test" } });
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "确认邮箱变更" }));
    await waitFor(() => expect(confirmEmailChange).toHaveBeenCalledWith({ new_email: "new@example.test", code: "123456" }));
    fireEvent.change(screen.getByLabelText("新邮箱"), { target: { value: "restart@example.test" } });
    fireEvent.change(screen.getByLabelText("邮箱变更当前密码"), { target: { value: "current-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "请求邮箱变更" }));
    await screen.findByLabelText("验证码");
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "重新开始邮箱变更" }));
    expect(screen.queryByLabelText("验证码")).not.toBeInTheDocument();
    expect(screen.getByLabelText("邮箱变更当前密码")).toHaveValue("");
    expect(screen.getByLabelText("新邮箱")).toHaveValue("");
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
    await waitFor(() => expect(revokeSession).toHaveBeenCalledOnce());
    revoke.reject(new Error("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent("撤销会话失败");
    expect(screen.getByRole("listitem", { name: "其他会话 未知设备" })).toBeInTheDocument();
    await waitFor(() => expect(revokeButton).toHaveFocus());
  });

  it("portals the revoke dialog, contains focus, closes safely, and restores modal context", async () => {
    const api = client();
    const view = renderCenterInWorkbench(api);
    fireEvent.click(await screen.findByRole("tab", { name: "安全" }));
    const revokeButton = await screen.findByRole("button", { name: "撤销此会话" });
    fireEvent.click(revokeButton);
    const dialog = await screen.findByRole("dialog", { name: "确认撤销会话" });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog).toContainElement(document.activeElement);
    expect(document.querySelector(".workbench-canvas")).toHaveAttribute("inert", "");
    const cancel = screen.getByRole("button", { name: "取消撤销" });
    const confirm = screen.getByRole("button", { name: "确认撤销" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "确认撤销会话" })).not.toBeInTheDocument();
    expect(document.querySelector(".workbench-canvas")).not.toHaveAttribute("inert");
    await waitFor(() => expect(revokeButton).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "确认撤销会话" })).not.toBeInTheDocument();
    view.unmount();
  });

  it("restores revoke focus only after modal teardown removes inert", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const api = client();
    renderCenterInWorkbench(api);
    fireEvent.click(await screen.findByRole("tab", { name: "安全" }));
    const revokeButton = await screen.findByRole("button", { name: "撤销此会话" });
    const focus = vi.spyOn(revokeButton, "focus");
    fireEvent.click(revokeButton);
    fireEvent.click(await screen.findByRole("button", { name: "取消撤销" }));
    expect(screen.queryByRole("dialog", { name: "确认撤销会话" })).not.toBeInTheDocument();
    expect(document.querySelector(".workbench-canvas")).not.toHaveAttribute("inert");
    expect(focus).not.toHaveBeenCalled();
    const frame = frames.shift();
    expect(frame).toBeDefined();
    await act(async () => {
      frame?.(0);
    });
    expect(focus).toHaveBeenCalledOnce();
    expect(revokeButton).toHaveFocus();
  });

  it("focuses the surviving sessions heading after successful revoke and ignores an old refresh", async () => {
    const oldRefresh = deferred<typeof currentSession[]>();
    const api = client({
      listSessions: vi.fn().mockResolvedValueOnce([currentSession, otherSession]).mockReturnValueOnce(oldRefresh.promise).mockResolvedValueOnce([currentSession]),
      revokeSession: vi.fn(async () => ({ revoked: true as const })),
    });
    renderCenter({ client: api });
    fireEvent.click(await screen.findByRole("tab", { name: "安全" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    const revokeButton = await screen.findByRole("button", { name: "撤销此会话" });
    fireEvent.click(revokeButton);
    fireEvent.click(await screen.findByRole("button", { name: "确认撤销" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "撤销此会话" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("heading", { name: "登录会话" })).toHaveFocus());
    oldRefresh.resolve([currentSession, otherSession]);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("button", { name: "撤销此会话" })).not.toBeInTheDocument();
  });

  it("settles refresh loading and replaces an aborted refresh after revoke failure", async () => {
    const oldRefresh = deferred<typeof currentSession[]>();
    const replacementRefresh = deferred<typeof currentSession[]>();
    const revoke = deferred<{ revoked: true }>();
    const staleSession = { ...otherSession, id: "stale" };
    const listSessions = vi.fn()
      .mockResolvedValueOnce([currentSession, otherSession])
      .mockReturnValueOnce(oldRefresh.promise)
      .mockReturnValueOnce(replacementRefresh.promise);
    const api = client({ listSessions, revokeSession: vi.fn(() => revoke.promise) });
    renderCenter({ client: api });
    fireEvent.click(await screen.findByRole("tab", { name: "安全" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销此会话" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认撤销" }));
    await waitFor(() => expect(api.revokeSession).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
    revoke.reject(new Error("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent("撤销会话失败");
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("button", { name: "刷新" })).toBeDisabled();
    replacementRefresh.resolve([currentSession, otherSession]);
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
    expect(screen.getByRole("listitem", { name: "其他会话 未知设备" })).toBeInTheDocument();
    oldRefresh.resolve([currentSession, staleSession]);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("listitem", { name: /stale/ })).not.toBeInTheDocument();
  });

  it("removes another session only after a successful confirmed revoke", async () => {
    const revokeSession = vi.fn(async () => ({ revoked: true as const }));
    const listSessions = vi.fn().mockResolvedValueOnce([currentSession, otherSession]).mockResolvedValueOnce([currentSession]);
    const api = client({ revokeSession, listSessions });
    renderCenter({ client: api });
    fireEvent.click(await screen.findByRole("tab", { name: "安全" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销此会话" }));
    fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "撤销此会话" })).not.toBeInTheDocument());
    expect(revokeSession).toHaveBeenCalledWith("s2");
  });

  it("implements the account-tab ARIA and keyboard contract without resetting panels", async () => {
    renderCenter();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["总览", "个人资料", "安全", "工作区", "偏好与通知", "数据与隐私", "AI 控制"]);
    expect(tabs[1]).toHaveAttribute("aria-controls", "account-panel-profile");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("tabindex", "0");
    await waitFor(() => expect(screen.getByLabelText("昵称")).toHaveValue("用户"));
    fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "跨标签草稿" } });
    fireEvent.keyDown(tabs[1]!, { key: "ArrowRight" });
    expect(tabs[2]).toHaveFocus();
    fireEvent.keyDown(tabs[2]!, { key: "End" });
    expect(tabs[6]).toHaveFocus();
    fireEvent.keyDown(tabs[6]!, { key: "Home" });
    expect(tabs[0]).toHaveFocus();
    fireEvent.click(tabs[3]!);
    expect(screen.getByRole("heading", { name: "工作区" })).toBeInTheDocument();
    fireEvent.click(tabs[1]!);
    expect(screen.getByLabelText("昵称")).toHaveValue("跨标签草稿");
    const activePanel = screen.getByRole("tabpanel");
    expect(activePanel).toHaveAttribute("aria-labelledby", "account-tab-profile");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "工作区" })).not.toBeInTheDocument();
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

  it("shows every workspace role and only exposes member administration to the active owner", async () => {
    const collaborationClient = collaboration();
    const ownerView = renderCenter({ workspaces, activeWorkspaceId: "ws-1", collaboration: collaborationClient, currentUserId: "u1" });
    fireEvent.click(await screen.findByRole("tab", { name: "工作区" }));

    expect(screen.getByRole("listitem", { name: "个人空间 所有者 当前工作区" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "研究团队 编辑者" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "只读资料 查看者" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "成员管理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除 协作者" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "移除 当前用户" })).toBeDisabled();
    ownerView.unmount();

    const editorView = renderCenter({ workspaces, activeWorkspaceId: "ws-2", collaboration: collaboration(), currentUserId: "u1" });
    fireEvent.click(screen.getByRole("tab", { name: "工作区" }));
    expect(screen.getByText("你在此工作区拥有编辑权限，只有所有者可以管理成员。" )).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "成员管理" })).not.toBeInTheDocument();
    editorView.unmount();
  });

  it("exposes team workspace creation in the workspace tab and forwards the trimmed name", async () => {
    const createWorkspace = vi.fn(async () => ({
      id: "ws-new",
      name: "研究团队",
      slug: "team-ws-new",
      role: "owner" as const,
      revision: 1,
    }));
    renderCenter({
      workspaces: [workspaces[0]],
      activeWorkspaceId: "ws-1",
      onCreateWorkspace: createWorkspace,
    });

    fireEvent.click(await screen.findByRole("tab", { name: "工作区" }));
    fireEvent.change(screen.getByLabelText("新工作区名称"), { target: { value: "  研究团队  " } });
    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));

    await waitFor(() => expect(createWorkspace).toHaveBeenCalledWith("研究团队"));
    expect(await screen.findByRole("status")).toHaveTextContent("研究团队");
  });

  it("switches exactly once, deduplicates pending activation, and keeps the active workspace on failure", async () => {
    const first = deferred<void>();
    const onWorkspaceChange = vi.fn(() => first.promise);
    renderCenter({ workspaces, activeWorkspaceId: "ws-1", collaboration: collaboration(), currentUserId: "u1", onWorkspaceChange });
    fireEvent.click(await screen.findByRole("tab", { name: "工作区" }));
    const switchButton = screen.getByRole("button", { name: "切换到 研究团队" });
    act(() => { switchButton.click(); switchButton.click(); });
    await waitFor(() => expect(onWorkspaceChange).toHaveBeenCalledOnce());
    expect(switchButton).toBeDisabled();
    first.reject(new Error("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent("切换工作区失败");
    expect(screen.getByRole("listitem", { name: "个人空间 所有者 当前工作区" })).toBeInTheDocument();
  });

  it("ignores an old workspace member response after the active workspace changes", async () => {
    const stale = deferred<Array<typeof editorMember>>();
    const firstClient = collaboration({ listMembers: vi.fn(() => stale.promise) });
    const nextMember = { ...editorMember, user_id: "u3", display_name: "新空间成员" };
    const secondClient = collaboration({ listMembers: vi.fn(async () => [nextMember]) });
    const view = renderCenter({ workspaces, activeWorkspaceId: "ws-1", collaboration: firstClient, currentUserId: "u1" });
    fireEvent.click(await screen.findByRole("tab", { name: "工作区" }));
    const nextWorkspaces = workspaces.map((workspace) => workspace.id === "ws-2" ? { ...workspace, role: "owner" as const } : workspace);
    view.rerender(<AccountCenter client={client()} workspaces={nextWorkspaces} activeWorkspaceId="ws-2" onWorkspaceChange={vi.fn()} onDeleted={vi.fn()} collaboration={secondClient as any} currentUserId="u1" initialTab="workspace" />);
    expect(await screen.findByText("新空间成员")).toBeInTheDocument();
    stale.resolve([editorMember]);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText("协作者")).not.toBeInTheDocument();
  });

  it("keeps member state authoritative across role failure and confirmed removal failure", async () => {
    const api = collaboration({
      updateMemberRole: vi.fn(async () => { throw new Error("conflict"); }),
      removeMember: vi.fn(async () => { throw new Error("offline"); }),
    });
    renderCenter({ workspaces, activeWorkspaceId: "ws-1", collaboration: api, currentUserId: "u1" });
    fireEvent.click(await screen.findByRole("tab", { name: "工作区" }));
    const role = await screen.findByRole("combobox", { name: "协作者 的角色" });
    fireEvent.change(role, { target: { value: "viewer" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("更新成员角色失败");
    expect(api.updateMemberRole).toHaveBeenCalledWith("u2", { role: "viewer", base_revision: 2 }, expect.any(AbortSignal));
    expect(role).toHaveValue("editor");

    const removeOrigin = screen.getByRole("button", { name: "移除 协作者" });
    fireEvent.click(removeOrigin);
    expect(await screen.findByRole("dialog", { name: "确认移除成员" })).toBeInTheDocument();
    const confirmRemoval = screen.getByRole("button", { name: "确认移除" });
    act(() => { confirmRemoval.click(); confirmRemoval.click(); });
    expect(await screen.findByRole("alert")).toHaveTextContent("移除成员失败");
    expect(api.removeMember).toHaveBeenCalledOnce();
    expect(api.removeMember).toHaveBeenCalledWith("u2", 2, expect.any(AbortSignal));
    expect(screen.getByText("协作者")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "确认移除成员" })).not.toBeInTheDocument();
    await waitFor(() => expect(removeOrigin).toHaveFocus());
  });

  it("restores member removal focus to the origin on cancel and to the list heading on success", async () => {
    const api = collaboration();
    renderCenter({ workspaces, activeWorkspaceId: "ws-1", collaboration: api, currentUserId: "u1" });
    fireEvent.click(await screen.findByRole("tab", { name: "工作区" }));
    const removeOrigin = await screen.findByRole("button", { name: "移除 协作者" });

    fireEvent.click(removeOrigin);
    fireEvent.click(await screen.findByRole("button", { name: "取消移除" }));
    await waitFor(() => expect(removeOrigin).toHaveFocus());

    fireEvent.click(removeOrigin);
    fireEvent.click(await screen.findByRole("button", { name: "确认移除" }));
    expect(await screen.findByRole("status")).toHaveTextContent("协作者 已移除");
    await waitFor(() => expect(screen.getByRole("heading", { name: "成员管理" })).toHaveFocus());
  });

  it("loads usage and service status independently and retries only the failed resource", async () => {
    const retryUsage = deferred<{ notes: number; databases: number; attachment_bytes: number; queued_jobs: number }>();
    const api = operations({
      getUsage: vi.fn().mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(retryUsage.promise),
    });
    renderCenter({ workspaces, activeWorkspaceId: "ws-1", operations: api });
    fireEvent.click(await screen.findByRole("tab", { name: "数据与隐私" }));
    expect(await screen.findByText("队列：正常")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("用量加载失败");
    expect(screen.getByText("未配置自动备份，可立即导出")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试用量加载" }));
    retryUsage.resolve({ notes: 9, databases: 2, attachment_bytes: 2048, queued_jobs: 1 });
    expect(await screen.findByText("9 条笔记")).toBeInTheDocument();
    expect(api.getStatus).toHaveBeenCalledOnce();
  });

  it("reuses an export idempotency key after response loss, deduplicates clicks, and rotates it after success", async () => {
    const ids = vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002");
    const first = deferred<typeof job>();
    const second = deferred<typeof job>();
    const third = deferred<typeof job>();
    const createJob = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    renderCenter({ workspaces, activeWorkspaceId: "ws-1", operations: operations({ createJob }) });
    fireEvent.click(await screen.findByRole("tab", { name: "数据与隐私" }));
    const exportButton = screen.getByRole("button", { name: "导出全部数据" });
    act(() => { exportButton.click(); exportButton.click(); });
    expect(createJob).toHaveBeenCalledOnce();
    first.reject(new Error("response lost"));
    expect(await screen.findByRole("alert")).toHaveTextContent("导出请求失败");
    fireEvent.click(screen.getByRole("button", { name: "重试导出" }));
    expect(createJob).toHaveBeenLastCalledWith({ kind: "export", idempotency_key: "00000000-0000-4000-8000-000000000001", payload: { format: "zip", scope: "workspace" } });
    second.resolve(job);
    expect(await screen.findByRole("status")).toHaveTextContent("job-1");
    fireEvent.click(screen.getByRole("button", { name: "再次导出" }));
    expect(createJob).toHaveBeenLastCalledWith({ kind: "export", idempotency_key: "00000000-0000-4000-8000-000000000002", payload: { format: "zip", scope: "workspace" } });
    expect(ids).toHaveBeenCalledTimes(2);
    third.resolve(job);
  });

  it("ignores an old workspace export success and uses a new client and key after workspace change", async () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000011")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000012");
    const oldExport = deferred<typeof job>();
    const newJob = { ...job, id: "job-2", workspace_id: "ws-2" };
    const oldCreateJob = vi.fn(() => oldExport.promise);
    const newCreateJob = vi.fn(async () => newJob);
    const profileApi = client();
    const view = renderCenter({ client: profileApi, workspaces, activeWorkspaceId: "ws-1", operations: operations({ createJob: oldCreateJob }) });
    fireEvent.click(await screen.findByRole("tab", { name: "数据与隐私" }));
    fireEvent.click(screen.getByRole("button", { name: "导出全部数据" }));

    view.rerender(<AccountCenter client={profileApi} workspaces={workspaces} activeWorkspaceId="ws-2" onWorkspaceChange={vi.fn()} onDeleted={vi.fn()} operations={operations({ createJob: newCreateJob })} initialTab="privacy" />);
    expect(await screen.findByRole("button", { name: "导出全部数据" })).toBeEnabled();
    oldExport.resolve(job);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText("导出任务 job-1：queued")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "导出全部数据" }));
    expect(newCreateJob).toHaveBeenCalledWith({ kind: "export", idempotency_key: "00000000-0000-4000-8000-000000000012", payload: { format: "zip", scope: "workspace" } });
    expect(await screen.findByText("导出任务 job-2：queued")).toBeInTheDocument();
    expect(oldCreateJob).toHaveBeenCalledWith({ kind: "export", idempotency_key: "00000000-0000-4000-8000-000000000011", payload: { format: "zip", scope: "workspace" } });
  });

  it("ignores an old workspace export rejection and finally while a new export is pending", async () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000021")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000022");
    const oldExport = deferred<typeof job>();
    const newExport = deferred<typeof job>();
    const profileApi = client();
    const view = renderCenter({ client: profileApi, workspaces, activeWorkspaceId: "ws-1", operations: operations({ createJob: vi.fn(() => oldExport.promise) }) });
    fireEvent.click(await screen.findByRole("tab", { name: "数据与隐私" }));
    fireEvent.click(screen.getByRole("button", { name: "导出全部数据" }));

    const newCreateJob = vi.fn(() => newExport.promise);
    view.rerender(<AccountCenter client={profileApi} workspaces={workspaces} activeWorkspaceId="ws-2" onWorkspaceChange={vi.fn()} onDeleted={vi.fn()} operations={operations({ createJob: newCreateJob })} initialTab="privacy" />);
    fireEvent.click(await screen.findByRole("button", { name: "导出全部数据" }));
    expect(screen.getByRole("button", { name: "正在创建导出…" })).toBeDisabled();
    oldExport.reject(new Error("old workspace response lost"));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("alert", { name: /导出/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "正在创建导出…" })).toBeDisabled();
    expect(newCreateJob).toHaveBeenCalledWith({ kind: "export", idempotency_key: "00000000-0000-4000-8000-000000000022", payload: { format: "zip", scope: "workspace" } });
    newExport.resolve({ ...job, id: "job-2", workspace_id: "ws-2" });
    expect(await screen.findByText("导出任务 job-2：queued")).toBeInTheDocument();
  });

  it("requires the exact phrase and uses a portal focus-trapped second deletion confirmation", async () => {
    const api = client();
    renderCenterInWorkbench(api, { workspaces, activeWorkspaceId: "ws-1", operations: operations() });
    fireEvent.click(await screen.findByRole("tab", { name: "数据与隐私" }));
    const deleteButton = screen.getByRole("button", { name: "永久删除账户" });
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "current-password" } });
    fireEvent.change(screen.getByLabelText("删除确认文字"), { target: { value: "永久删除我的帐户" } });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("删除确认文字"), { target: { value: "永久删除我的账户" } });
    fireEvent.click(deleteButton);
    expect(api.deleteAccount).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: "最后确认删除账户" });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(document.querySelector(".workbench-canvas")).toHaveAttribute("inert", "");
    const cancel = screen.getByRole("button", { name: "取消删除" });
    const confirm = screen.getByRole("button", { name: "确认永久删除" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "最后确认删除账户" })).not.toBeInTheDocument();
    expect(document.querySelector(".workbench-canvas")).not.toHaveAttribute("inert");
    await waitFor(() => expect(deleteButton).toHaveFocus());
    fireEvent.click(deleteButton);
    fireEvent.click(await screen.findByRole("button", { name: "取消删除" }));
    await waitFor(() => expect(deleteButton).toHaveFocus());
  });

  it("orders deletion preparation, request, and completion while deduplicating submit", async () => {
    const order: string[] = [];
    const deletion = deferred<{ deleted: true }>();
    const api = client({ deleteAccount: vi.fn(() => { order.push("delete"); return deletion.promise; }) });
    const onPrepareDelete = vi.fn(async () => { order.push("quiesce"); });
    const onDeleted = vi.fn(() => { order.push("deleted"); });
    renderCenter({ client: api, workspaces, activeWorkspaceId: "ws-1", operations: operations(), onPrepareDelete, onDeleted });
    fireEvent.click(await screen.findByRole("tab", { name: "数据与隐私" }));
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "current-password" } });
    fireEvent.change(screen.getByLabelText("删除确认文字"), { target: { value: "永久删除我的账户" } });
    fireEvent.click(screen.getByRole("button", { name: "永久删除账户" }));
    const confirm = await screen.findByRole("button", { name: "确认永久删除" });
    act(() => { confirm.click(); confirm.click(); });
    await waitFor(() => expect(api.deleteAccount).toHaveBeenCalledOnce());
    expect(screen.getByRole("dialog", { name: "最后确认删除账户" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消删除" })).toBeDisabled();
    expect(order).toEqual(["quiesce", "delete"]);
    deletion.resolve({ deleted: true });
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(order).toEqual(["quiesce", "delete", "deleted"]);
    expect(api.deleteAccount).toHaveBeenCalledWith({ current_password: "current-password", confirmation: "永久删除我的账户" });
    await waitFor(() => expect(screen.getByRole("heading", { name: "删除账户" })).toHaveFocus());
  });

  it("resumes drafts and preserves secrets plus ownership recovery details after deletion failure", async () => {
    const ownership = new ApiClientError({
      code: "OWNERSHIP_TRANSFER_REQUIRED",
      message: "Transfer owned team workspaces before deleting the account: 研究团队, 发布空间",
      retryable: false,
    }, 409);
    const api = client({ deleteAccount: vi.fn(async () => { throw ownership; }) });
    const onDeleteFailed = vi.fn();
    renderCenter({ client: api, workspaces, activeWorkspaceId: "ws-1", operations: operations(), onPrepareDelete: vi.fn(async () => undefined), onDeleteFailed });
    fireEvent.click(await screen.findByRole("tab", { name: "数据与隐私" }));
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "current-password" } });
    fireEvent.change(screen.getByLabelText("删除确认文字"), { target: { value: "永久删除我的账户" } });
    const deleteOrigin = screen.getByRole("button", { name: "永久删除账户" });
    fireEvent.click(deleteOrigin);
    fireEvent.click(await screen.findByRole("button", { name: "确认永久删除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("研究团队, 发布空间");
    expect(onDeleteFailed).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "最后确认删除账户" })).not.toBeInTheDocument();
    await waitFor(() => expect(deleteOrigin).toHaveFocus());
    expect(screen.getByLabelText("当前密码")).toHaveValue("current-password");
    expect(screen.getByLabelText("删除确认文字")).toHaveValue("永久删除我的账户");
    expect(deleteOrigin).toBeEnabled();
  });
});
