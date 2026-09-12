import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const loaders = vi.hoisted(() => ({
  search: vi.fn(async () => ({ KnowledgeSearchPanel: () => <section aria-label="搜索内容">搜索内容</section> })),
  graph: vi.fn(async () => ({ KnowledgeGraphPanel: () => <section aria-label="图谱内容">图谱内容</section> })),
  calendar: vi.fn(async () => ({ KnowledgeCalendarPanel: () => <section aria-label="日历内容">日历内容</section> })),
  external: vi.fn(async () => ({ ExternalCalendarPanel: () => <section aria-label="外部日历内容">外部日历内容</section> })),
}));

vi.mock("../src/app/workspace-domain-loader", () => ({
  loadKnowledgeSearchPanel: loaders.search,
  loadKnowledgeGraphPanel: loaders.graph,
  loadKnowledgeCalendarPanel: loaders.calendar,
  loadExternalCalendarPanel: loaders.external,
}));

import { KnowledgeDomain } from "../src/app/domains/KnowledgeDomain";

const externalClient = {
  listCalendarConnections: vi.fn(),
  startCalendarConnection: vi.fn(),
  listCalendarEvents: vi.fn(),
  syncCalendarConnection: vi.fn(),
  disconnectCalendarConnection: vi.fn(),
};

describe("KnowledgeDomain on-demand panels", () => {
  it("loads only search initially and mounts secondary panels after explicit expansion", async () => {
    render(<KnowledgeDomain
      client={externalClient as never}
      workspaceId="ws-1"
      role="owner"
      selectedEntity={{ recoveryContent: null }}
      callbacks={{}}
    />);

    expect(await screen.findByRole("region", { name: "搜索内容" })).toBeVisible();
    expect(loaders.search).toHaveBeenCalledOnce();
    expect(loaders.graph).not.toHaveBeenCalled();
    expect(loaders.calendar).not.toHaveBeenCalled();
    expect(loaders.external).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "展开知识图谱" }));
    expect(await screen.findByRole("region", { name: "图谱内容" })).toBeVisible();
    expect(loaders.graph).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "展开知识日历" }));
    expect(await screen.findByRole("region", { name: "日历内容" })).toBeVisible();
    expect(loaders.calendar).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "展开外部日历" }));
    expect(await screen.findByRole("region", { name: "外部日历内容" })).toBeVisible();
    expect(loaders.external).toHaveBeenCalledOnce();
  });

  it("preserves an expanded panel instance when it is collapsed and reopened", async () => {
    render(<KnowledgeDomain
      client={externalClient as never}
      workspaceId="ws-1"
      role="owner"
      selectedEntity={{ recoveryContent: null }}
      callbacks={{}}
    />);

    fireEvent.click(screen.getByRole("button", { name: "展开知识图谱" }));
    const graph = await screen.findByRole("region", { name: "图谱内容" });
    fireEvent.click(screen.getByRole("button", { name: "收起知识图谱" }));

    expect(document.querySelector('[aria-label="图谱内容"]')).toBe(graph);
    expect(graph.parentElement).toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: "展开知识图谱" }));
    expect(document.querySelector('[aria-label="图谱内容"]')).toBe(graph);
  });
});
