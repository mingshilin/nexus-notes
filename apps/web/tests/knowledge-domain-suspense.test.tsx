import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

const loaders = vi.hoisted(() => ({
  search: deferred(),
  graph: Promise.resolve({ KnowledgeGraphPanel: () => <section aria-label="图谱内容">图谱内容</section> }),
  calendar: Promise.resolve({ KnowledgeCalendarPanel: () => <section aria-label="日历内容">日历内容</section> }),
  external: Promise.resolve({ ExternalCalendarPanel: () => <section aria-label="外部日历内容">外部日历内容</section> }),
}));

vi.mock("../src/app/workspace-domain-loader", () => ({
  loadKnowledgeSearchPanel: vi.fn(() => loaders.search.promise),
  loadKnowledgeGraphPanel: vi.fn(() => loaders.graph),
  loadKnowledgeCalendarPanel: vi.fn(() => loaders.calendar),
  loadExternalCalendarPanel: vi.fn(() => loaders.external),
}));

import { KnowledgeDomain } from "../src/app/domains/KnowledgeDomain";

describe("KnowledgeDomain suspense boundaries", () => {
  it("renders ready knowledge panels while search is still loading", async () => {
    const client = {
      listCalendarConnections: vi.fn(),
      startCalendarConnection: vi.fn(),
      listCalendarEvents: vi.fn(),
      syncCalendarConnection: vi.fn(),
      disconnectCalendarConnection: vi.fn(),
    };
    render(<KnowledgeDomain
      client={client as never}
      workspaceId="ws-1"
      role="owner"
      selectedEntity={{ recoveryContent: null }}
      callbacks={{}}
    />);

    expect(await screen.findByRole("region", { name: "图谱内容" })).toBeVisible();
    expect(screen.getByRole("region", { name: "日历内容" })).toBeVisible();
    expect(screen.getByRole("region", { name: "外部日历内容" })).toBeVisible();
    expect(screen.getByRole("status", { name: "正在加载知识搜索" })).toBeVisible();
  });
});
