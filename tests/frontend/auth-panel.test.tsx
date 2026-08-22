import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingVerificationAuth } from "@/types/auth";

vi.mock("@/components/ui/TurnstileWidget", () => ({
  TurnstileWidget: ({ onTokenChange }: { onTokenChange: (token: string) => void }) => (
    <button type="button" onClick={() => onTokenChange("token-ok")}>
      mock-turnstile
    </button>
  ),
}));

async function loadAuthPanel() {
  const mod = await import("@/components/auth/AuthPanel");
  return mod.AuthPanel;
}

const pendingVerification: PendingVerificationAuth = {
  pending_verification: true,
  email: "a@test.com",
  email_masked: "a****@test.com",
  verification_expires_at: "2026-05-08T00:00:00.000Z",
};

describe("AuthPanel", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "site-key");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("submits login without requiring turnstile", async () => {
    const AuthPanel = await loadAuthPanel();
    const onLogin = vi.fn().mockResolvedValue(undefined);

    render(
      <AuthPanel
        loading={false}
        onLogin={onLogin}
        onRegister={vi.fn().mockResolvedValue(pendingVerification)}
        onVerifyEmailCode={vi.fn().mockResolvedValue(undefined)}
        onResendVerificationCode={vi.fn().mockResolvedValue(pendingVerification)}
        onForgotPassword={vi.fn().mockResolvedValue(undefined)}
        onResetPassword={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("邮箱"), { target: { value: "a@test.com" } });
    fireEvent.change(screen.getByPlaceholderText("密码"), { target: { value: "password123" } });
    expect(screen.getByPlaceholderText("邮箱")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByPlaceholderText("密码")).toHaveAttribute("autocomplete", "current-password");
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith({
        email: "a@test.com",
        password: "password123",
      });
    });
  });

  it("keeps login usable when turnstile site key is missing", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    const AuthPanel = await loadAuthPanel();
    const onLogin = vi.fn().mockResolvedValue(undefined);

    render(
      <AuthPanel
        loading={false}
        onLogin={onLogin}
        onRegister={vi.fn().mockResolvedValue(pendingVerification)}
        onVerifyEmailCode={vi.fn().mockResolvedValue(undefined)}
        onResendVerificationCode={vi.fn().mockResolvedValue(pendingVerification)}
        onForgotPassword={vi.fn().mockResolvedValue(undefined)}
        onResetPassword={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("邮箱"), { target: { value: "a@test.com" } });
    fireEvent.change(screen.getByPlaceholderText("密码"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith({
        email: "a@test.com",
        password: "password123",
      });
    });
  });

  it("shows turnstile before submitting forgot password", async () => {
    const AuthPanel = await loadAuthPanel();
    const onForgotPassword = vi.fn().mockResolvedValue(undefined);

    render(
      <AuthPanel
        loading={false}
        onLogin={vi.fn().mockResolvedValue(undefined)}
        onRegister={vi.fn().mockResolvedValue(pendingVerification)}
        onVerifyEmailCode={vi.fn().mockResolvedValue(undefined)}
        onResendVerificationCode={vi.fn().mockResolvedValue(pendingVerification)}
        onForgotPassword={onForgotPassword}
        onResetPassword={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "忘记密码" }));
    expect(screen.queryByPlaceholderText("密码")).not.toBeInTheDocument();
    expect(screen.getByText("mock-turnstile")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("邮箱"), { target: { value: "a@test.com" } });
    fireEvent.click(screen.getByText("mock-turnstile"));
    fireEvent.click(screen.getByRole("button", { name: "忘记密码" }));

    await waitFor(() => {
      expect(onForgotPassword).toHaveBeenCalledWith("a@test.com", "token-ok");
    });
  });

  it("switches to verification step after register", async () => {
    const AuthPanel = await loadAuthPanel();
    const onRegister = vi.fn().mockResolvedValue(pendingVerification);

    render(
      <AuthPanel
        loading={false}
        onLogin={vi.fn().mockResolvedValue(undefined)}
        onRegister={onRegister}
        onVerifyEmailCode={vi.fn().mockResolvedValue(undefined)}
        onResendVerificationCode={vi.fn().mockResolvedValue(pendingVerification)}
        onForgotPassword={vi.fn().mockResolvedValue(undefined)}
        onResetPassword={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "注册" }));
    expect(screen.getByPlaceholderText("密码")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByPlaceholderText("确认密码")).toHaveAttribute("autocomplete", "new-password");
    fireEvent.change(screen.getByPlaceholderText("邮箱"), { target: { value: "a@test.com" } });
    fireEvent.change(screen.getByPlaceholderText("密码"), { target: { value: "password123" } });
    fireEvent.change(screen.getByPlaceholderText("确认密码"), { target: { value: "password123" } });
    fireEvent.click(screen.getByText("mock-turnstile"));
    fireEvent.click(screen.getByRole("button", { name: "注册" }));

    await waitFor(() => {
      expect(onRegister).toHaveBeenCalled();
      expect(screen.getByPlaceholderText("输入 6 位验证码")).toBeInTheDocument();
    });
  });

  it("does not resend verification twice while the first request is pending", async () => {
    const AuthPanel = await loadAuthPanel();
    let resolveResend!: () => void;
    const resendPending = new Promise<PendingVerificationAuth>((resolve) => {
      resolveResend = () => resolve(pendingVerification);
    });
    const onResendVerificationCode = vi.fn(() => resendPending);

    render(
      <AuthPanel
        loading={false}
        onLogin={vi.fn().mockResolvedValue(undefined)}
        onRegister={vi.fn().mockResolvedValue(pendingVerification)}
        onVerifyEmailCode={vi.fn().mockResolvedValue(undefined)}
        onResendVerificationCode={onResendVerificationCode}
        onForgotPassword={vi.fn().mockResolvedValue(undefined)}
        onResetPassword={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "注册" }));
    fireEvent.change(screen.getByPlaceholderText("邮箱"), { target: { value: "a@test.com" } });
    fireEvent.change(screen.getByPlaceholderText("密码"), { target: { value: "password123" } });
    fireEvent.change(screen.getByPlaceholderText("确认密码"), { target: { value: "password123" } });
    fireEvent.click(screen.getByText("mock-turnstile"));
    fireEvent.click(screen.getByRole("button", { name: "注册" }));
    await screen.findByPlaceholderText("输入 6 位验证码");

    const resend = screen.getByRole("button", { name: "重新发送验证码" });
    resend.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    resend.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onResendVerificationCode).toHaveBeenCalledTimes(1);
    resolveResend();
    await waitFor(() => expect(onResendVerificationCode).toHaveBeenCalledOnce());
  });
});
