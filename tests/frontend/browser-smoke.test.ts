import { afterEach, describe, expect, it, vi } from "vitest";
import { login, register } from "@/api/auth";
import { createDatabase } from "@/api/databases";
import { createNote } from "@/api/notes";
import { createPublicNoteShare } from "@/api/shares";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("browser smoke flows", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the browser API path for register, login, note creation, sharing, and database creation", async () => {
    const calls: Array<{ path: string; method: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
      const requestPath = String(path);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ path: requestPath, method, body });

      if (requestPath === "/api/auth/register") {
        return jsonResponse({
          pending_verification: true,
          email: "owner@example.com",
          email_masked: "o****@example.com",
          verification_expires_at: "2026-05-21T00:00:00.000Z",
        });
      }
      if (requestPath === "/api/auth/login") {
        return jsonResponse({
          id: "u1",
          email: "owner@example.com",
          email_verified_at: "2026-05-21T00:00:00.000Z",
          created_at: "2026-05-21T00:00:00.000Z",
          current_workspace: { id: "ws-1", name: "Workspace", owner_user_id: "u1", role: "owner" },
        });
      }
      if (requestPath === "/api/notes") {
        return jsonResponse({
          id: "note-1",
          folder_id: null,
          database_id: null,
          title: body.title,
          content: body.content,
          is_favorite: false,
          is_pinned: false,
          is_daily: false,
          daily_date: null,
          created_at: "2026-05-21T00:00:00.000Z",
          updated_at: "2026-05-21T00:00:00.000Z",
          deleted_at: null,
          archived_at: null,
          last_opened_at: null,
          tags: [],
          folder: null,
        });
      }
      if (requestPath === "/api/notes/note-1/public-share") {
        return jsonResponse({
          note_id: "note-1",
          access_mode: "read",
          share_url: "?share=token",
          created_at: "2026-05-21T00:00:00.000Z",
          expires_at: null,
        }, 201);
      }
      if (requestPath === "/api/databases") {
        return jsonResponse({
          id: "db-1",
          workspace_id: "ws-1",
          name: body.name,
          description: body.description ?? null,
          icon: body.icon ?? null,
          created_by_user_id: "u1",
          board_property_id: null,
          calendar_property_id: null,
          created_at: "2026-05-21T00:00:00.000Z",
          updated_at: "2026-05-21T00:00:00.000Z",
        }, 201);
      }

      return jsonResponse(null, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    await register({ email: "owner@example.com", password: "password123", turnstile_token: "token" });
    const user = await login({ email: "owner@example.com", password: "password123" });
    const note = await createNote({ title: "Smoke note", content: "Smoke content" });
    const share = await createPublicNoteShare(note.id, null, null);
    const database = await createDatabase({ name: "Smoke database", description: "Smoke run" });

    expect(user.current_workspace.id).toBe("ws-1");
    expect(note.title).toBe("Smoke note");
    expect(share.share_url).toContain("share=");
    expect(database.name).toBe("Smoke database");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/auth/register",
      "POST /api/auth/login",
      "POST /api/notes",
      "POST /api/notes/note-1/public-share",
      "POST /api/databases",
    ]);
  });
});
