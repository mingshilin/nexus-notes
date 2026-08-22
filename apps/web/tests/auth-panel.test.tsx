import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

type WebExports = Record<string, unknown>;

async function loadWeb() {
  return (await import("../src/index")) as WebExports;
}

describe("AuthPanel", () => {
  it("keeps low-risk login free of a human-verification widget", async () => {
    const web = await loadWeb();
    expect(web.AuthPanel).toBeTypeOf("function");
    const client = { login: vi.fn(async () => ({ user: { id: "user-1", email: "user@example.com" } })) };
    const onAuthenticated = vi.fn();
    const AuthPanel = web.AuthPanel as any;
    render(<AuthPanel client={client} onAuthenticated={onAuthenticated} turnstileSiteKey="test-site-key" />);

    expect(screen.queryByTestId("turnstile-widget")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "long-enough-123" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(client.login).toHaveBeenCalledWith({
      email: "user@example.com", password: "long-enough-123", turnstileToken: undefined,
    }));
    expect(onAuthenticated).toHaveBeenCalledOnce();
  });

  it("shows human verification for registration and password recovery", async () => {
    const web = await loadWeb();
    const AuthPanel = web.AuthPanel as any;
    const client = {};
    render(<AuthPanel client={client} onAuthenticated={vi.fn()} turnstileSiteKey="test-site-key" />);

    fireEvent.click(screen.getByRole("button", { name: "注册账户" }));
    expect(screen.getByTestId("turnstile-widget")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "忘记密码" }));
    expect(screen.getByTestId("turnstile-widget")).toBeInTheDocument();
  });

  it("recovers a rejected registration challenge with one request and a fresh token", async () => {
    const web = await loadWeb();
    const AuthPanel = web.AuthPanel as any;
    let challengeCallback!: (token: string) => void;
    const turnstile = {
      render: vi.fn((_container: unknown, options: { callback(token: string): void }) => {
        challengeCallback = options.callback;
        return "widget-" + turnstile.render.mock.calls.length;
      }),
      remove: vi.fn(),
      reset: vi.fn(),
    };
    window.turnstile = turnstile as any;
    const challengeError = Object.assign(new Error("Human verification failed"), {
      code: "CHALLENGE_FAILED",
    });
    const client = {
      register: vi.fn()
        .mockRejectedValueOnce(challengeError)
        .mockResolvedValueOnce({ userId: "user-1", email: "user@example.com", verificationRequired: true }),
    };

    try {
      render(<AuthPanel client={client} onAuthenticated={vi.fn()} turnstileSiteKey="test-site-key" />);
      fireEvent.click(screen.getByRole("button", { name: "注册账户" }));
      fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Beta User" } });
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "long-enough-123" } });

      await waitFor(() => expect(turnstile.render).toHaveBeenCalledOnce());
      act(() => challengeCallback("stale-token"));
      fireEvent.click(screen.getByRole("button", { name: "创建账户" }));

      await waitFor(() => expect(client.register).toHaveBeenCalledTimes(1));
      expect(await screen.findByRole("alert")).toHaveTextContent("本次人机验证已失效，请重新验证后再提交。");
      await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2));
      expect(screen.getByRole("button", { name: "创建账户" })).toBeDisabled();

      act(() => challengeCallback("fresh-token"));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "创建账户" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "创建账户" }));

      await waitFor(() => expect(client.register).toHaveBeenCalledTimes(2));
      expect(client.register).toHaveBeenLastCalledWith({
        email: "user@example.com",
        password: "long-enough-123",
        displayName: "Beta User",
        turnstileToken: "fresh-token",
      });
      expect(await screen.findByRole("heading", { name: "验证邮箱" })).toBeInTheDocument();
    } finally {
      delete window.turnstile;
    }
  });

  it("reveals login verification only after a risk challenge response", async () => {
    const web = await loadWeb();
    const AuthPanel = web.AuthPanel as any;
    const client = {
      login: vi.fn(async () => {
        throw Object.assign(new Error("需要完成人机验证"), { code: "CHALLENGE_REQUIRED" });
      }),
    };
    render(<AuthPanel client={client} onAuthenticated={vi.fn()} turnstileSiteKey="test-site-key" />);

    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "long-enough-123" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(screen.getByTestId("turnstile-widget")).toBeInTheDocument());
  });

  it("moves unverified users into an email-aware verification flow", async () => {
    const web = await loadWeb();
    const AuthPanel = web.AuthPanel as any;
    const client = {
      login: vi.fn(async () => {
        throw Object.assign(new Error("Email verification is required"), { code: "EMAIL_NOT_VERIFIED" });
      }),
      verifyEmail: vi.fn(async () => ({ verified: true })),
    };
    render(<AuthPanel client={client} onAuthenticated={vi.fn()} turnstileSiteKey="test-site-key" />);

    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "long-enough-123" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("heading", { name: "验证邮箱" })).toBeInTheDocument();
    expect(screen.getByLabelText("邮箱")).toHaveValue("user@example.com");
    const codeInput = screen.getByLabelText("验证码");
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.click(within(codeInput.closest("form")!).getByRole("button", { name: "验证邮箱" }));

    await waitFor(() => expect(client.verifyEmail).toHaveBeenCalledWith({
      email: "user@example.com",
      code: "123456",
    }));
  });

  it("requires a verification challenge before resending an email code", async () => {
    const web = await loadWeb();
    const AuthPanel = web.AuthPanel as any;
    let challengeCallback!: (token: string) => void;
    const turnstile = {
      render: vi.fn((_container: unknown, options: { action: string; callback(token: string): void }) => {
        expect(options.action).toBe("verify_email");
        challengeCallback = options.callback;
        return "widget-1";
      }),
      remove: vi.fn(),
    };
    window.turnstile = turnstile as any;
    const client = { resendVerification: vi.fn(async () => ({ accepted: true })) };
    try {
      render(<AuthPanel client={client} onAuthenticated={vi.fn()} turnstileSiteKey="test-site-key" />);
      fireEvent.click(screen.getByRole("button", { name: "验证邮箱" }));
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });

      const resend = screen.getByRole("button", { name: "重新发送验证码" });
      expect(resend).toBeDisabled();
      await waitFor(() => expect(turnstile.render).toHaveBeenCalledOnce());
      act(() => challengeCallback("challenge-verify"));
      expect(resend).toBeEnabled();
      fireEvent.click(resend);

      await waitFor(() => expect(client.resendVerification).toHaveBeenCalledWith({
        email: "user@example.com",
        turnstileToken: "challenge-verify",
      }));
    } finally {
      delete window.turnstile;
    }
  });

  it("recovers a rejected resend challenge with a fresh verification token", async () => {
    const web = await loadWeb();
    const AuthPanel = web.AuthPanel as any;
    let challengeCallback!: (token: string) => void;
    const turnstile = {
      render: vi.fn((_container: unknown, options: { callback(token: string): void }) => {
        challengeCallback = options.callback;
        return "widget-resend";
      }),
      remove: vi.fn(),
      reset: vi.fn(),
    };
    window.turnstile = turnstile as any;
    const challengeError = Object.assign(new Error("Human verification failed"), {
      code: "CHALLENGE_FAILED",
    });
    const client = {
      resendVerification: vi.fn()
        .mockRejectedValueOnce(challengeError)
        .mockResolvedValueOnce({ accepted: true }),
    };

    try {
      render(<AuthPanel client={client} onAuthenticated={vi.fn()} turnstileSiteKey="test-site-key" />);
      fireEvent.click(screen.getByRole("button", { name: "验证邮箱" }));
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      await waitFor(() => expect(turnstile.render).toHaveBeenCalledOnce());
      act(() => challengeCallback("stale-resend-token"));
      fireEvent.click(screen.getByRole("button", { name: "重新发送验证码" }));

      await waitFor(() => expect(client.resendVerification).toHaveBeenCalledTimes(1));
      expect(await screen.findByRole("alert")).toHaveTextContent("本次人机验证已失效，请重新验证后再提交。");
      await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2));
      act(() => challengeCallback("fresh-resend-token"));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "重新发送验证码" }));
      await waitFor(() => expect(client.resendVerification).toHaveBeenCalledTimes(2));
      expect(client.resendVerification).toHaveBeenLastCalledWith({
        email: "user@example.com",
        turnstileToken: "fresh-resend-token",
      });
    } finally {
      delete window.turnstile;
    }
  });

  it("resets a consumed verification token once after a resend success", async () => {
    const web = await loadWeb();
    const AuthPanel = web.AuthPanel as any;
    let challengeCallback!: (token: string) => void;
    const turnstile = {
      render: vi.fn((_container: unknown, options: { callback(token: string): void }) => {
        challengeCallback = options.callback;
        return `widget-${turnstile.render.mock.calls.length + 1}`;
      }),
      remove: vi.fn(),
    };
    window.turnstile = turnstile as any;
    const client = { resendVerification: vi.fn(async () => ({ accepted: true })) };
    try {
      render(<AuthPanel client={client} onAuthenticated={vi.fn()} turnstileSiteKey="test-site-key" />);
      fireEvent.click(screen.getByRole("button", { name: "验证邮箱" }));
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      await waitFor(() => expect(turnstile.render).toHaveBeenCalledOnce());
      act(() => challengeCallback("single-use-token"));
      fireEvent.click(screen.getByRole("button", { name: "重新发送验证码" }));

      await waitFor(() => expect(client.resendVerification).toHaveBeenCalledOnce());
      await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2));
    } finally {
      delete window.turnstile;
    }
  });

  it("resets a consumed verification token after a resend failure", async () => {
    const web = await loadWeb();
    const AuthPanel = web.AuthPanel as any;
    let challengeCallback!: (token: string) => void;
    const turnstile = {
      render: vi.fn((_container: unknown, options: { callback(token: string): void }) => {
        challengeCallback = options.callback;
        return `widget-${turnstile.render.mock.calls.length + 1}`;
      }),
      remove: vi.fn(),
    };
    window.turnstile = turnstile as any;
    const client = { resendVerification: vi.fn(async () => { throw new Error("temporary failure"); }) };
    try {
      render(<AuthPanel client={client} onAuthenticated={vi.fn()} turnstileSiteKey="test-site-key" />);
      fireEvent.click(screen.getByRole("button", { name: "验证邮箱" }));
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      await waitFor(() => expect(turnstile.render).toHaveBeenCalledOnce());
      act(() => challengeCallback("single-use-token"));
      fireEvent.click(screen.getByRole("button", { name: "重新发送验证码" }));

      await waitFor(() => expect(client.resendVerification).toHaveBeenCalledOnce());
      await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2));
    } finally {
      delete window.turnstile;
    }
  });

  it("does not send duplicate verification requests while the first resend is pending", async () => {
    const web = await loadWeb();
    const AuthPanel = web.AuthPanel as any;
    let challengeCallback!: (token: string) => void;
    let resolveResend!: () => void;
    const resendPending = new Promise<{ accepted: true }>((resolve) => {
      resolveResend = () => resolve({ accepted: true });
    });
    const turnstile = {
      render: vi.fn((_container: unknown, options: { callback(token: string): void }) => {
        challengeCallback = options.callback;
        return "widget-1";
      }),
      remove: vi.fn(),
    };
    window.turnstile = turnstile as any;
    const client = { resendVerification: vi.fn(() => resendPending) };
    try {
      render(<AuthPanel client={client} onAuthenticated={vi.fn()} turnstileSiteKey="test-site-key" />);
      fireEvent.click(screen.getByRole("button", { name: "验证邮箱" }));
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      await waitFor(() => expect(turnstile.render).toHaveBeenCalledOnce());
      act(() => challengeCallback("single-use-token"));

      const resend = screen.getByRole("button", { name: "重新发送验证码" });
      resend.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      resend.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(client.resendVerification).toHaveBeenCalledTimes(1);
      resolveResend();
      await waitFor(() => expect(screen.getByRole("button", { name: "重新发送验证码" })).toBeDisabled());
    } finally {
      delete window.turnstile;
    }
  });
});
