import { describe, expect, it, vi } from "vitest";
import { WorkspaceQueryCache } from "../src/data/workspace-query-cache";

type DataExports = Record<string, any>;

async function loadData() {
  return (await import("../src/data")) as DataExports;
}

const filters = {
  tag_ids: ["tag-1"], folder_ids: [], database_ids: [], member_ids: [],
  attachment_types: [], ocr_statuses: [], source_types: ["note"],
};

describe("KnowledgeClient", () => {
  it("shares reminder pages across client instances and invalidates the domain after mutation", async () => {
    const data = await loadData();
    const api = { request: vi.fn(async ({ method }: { method?: string }) => method
      ? { reminder: { id: "reminder-1" } }
      : { items: [], next_cursor: null }) };
    const queryCache = new WorkspaceQueryCache({ now: () => 1_000 });
    const options = { userId: "user-1", queryCache, createId: () => "operation" };
    const first = new data.KnowledgeClient(api, "ws-1", options);
    const second = new data.KnowledgeClient(api, "ws-1", options);
    const query = { status: "all", query: "review", limit: 25 } as const;

    await first.listReminderPage(query);
    await second.listReminderPage(query);
    expect(api.request).toHaveBeenCalledOnce();

    await first.snoozeReminder("reminder-1", { base_revision: 1, minutes: 10 });
    await second.listReminderPage(query);
    expect(api.request).toHaveBeenCalledTimes(3);
  });

  it("runs cancellable deduplicated workspace searches with complete filters", async () => {
    const data = await loadData();
    expect(data.KnowledgeClient).toBeTypeOf("function");
    const api = { request: vi.fn(async () => ({ items: [], next_cursor: null })) };
    const client = new data.KnowledgeClient(api, "ws-1");
    const controller = new AbortController();

    await client.search({ query: "Alpha", filters, limit: 25, signal: controller.signal });

    expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/search",
      method: "POST",
      headers: { "x-workspace-id": "ws-1" },
      body: { query: "Alpha", filters, limit: 25 },
      requestClass: "query",
      policy: expect.objectContaining({ retry: 2, signal: controller.signal }),
    }));
  });

  it("maps owner-scoped saved-search list, create, and delete", async () => {
    const data = await loadData();
    const api = {
      request: vi.fn(async (options: { path: string; method?: string }) => {
        if (!options.method) return { items: [] };
        if (options.method === "DELETE") return { deleted: true };
        return { saved_search: { id: "saved-1" } };
      }),
    };
    const client = new data.KnowledgeClient(api, "ws-1", { createId: () => "operation-1" });

    await client.listSavedSearches();
    await client.createSavedSearch({ name: "Research", query: "Alpha", filters });
    await client.deleteSavedSearch("saved-1");

    expect(api.request.mock.calls.map(([options]) => [options.path, options.method ?? "GET"])).toEqual([
      ["/api/v2/search/saved", "GET"],
      ["/api/v2/search/saved", "POST"],
      ["/api/v2/search/saved/saved-1", "DELETE"],
    ]);
    expect(api.request.mock.calls.every(([options]) => options.headers["x-workspace-id"] === "ws-1")).toBe(true);
    expect(api.request.mock.calls[1]?.[0].policy).toMatchObject({ retry: 0, idempotencyKey: "operation-1" });
  });

  it("maps taxonomy, graph, and reminder endpoints", async () => {
    const data = await loadData();
    const api = { request: vi.fn(async () => ({ items: [], nodes: [], edges: [], updated: true, reminder: {} })) };
    const client = new data.KnowledgeClient(api, "ws-1", { createId: () => "operation-1" });

    await client.listFolders();
    await client.createFolder({ name: "Projects" });
    await client.listTags();
    await client.createTag({ name: "research", color: "" });
    await client.setNoteTags("note-1", { tag_ids: ["tag-1"] });
    await client.listNoteTags("note-1");
    await client.setNoteLinks("note-1", { target_note_ids: ["note-2"] });
    await client.listNoteLinks("note-1");
    await client.listBacklinks("note-1");
    await client.getGraph();
    await client.getGraph("note-1");
    await client.listReminders(true);
    await client.listReminderDeliveries("reminder-1");
    await client.retryReminderDelivery("reminder-1", "delivery-1");
    await client.createReminder({ note_id: "note-1", remind_at: "2026-08-22T00:00:00.000Z" });
    await client.updateReminder("reminder-1", { base_revision: 1, status: "dismissed" });

    expect(api.request.mock.calls.map(([options]) => [options.path, options.method ?? "GET"])).toEqual([
      ["/api/v2/folders", "GET"], ["/api/v2/folders", "POST"],
      ["/api/v2/tags", "GET"], ["/api/v2/tags", "POST"],
      ["/api/v2/notes/note-1/tags", "PUT"], ["/api/v2/notes/note-1/tags", "GET"],
      ["/api/v2/notes/note-1/links", "PUT"],
      ["/api/v2/notes/note-1/links", "GET"], ["/api/v2/notes/note-1/backlinks", "GET"],
      ["/api/v2/graph", "GET"], ["/api/v2/graph/local/note-1", "GET"],
      ["/api/v2/reminders?include_completed=true", "GET"],
      ["/api/v2/reminders/reminder-1/deliveries", "GET"],
      ["/api/v2/reminders/reminder-1/deliveries/delivery-1/retry", "POST"],
      ["/api/v2/reminders", "POST"],
      ["/api/v2/reminders/reminder-1", "PATCH"],
    ]);
    expect(api.request.mock.calls.every(([options]) => options.headers["x-workspace-id"] === "ws-1")).toBe(true);
  });

  it("caches reminder pages for one minute and invalidates them after snooze or delete", async () => {
    const data = await loadData();
    let now = 1_000;
    const api = { request: vi.fn(async ({ method }: { method?: string }) => method === "DELETE"
      ? { deleted: true }
      : method === "POST" ? { reminder: { id: "reminder-1" } }
        : { items: [], next_cursor: null }) };
    const client = new data.KnowledgeClient(api, "ws-1", { createId: () => "operation-1", now: () => now });

    await client.listReminderPage({ status: "all", query: "review", limit: 25 });
    await client.listReminderPage({ status: "all", query: "review", limit: 25 });
    expect(api.request).toHaveBeenCalledTimes(1);

    now += 60_001;
    await client.listReminderPage({ status: "all", query: "review", limit: 25 });
    await client.snoozeReminder("reminder-1", { base_revision: 1, minutes: 10 });
    await client.listReminderPage({ status: "all", query: "review", limit: 25 });
    await client.deleteReminder("reminder-1", { base_revision: 2 });

    expect(api.request.mock.calls.map(([options]) => [options.path, options.method ?? "GET"])).toEqual([
      ["/api/v2/reminders?status=all&query=review&limit=25", "GET"],
      ["/api/v2/reminders?status=all&query=review&limit=25", "GET"],
      ["/api/v2/reminders/reminder-1/snooze", "POST"],
      ["/api/v2/reminders?status=all&query=review&limit=25", "GET"],
      ["/api/v2/reminders/reminder-1", "DELETE"],
    ]);
  });

  it("loads a bounded workspace calendar feed with a cancellable query", async () => {
    const data = await loadData();
    const api = { request: vi.fn(async () => ({ items: [] })) };
    const client = new data.KnowledgeClient(api, "ws-1");
    const controller = new AbortController();

    await client.getCalendarFeed({ from: "2026-08-01", to: "2026-08-31" }, controller.signal);

    expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/calendar/feed?from=2026-08-01&to=2026-08-31",
      headers: { "x-workspace-id": "ws-1" },
      requestClass: "query",
      policy: expect.objectContaining({ retry: 2, signal: controller.signal }),
    }));
  });

  it("maps external calendar connection and read-only sync endpoints", async () => {
    const data = await loadData();
    const api = { request: vi.fn(async ({ method, path }: { method?: string; path: string }) => {
      if (path.endsWith("/start")) return { provider: "google", status: "unconfigured" };
      if (path.includes("/sync")) return { connection: { id: "connection-1", provider: "google", status: "active", last_synced_at: null, last_error_code: null }, imported_count: 2 };
      if (path.includes("/connections") && method === "DELETE") return { deleted: true };
      if (path.includes("/connections")) return { items: [] };
      return { items: [] };
    }) };
    const client = new data.KnowledgeClient(api, "ws-1");
    await client.listCalendarConnections();
    await client.startCalendarConnection("google");
    await client.listCalendarEvents({ from: "2026-08-01", to: "2026-08-31" });
    await client.syncCalendarConnection("connection-1", { from: "2026-08-01", to: "2026-08-31" });
    await client.disconnectCalendarConnection("connection-1");

    expect(api.request.mock.calls.map(([options]) => [options.path, options.method ?? "GET"])).toEqual([
      ["/api/v2/calendar/connections", "GET"],
      ["/api/v2/calendar/connections/google/start", "POST"],
      ["/api/v2/calendar/events?from=2026-08-01&to=2026-08-31", "GET"],
      ["/api/v2/calendar/connections/connection-1/sync", "POST"],
      ["/api/v2/calendar/connections/connection-1", "DELETE"],
    ]);
  });

  it("maps workspace-scoped attachment filters, retry actions, and diagnostics recovery queries", async () => {
    const data = await loadData();
    const api = { request: vi.fn(async () => ({ items: [], next_cursor: null, queued: [], ineligible: [], duplicate: [], attachment: { id: "attachment-1" }, deleted: true })) };
    const client = new data.KnowledgeClient(api, "ws-1", { createId: () => "operation-1" });

    const controller = new AbortController();
    await client.listAttachments({ mime_type: "application/pdf", ocr_status: "failed", limit: 25 }, controller.signal);
    await client.createAttachmentUpload({ filename: "scan.pdf", mime_type: "application/pdf", size_bytes: 5, note_id: "note-1" });
    await client.uploadAttachmentContent("attachment-1", new Uint8Array([1, 2, 3]).buffer, controller.signal);
    await client.completeAttachmentUpload("attachment-1");
    await client.retryAttachmentOcr("attachment-1");
    await client.retryAttachmentOcrBatch(["attachment-1", "attachment-2"]);
    await client.getKnowledgeDiagnostics({ limit: 25 });
    await client.deleteAttachment("attachment-1");

    expect(api.request.mock.calls.map(([options]) => [options.path, options.method ?? "GET"])).toEqual([
      ["/api/v2/attachments?mime_type=application%2Fpdf&ocr_status=failed&limit=25", "GET"],
      ["/api/v2/attachments/uploads", "POST"],
      ["/api/v2/attachments/attachment-1/content", "PUT"],
      ["/api/v2/attachments/attachment-1/complete", "POST"],
      ["/api/v2/attachments/attachment-1/ocr/retry", "POST"],
      ["/api/v2/attachments/ocr/retry", "POST"],
      ["/api/v2/knowledge/diagnostics?limit=25", "GET"],
      ["/api/v2/attachments/attachment-1", "DELETE"],
    ]);
    expect(api.request.mock.calls.every(([options]) => options.headers["x-workspace-id"] === "ws-1")).toBe(true);
    expect(api.request.mock.calls[0]?.[0].policy.signal).toBe(controller.signal);
    expect(api.request.mock.calls[2]?.[0].bodyMode).toBe("raw");
    expect(api.request.mock.calls[2]?.[0].policy.signal).toBe(controller.signal);
    expect(api.request.mock.calls[4]?.[0].body).toEqual({ attachment_ids: ["attachment-1"] });
    expect(api.request.mock.calls[5]?.[0].body).toEqual({ attachment_ids: ["attachment-1", "attachment-2"] });
  });
});
