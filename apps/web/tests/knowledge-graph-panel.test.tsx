import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeGraphPanel } from "../src/knowledge/KnowledgeGraphPanel";

function createClient() {
  return {
    getGraph: vi.fn(async () => ({
      nodes: [
        { id: "note-1", title: "Alpha", is_current: true },
        { id: "note-2", title: "Beta", is_current: false },
      ],
      edges: [{ source: "note-1", target: "note-2" }],
    })),
  };
}

describe("KnowledgeGraphPanel", () => {
  it("renders graph nodes and edges, then refreshes the current workspace graph", async () => {
    const client = createClient();
    render(<KnowledgeGraphPanel client={client} />);

    expect(await screen.findByRole("article", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByText("Alpha → Beta")).toBeInTheDocument();
    expect(client.getGraph).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));

    fireEvent.click(screen.getByRole("button", { name: "刷新图谱" }));
    await waitFor(() => expect(client.getGraph).toHaveBeenCalledTimes(2));
  });
});
