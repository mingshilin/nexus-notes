import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AIConfigPanel } from "../src/ai/AIConfigPanel";

describe("AI provider selection UI", () => {
  it("offers OrcaRouter with the two verified free model presets", async () => {
    const request = vi.fn(async (input: { path: string }) => {
      if (input.path === "/api/v2/ai/provider") return { source: "system", revision: 1 };
      if (input.path === "/api/v2/ai/config") return { configured: false, source: "unconfigured" };
      throw new Error(`unexpected ${input.path}`);
    });

    render(<AIConfigPanel client={{ request } as never} />);

    const provider = await screen.findByRole("combobox", { name: "AI 服务商" });
    fireEvent.change(provider, { target: { value: "orcarouter" } });

    expect(screen.getByLabelText("AI API 地址")).toHaveValue("https://api.orcarouter.ai/v1");
    expect(screen.getByLabelText("AI 模型")).toHaveValue("deepseek/deepseek-v4-flash-free");

    fireEvent.click(screen.getByRole("button", { name: "使用 Qwen3.8 27B Free" }));
    expect(screen.getByLabelText("AI 模型")).toHaveValue("qwen/qwen3.8-27b-free");

    fireEvent.click(screen.getByRole("button", { name: "使用 DeepSeek V4 Flash Free" }));
    expect(screen.getByLabelText("AI 模型")).toHaveValue("deepseek/deepseek-v4-flash-free");
  });

  it("selects system or personal AI and persists the user choice", async () => {
    const request = vi.fn(async (input: { path: string; method?: string; body?: unknown }) => {
      if (input.path === "/api/v2/ai/provider" && input.method === "PATCH") {
        return { source: "personal", revision: 2 };
      }
      if (input.path === "/api/v2/ai/provider") return { source: "system", revision: 1 };
      if (input.path === "/api/v2/ai/config") return { configured: false, source: "unconfigured" };
      throw new Error(`unexpected ${input.path}`);
    });

    render(<AIConfigPanel client={{ request } as never} status={{
      configured: true,
      source: "server_default",
      selected_source: "system",
      system_configured: true,
      personal_configured: false,
    }} />);

    expect(await screen.findByRole("button", { name: "使用系统 AI" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "使用我的 AI" }));

    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/ai/provider",
      method: "PATCH",
      body: { source: "personal", base_revision: 1 },
    })));
    expect(screen.getByRole("button", { name: "使用我的 AI" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("个人 AI 尚未配置，将自动使用系统 AI。", { exact: false })).toBeInTheDocument();
  });

  it("keeps personal configuration available when system AI is unavailable", async () => {
    const request = vi.fn(async (input: { path: string }) => {
      if (input.path === "/api/v2/ai/provider") return { source: "personal", revision: 1 };
      if (input.path === "/api/v2/ai/config") return { configured: false, source: "unconfigured" };
      throw new Error(`unexpected ${input.path}`);
    });

    render(<AIConfigPanel client={{ request } as never} status={{
      configured: false,
      source: "unconfigured",
      selected_source: "personal",
      system_configured: false,
      personal_configured: false,
    }} />);

    expect(await screen.findByRole("button", { name: "使用我的 AI" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("AI API 地址")).toBeEnabled();
    expect(screen.getByLabelText("AI API Key")).toBeEnabled();
    expect(screen.getByText("系统 AI 当前不可用，请配置我的 AI。", { exact: false })).toBeInTheDocument();
  });
});
