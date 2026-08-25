import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeatureHub } from "../src/features/FeatureHub";

describe("FeatureHub", () => {
  it("shows every product area and navigates through available entries", () => {
    const onNavigate = vi.fn();
    render(<FeatureHub onNavigate={onNavigate} availability={{ collaboration: false }} />);

    expect(screen.getByRole("heading", { name: "功能地图" })).toBeInTheDocument();
    for (const label of ["笔记", "数据库", "知识整理", "提醒", "协作", "AI 助手", "个人中心"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: /个人中心/ }));
    expect(onNavigate).toHaveBeenCalledWith("account");
    expect(screen.getByRole("button", { name: /协作.*当前不可用/ })).toBeDisabled();
  });
});
