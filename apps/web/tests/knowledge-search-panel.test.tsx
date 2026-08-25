import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SavedSearch, SearchHit } from "@nexus/contracts";
import { KnowledgeSearchPanel } from "../src/knowledge/KnowledgeSearchPanel";

const savedSearch: SavedSearch = {
  id: "saved-1",
  workspace_id: "ws-1",
  user_id: "user-1",
  name: "研究资料",
  query: "Alpha",
  filters: {
    tag_ids: ["tag-1"],
    folder_ids: ["folder-1"],
    database_ids: ["db-1"],
    member_ids: ["user-1"],
    attachment_types: ["application/pdf"],
    ocr_statuses: ["complete"],
    source_types: ["note"],
    favorite: true,
    pinned: false,
    date_from: "2026-08-01",
    date_to: "2026-08-31",
  },
  revision: 1,
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:00:00.000Z",
};

const searchHit: SearchHit = {
  entity_type: "note",
  entity_id: "note-1",
  title: "Alpha project",
  excerpt: "Alpha project notes",
  hit_sources: ["title", "content", "ocr"],
  revision: 2,
  updated_at: "2026-08-23T00:00:00.000Z",
};

function createClient() {
  return {
    search: vi.fn(async () => ({ items: [searchHit], next_cursor: null })),
    listSavedSearches: vi.fn(async () => [savedSearch]),
    listFolders: vi.fn(async () => [{ id: "folder-1", workspace_id: "ws-1", name: "项目", parent_id: null, position: 0, revision: 1, created_at: "2026-08-23T00:00:00.000Z", updated_at: "2026-08-23T00:00:00.000Z" }]),
    listTags: vi.fn(async () => [{ id: "tag-1", workspace_id: "ws-1", name: "研究", color: "", revision: 1, created_at: "2026-08-23T00:00:00.000Z", updated_at: "2026-08-23T00:00:00.000Z" }]),
    createSavedSearch: vi.fn(async (input: unknown) => ({ ...savedSearch, ...(input as object), id: "saved-2" })),
    deleteSavedSearch: vi.fn(async () => ({ deleted: true as const })),
  };
}

describe("KnowledgeSearchPanel", () => {
  it("loads saved searches, submits complete filters, and shows hit sources", async () => {
    const client = createClient();
    render(<KnowledgeSearchPanel client={client} />);

    expect(await screen.findByRole("button", { name: "应用研究资料" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "知识搜索" }), { target: { value: "Alpha" } });
    fireEvent.change(screen.getByRole("textbox", { name: "标签过滤" }), { target: { value: "tag-1, tag-2" } });
    fireEvent.change(screen.getByRole("textbox", { name: "文件夹过滤" }), { target: { value: "folder-1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "数据库过滤" }), { target: { value: "db-1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "搜索笔记" }));
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => expect(client.search).toHaveBeenCalledWith(expect.objectContaining({
      query: "Alpha",
      filters: expect.objectContaining({
        tag_ids: ["tag-1", "tag-2"],
        folder_ids: ["folder-1"],
        database_ids: ["db-1"],
        source_types: ["note"],
      }),
      limit: 50,
    })));
    expect(await screen.findByRole("article", { name: "Alpha project" })).toHaveTextContent("标题、正文、OCR");
  });

  it("saves the current query and all filters, then supports delete", async () => {
    const client = createClient();
    render(<KnowledgeSearchPanel client={client} />);

    fireEvent.change(screen.getByRole("textbox", { name: "知识搜索" }), { target: { value: "Beta" } });
    fireEvent.change(screen.getByRole("textbox", { name: "保存搜索名称" }), { target: { value: "Beta 资料" } });
    fireEvent.change(screen.getByRole("textbox", { name: "附件类型过滤" }), { target: { value: "image/png" } });
    fireEvent.click(screen.getByRole("button", { name: "保存搜索" }));

    await waitFor(() => expect(client.createSavedSearch).toHaveBeenCalledWith(expect.objectContaining({
      name: "Beta 资料",
      query: "Beta",
      filters: expect.objectContaining({ attachment_types: ["image/png"] }),
    })));
    expect(await screen.findByRole("button", { name: "应用Beta 资料" })).toBeInTheDocument();

    const savedRow = screen.getByRole("listitem", { name: "Beta 资料" });
    fireEvent.click(within(savedRow).getByRole("button", { name: "删除Beta 资料" }));
    await waitFor(() => expect(client.deleteSavedSearch).toHaveBeenCalledWith("saved-2"));
  });

  it("offers readable folder and tag filters while preserving their IDs", async () => {
    const client = createClient();
    render(<KnowledgeSearchPanel client={client} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "标签：研究" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "文件夹：项目" }));
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => expect(client.search).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.objectContaining({ tag_ids: ["tag-1"], folder_ids: ["folder-1"] }),
    })));
  });
});
