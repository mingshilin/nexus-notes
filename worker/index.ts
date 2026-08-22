import { buildClearSessionCookie, buildClearWorkspaceCookie, requireAuth } from "./auth";
import { corsHeaders, HttpError, jsonError, jsonSuccess, securityHeaders } from "./http";
import {
  handleForgotPassword,
  handleLogin,
  handleRegister,
  handleResetPassword,
  handleResendVerificationCode,
  handleVerifyEmailCode,
  handleVerifyEmail,
} from "./routes/auth";
import { handleExportAll, handleExportNote } from "./routes/export";
import {
  handleCreateFolder,
  handleDeleteFolder,
  handleListFolders,
  handleUpdateFolder,
} from "./routes/folders";
import {
  handleArchiveNote,
  handleCreateNote,
  handleCreatePublicNoteShare,
  handleDeleteNote,
  handleEmptyTrash,
  handleGetNoteById,
  handleGetPublicNoteShareSummary,
  handleGetPublicSharedNote,
  handleGraph,
  handleInboxNotes,
  handleListNotes,
  handleListBacklinks,
  handleListLinks,
  handleListTrash,
  handleListNoteVersions,
  handleOpenNote,
  handleOpenOrCreateWikiLink,
  handlePermanentDeleteNote,
  handleRebuildLinks,
  handleRevokePublicNoteShare,
  handleRestoreNote,
  handleRestoreNoteVersion,
  handleTodayDailyNote,
  handleUnarchiveNote,
  handleUpdateNote,
  handleUpdateNoteTags,
} from "./routes/notes";
import {
  handleDeleteNoteAttachment,
  handleGetAttachmentFile,
  handleListNoteAttachments,
  handleUploadNoteAttachment,
} from "./routes/attachments";
import { handleCreateTag, handleListTags } from "./routes/tags";
import { revokeSessionByTokenHash } from "./db/queries";
import { handleGetProfile, handleUpdateProfile } from "./routes/profile";
import {
  handleCompleteReminder,
  handleCreateReminder,
  handleDeleteReminder,
  handleListReminders,
  handleSendDueReminderEmails,
  handleUpdateReminder,
} from "./routes/reminders";
import {
  handleAcceptWorkspaceInvite,
  handleCreateWorkspace,
  handleInviteWorkspaceMember,
  handleListWorkspaceMembers,
  handleListWorkspaces,
  handlePreviewWorkspaceInvite,
  handleSwitchWorkspace,
} from "./routes/workspaces";
import {
  handleBatchDatabaseNotes,
  handleCreateComment,
  handleCreateDatabase,
  handleCreateDatabaseNote,
  handleCreateDatabaseProperty,
  handleCreateDatabaseTemplate,
  handleCreateDatabaseView,
  handleDeleteDatabase,
  handleDeleteDatabaseProperty,
  handleDeleteDatabaseTemplate,
  handleDeleteDatabaseView,
  handleDeleteSavedSearch,
  handleExportDatabaseCsv,
  handleGetDatabaseById,
  handleGetFieldPermissions,
  handleImportDatabaseCsv,
  handleKnowledgeDiagnostics,
  handleListDatabaseActivity,
  handleListDatabaseAudit,
  handleListComments,
  handleListDatabaseDuplicates,
  handleListDatabaseNotes,
  handleListDatabasePermissions,
  handleListDatabaseProperties,
  handleListDatabaseTemplates,
  handleListDatabases,
  handleListDatabaseViews,
  handleListSavedSearches,
  handleCreateSavedSearch,
  handleUpdateDatabase,
  handleUpdateDatabaseMembership,
  handleUpdateDatabaseNoteValues,
  handleUpdateDatabaseProperty,
  handleUpdateDatabasePermissions,
  handleUpdateDatabaseTemplate,
  handleUpdateDatabaseView,
  handleUpdateFieldPermissions,
} from "./routes/databases";
import {
  handleCalendarFeed,
  handleClipperCapture,
  handleImportMarkdown,
  handleListAttachmentCenter,
  handleListImportJobs,
  handleListNotifications,
  handleListOfflineDrafts,
  handleMarkAllNotificationsRead,
  handleMarkNotificationRead,
  handleRunAttachmentOcr,
  handleSaveOfflineDraft,
  handleSyncOfflineDraft,
} from "./routes/knowledge";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AVATARS_BUCKET?: R2Bucket;
  APP_NAME: string;
  APP_BASE_URL?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  TURNSTILE_SECRET_KEY?: string;
}

interface ResponseWithCookies {
  response: Response;
  cookies?: string[];
}

function assertWorkspaceWritePermission(role: "owner" | "editor" | "viewer") {
  if (role === "viewer") {
    throw new HttpError(403, "FORBIDDEN", "workspace is read-only for current user");
  }
}

function assertWorkspaceOwner(role: "owner" | "editor" | "viewer") {
  if (role !== "owner") {
    throw new HttpError(403, "FORBIDDEN", "owner permission required");
  }
}

function withCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries({ ...securityHeaders(), ...corsHeaders() })) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withSecurityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(securityHeaders())) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withCookies(response: Response, cookies: string[]) {
  if (cookies.length === 0) return response;
  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function optionsResponse() {
  return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders() } });
}

async function handleAuth(request: Request, env: Env): Promise<ResponseWithCookies> {
  const { pathname } = new URL(request.url);

  if (pathname === "/api/auth/register" && request.method === "POST") {
    const result = await handleRegister(env.DB, request, env);
    const cookies: string[] = [];
    if ("setCookie" in result) cookies.push(result.setCookie as string);
    return { response: result.response, cookies };
  }

  if (pathname === "/api/auth/login" && request.method === "POST") {
    const result = await handleLogin(env.DB, request, env);
    return { response: result.response, cookies: [result.setCookie] };
  }

  if (pathname === "/api/auth/verify-email" && request.method === "POST") {
    return { response: await handleVerifyEmail(env.DB, request) };
  }

  if (pathname === "/api/auth/verify-email-code" && request.method === "POST") {
    const result = await handleVerifyEmailCode(env.DB, request);
    return { response: result.response, cookies: [result.setCookie] };
  }

  if (pathname === "/api/auth/resend-verification-code" && request.method === "POST") {
    return { response: await handleResendVerificationCode(env.DB, request, env) };
  }

  if (pathname === "/api/auth/forgot-password" && request.method === "POST") {
    return { response: await handleForgotPassword(env.DB, request, env) };
  }

  if (pathname === "/api/auth/reset-password" && request.method === "POST") {
    return { response: await handleResetPassword(env.DB, request, env) };
  }

  if (pathname === "/api/auth/me" && request.method === "GET") {
    const auth = await requireAuth(env.DB, request);
    return {
      response: jsonSuccess({
        id: auth.user.id,
        email: auth.user.email,
        display_name: auth.user.display_name,
        bio: auth.user.bio,
        avatar_url: auth.user.avatar_url,
        email_verified_at: auth.user.email_verified_at,
        created_at: auth.user.created_at,
        current_workspace: {
          id: auth.workspace.id,
          name: auth.workspace.name,
          owner_user_id: auth.workspace.owner_user_id,
          role: auth.workspaceRole,
        },
      }),
    };
  }

  if (pathname === "/api/auth/logout" && request.method === "POST") {
    const auth = await requireAuth(env.DB, request);
    const secureCookie = new URL(request.url).protocol === "https:";
    await revokeSessionByTokenHash(env.DB, auth.sessionTokenHash);
    return {
      response: jsonSuccess({ ok: true }),
      cookies: [buildClearSessionCookie(secureCookie), buildClearWorkspaceCookie(secureCookie)],
    };
  }

  throw new HttpError(404, "NOT_FOUND", "auth route not found");
}

async function handleAuthedApi(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(env.DB, request);
  const { pathname } = new URL(request.url);

  if (pathname === "/api/profile" && request.method === "GET") {
    return handleGetProfile(env.DB, auth.user.id);
  }
  if (pathname === "/api/profile" && request.method === "PUT") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleUpdateProfile(env.DB, auth.user.id, request);
  }
  if (pathname === "/api/profile/avatar" && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    const formData = await request.formData();
    const file = formData.get("file") as
      | {
          arrayBuffer: () => Promise<ArrayBuffer>;
          type?: string;
          name?: string;
        }
      | null;
    if (!file || typeof file.arrayBuffer !== "function") {
      throw new HttpError(400, "VALIDATION_ERROR", "file is required");
    }
    const mimeType = file.type || "application/octet-stream";
    if (!mimeType.startsWith("image/")) throw new HttpError(400, "VALIDATION_ERROR", "avatar must be an image");
    const fileName = file.name ?? "avatar.bin";
    const arrayBuffer = await file.arrayBuffer();
    if (!env.AVATARS_BUCKET) {
      throw new HttpError(503, "R2_DISABLED", "R2 bucket is not configured");
    }
    const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : "bin";
    const key = `avatars/${auth.user.id}/${crypto.randomUUID()}.${ext || "bin"}`;
    await env.AVATARS_BUCKET.put(key, arrayBuffer, {
      httpMetadata: { contentType: mimeType },
    });
    const avatarUrl = `/api/profile/avatar/${key.replace(/^avatars\//, "")}`;
    return handleUpdateProfile(
      env.DB,
      auth.user.id,
      new Request("http://internal/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ avatar_url: avatarUrl }),
      }),
    );
  }
  const avatarPath = pathname.match(/^\/api\/profile\/avatar\/(.+)$/);
  if (avatarPath && request.method === "GET") {
    if (!env.AVATARS_BUCKET) throw new HttpError(404, "NOT_FOUND", "avatar not found");
    const key = `avatars/${avatarPath[1]}`;
    const object = await env.AVATARS_BUCKET.get(key);
    if (!object) throw new HttpError(404, "NOT_FOUND", "avatar not found");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    return new Response(object.body, { headers });
  }

  if (pathname === "/api/reminders" && request.method === "GET") {
    return handleListReminders(env.DB, auth.user.id, auth.workspace.id, request);
  }
  if (pathname === "/api/reminders" && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleCreateReminder(env.DB, auth.user.id, auth.workspace.id, request);
  }
  const reminderPath = pathname.match(/^\/api\/reminders\/([^/]+)$/);
  if (reminderPath) {
    assertWorkspaceWritePermission(auth.workspaceRole);
    if (request.method === "PUT") return handleUpdateReminder(env.DB, auth.user.id, auth.workspace.id, reminderPath[1], request);
    if (request.method === "DELETE") return handleDeleteReminder(env.DB, auth.user.id, auth.workspace.id, reminderPath[1]);
  }
  const reminderCompletePath = pathname.match(/^\/api\/reminders\/([^/]+)\/complete$/);
  if (reminderCompletePath && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleCompleteReminder(env.DB, auth.user.id, auth.workspace.id, reminderCompletePath[1]);
  }

  if (pathname === "/api/notes" && request.method === "GET") {
    return handleListNotes(env.DB, auth.user.id, auth.workspace.id, request, { workspaceRole: auth.workspaceRole });
  }
  if (pathname === "/api/inbox" && request.method === "GET") {
    return handleInboxNotes(env.DB, auth.user.id, auth.workspace.id, request);
  }
  if (pathname === "/api/daily/today" && (request.method === "GET" || request.method === "POST")) {
    if (request.method === "POST") assertWorkspaceWritePermission(auth.workspaceRole);
    return handleTodayDailyNote(env.DB, auth.user.id, auth.workspace.id);
  }
  if (pathname === "/api/graph" && request.method === "GET") {
    return handleGraph(env.DB, auth.user.id, auth.workspace.id);
  }
  if (pathname === "/api/notes/trash" && request.method === "GET") {
    return handleListTrash(env.DB, auth.user.id, auth.workspace.id, request);
  }
  if (pathname === "/api/notes" && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleCreateNote(env.DB, auth.user.id, auth.workspace.id, request);
  }
  if (pathname === "/api/notes/wiki-link" && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    const body = (await request.json().catch(() => ({}))) as { title?: string };
    return handleOpenOrCreateWikiLink(env.DB, auth.user.id, auth.workspace.id, body.title ?? "");
  }
  if (pathname === "/api/tags" && request.method === "GET") {
    return handleListTags(env.DB, auth.user.id, auth.workspace.id);
  }
  if (pathname === "/api/tags" && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleCreateTag(env.DB, auth.user.id, auth.workspace.id, request);
  }
  if (pathname === "/api/folders" && request.method === "GET") {
    return handleListFolders(env.DB, auth.user.id, auth.workspace.id);
  }
  if (pathname === "/api/folders" && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleCreateFolder(env.DB, auth.user.id, auth.workspace.id, request);
  }
  const folderPath = pathname.match(/^\/api\/folders\/([^/]+)$/);
  if (folderPath) {
    assertWorkspaceWritePermission(auth.workspaceRole);
    if (request.method === "PUT") {
      return handleUpdateFolder(env.DB, auth.user.id, auth.workspace.id, folderPath[1], request);
    }
    if (request.method === "DELETE") {
      return handleDeleteFolder(env.DB, auth.user.id, auth.workspace.id, folderPath[1]);
    }
  }
  if (pathname === "/api/notes/trash/empty" && request.method === "DELETE") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleEmptyTrash(env.DB, auth.user.id, auth.workspace.id);
  }
  if (pathname === "/api/notes/recent" && request.method === "GET") {
    const url = new URL(request.url);
    url.searchParams.set("recent", "true");
    url.searchParams.set("pageSize", url.searchParams.get("pageSize") ?? "20");
    return handleListNotes(env.DB, auth.user.id, auth.workspace.id, new Request(url.toString(), request), { workspaceRole: auth.workspaceRole });
  }
  const exportAllPath = pathname.match(/^\/api\/export\/all\.(json|zip|csv|pdf|docx|html|txt)$/);
  if (exportAllPath && request.method === "GET") {
    return handleExportAll(env.DB, auth.user.id, auth.workspace.id, exportAllPath[1]);
  }

  if (pathname === "/api/workspaces" && request.method === "GET") {
    return handleListWorkspaces(env.DB, auth.user.id);
  }

  if (pathname === "/api/workspaces" && request.method === "POST") {
    return handleCreateWorkspace(env.DB, auth.user.id, request);
  }

  if (pathname === "/api/databases" && request.method === "GET") {
    return handleListDatabases(env.DB, auth.user.id, auth.workspace.id, { userId: auth.user.id, workspaceRole: auth.workspaceRole });
  }

  if (pathname === "/api/databases" && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleCreateDatabase(env.DB, auth.user.id, auth.workspace.id, request);
  }

  if (pathname === "/api/activity" && request.method === "GET") {
    return handleListDatabaseActivity(env.DB, auth.workspace.id);
  }

  if (pathname === "/api/audit" && request.method === "GET") {
    return handleListDatabaseAudit(env.DB, auth.workspace.id);
  }

  if (pathname === "/api/notifications" && request.method === "GET") {
    return handleListNotifications(env.DB, auth.workspace.id, auth.user.id);
  }

  if (pathname === "/api/notifications/read-all" && request.method === "POST") {
    return handleMarkAllNotificationsRead(env.DB, auth.workspace.id, auth.user.id);
  }

  const notificationReadPath = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (notificationReadPath && request.method === "POST") {
    return handleMarkNotificationRead(env.DB, auth.workspace.id, auth.user.id, notificationReadPath[1]);
  }

  if (pathname === "/api/attachments" && request.method === "GET") {
    return handleListAttachmentCenter(env.DB, auth.workspace.id, request);
  }

  const attachmentOcrPath = pathname.match(/^\/api\/attachments\/([^/]+)\/ocr$/);
  if (attachmentOcrPath && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleRunAttachmentOcr(env.DB, auth.workspace.id, attachmentOcrPath[1], request);
  }

  if (pathname === "/api/clipper/capture" && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleClipperCapture(env.DB, auth.user.id, auth.workspace.id, request);
  }

  if (pathname === "/api/import/markdown" && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleImportMarkdown(env.DB, auth.user.id, auth.workspace.id, request);
  }

  if (pathname === "/api/import/jobs" && request.method === "GET") {
    return handleListImportJobs(env.DB, auth.workspace.id);
  }

  if (pathname === "/api/offline/drafts" && request.method === "GET") {
    return handleListOfflineDrafts(env.DB, auth.workspace.id, auth.user.id);
  }

  if (pathname === "/api/offline/drafts" && request.method === "POST") {
    return handleSaveOfflineDraft(env.DB, auth.workspace.id, auth.user.id, request);
  }

  const offlineDraftSyncPath = pathname.match(/^\/api\/offline\/drafts\/([^/]+)\/sync$/);
  if (offlineDraftSyncPath && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleSyncOfflineDraft(env.DB, auth.workspace.id, auth.user.id, offlineDraftSyncPath[1]);
  }

  if (pathname === "/api/calendar/feed" && request.method === "GET") {
    return handleCalendarFeed(env.DB, auth.user.id, auth.workspace.id);
  }

  if (pathname === "/api/comments" && request.method === "GET") {
    return handleListComments(env.DB, auth.workspace.id, request, { userId: auth.user.id, workspaceRole: auth.workspaceRole });
  }

  if (pathname === "/api/comments" && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleCreateComment(env.DB, auth.user.id, auth.workspace.id, request);
  }

  if (pathname === "/api/search/saved" && request.method === "GET") {
    return handleListSavedSearches(env.DB, auth.workspace.id);
  }

  if (pathname === "/api/search/saved" && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleCreateSavedSearch(env.DB, auth.user.id, auth.workspace.id, request);
  }

  const savedSearchPath = pathname.match(/^\/api\/search\/saved\/([^/]+)$/);
  if (savedSearchPath && request.method === "DELETE") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleDeleteSavedSearch(env.DB, auth.workspace.id, savedSearchPath[1]);
  }

  if (pathname === "/api/search/diagnostics" && request.method === "GET") {
    return handleKnowledgeDiagnostics(env.DB, auth.workspace.id);
  }

  const databaseViewsPath = pathname.match(/^\/api\/databases\/([^/]+)\/views$/);
  if (databaseViewsPath) {
    const databaseId = databaseViewsPath[1];
    if (request.method === "GET") return handleListDatabaseViews(env.DB, auth.workspace.id, databaseId);
    if (request.method === "POST") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleCreateDatabaseView(env.DB, auth.user.id, auth.workspace.id, databaseId, request);
    }
  }

  const databaseViewPath = pathname.match(/^\/api\/databases\/([^/]+)\/views\/([^/]+)$/);
  if (databaseViewPath) {
    const databaseId = databaseViewPath[1];
    const viewId = databaseViewPath[2];
    if (request.method === "PUT") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleUpdateDatabaseView(env.DB, auth.workspace.id, databaseId, viewId, request, auth.user.id);
    }
    if (request.method === "DELETE") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleDeleteDatabaseView(env.DB, auth.workspace.id, databaseId, viewId, auth.user.id);
    }
  }

  const databasePath = pathname.match(/^\/api\/databases\/([^/]+)$/);
  if (databasePath) {
    const databaseId = databasePath[1];
    if (request.method === "GET") return handleGetDatabaseById(env.DB, auth.workspace.id, databaseId, { userId: auth.user.id, workspaceRole: auth.workspaceRole });
    if (request.method === "PUT") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleUpdateDatabase(env.DB, auth.workspace.id, databaseId, request, auth.user.id);
    }
    if (request.method === "DELETE") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleDeleteDatabase(env.DB, auth.workspace.id, databaseId, auth.user.id);
    }
  }

  const databaseNotesPath = pathname.match(/^\/api\/databases\/([^/]+)\/notes$/);
  if (databaseNotesPath) {
    const databaseId = databaseNotesPath[1];
    if (request.method === "GET") return handleListDatabaseNotes(env.DB, auth.user.id, auth.workspace.id, databaseId, { userId: auth.user.id, workspaceRole: auth.workspaceRole });
    if (request.method === "POST") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleCreateDatabaseNote(env.DB, auth.user.id, auth.workspace.id, databaseId, request);
    }
  }

  const databaseNotesBatchPath = pathname.match(/^\/api\/databases\/([^/]+)\/notes\/batch$/);
  if (databaseNotesBatchPath && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleBatchDatabaseNotes(env.DB, auth.user.id, auth.workspace.id, databaseNotesBatchPath[1], request, { userId: auth.user.id, workspaceRole: auth.workspaceRole });
  }

  const databaseDuplicatesPath = pathname.match(/^\/api\/databases\/([^/]+)\/duplicates$/);
  if (databaseDuplicatesPath && request.method === "GET") {
    return handleListDatabaseDuplicates(env.DB, auth.workspace.id, databaseDuplicatesPath[1]);
  }

  const databaseTemplatesPath = pathname.match(/^\/api\/databases\/([^/]+)\/templates$/);
  if (databaseTemplatesPath) {
    const databaseId = databaseTemplatesPath[1];
    if (request.method === "GET") return handleListDatabaseTemplates(env.DB, auth.workspace.id, databaseId);
    if (request.method === "POST") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleCreateDatabaseTemplate(env.DB, auth.user.id, auth.workspace.id, databaseId, request);
    }
  }

  const databaseTemplatePath = pathname.match(/^\/api\/databases\/([^/]+)\/templates\/([^/]+)$/);
  if (databaseTemplatePath) {
    const databaseId = databaseTemplatePath[1];
    const templateId = databaseTemplatePath[2];
    if (request.method === "PUT") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleUpdateDatabaseTemplate(env.DB, auth.user.id, auth.workspace.id, databaseId, templateId, request);
    }
    if (request.method === "DELETE") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleDeleteDatabaseTemplate(env.DB, auth.user.id, auth.workspace.id, databaseId, templateId);
    }
  }

  const databasePermissionsPath = pathname.match(/^\/api\/databases\/([^/]+)\/permissions$/);
  if (databasePermissionsPath) {
    const databaseId = databasePermissionsPath[1];
    if (request.method === "GET") return handleListDatabasePermissions(env.DB, auth.workspace.id, databaseId);
    if (request.method === "PUT") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleUpdateDatabasePermissions(env.DB, auth.user.id, auth.workspace.id, databaseId, request);
    }
  }

  const databaseExportCsvPath = pathname.match(/^\/api\/databases\/([^/]+)\/export-csv$/);
  if (databaseExportCsvPath && request.method === "GET") {
    return handleExportDatabaseCsv(env.DB, auth.user.id, auth.workspace.id, databaseExportCsvPath[1], { userId: auth.user.id, workspaceRole: auth.workspaceRole });
  }

  const databaseImportCsvPath = pathname.match(/^\/api\/databases\/([^/]+)\/import-csv$/);
  if (databaseImportCsvPath && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleImportDatabaseCsv(env.DB, auth.user.id, auth.workspace.id, databaseImportCsvPath[1], request, { userId: auth.user.id, workspaceRole: auth.workspaceRole });
  }

  const databasePropertiesPath = pathname.match(/^\/api\/databases\/([^/]+)\/properties$/);
  if (databasePropertiesPath) {
    const databaseId = databasePropertiesPath[1];
    if (request.method === "GET") return handleListDatabaseProperties(env.DB, auth.workspace.id, databaseId, { userId: auth.user.id, workspaceRole: auth.workspaceRole });
    if (request.method === "POST") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleCreateDatabaseProperty(env.DB, auth.workspace.id, databaseId, request, auth.user.id);
    }
  }

  const databaseFieldPermissionsPath = pathname.match(/^\/api\/databases\/([^/]+)\/properties\/([^/]+)\/permissions$/);
  if (databaseFieldPermissionsPath) {
    const databaseId = databaseFieldPermissionsPath[1];
    const propertyId = databaseFieldPermissionsPath[2];
    if (request.method === "GET") return handleGetFieldPermissions(env.DB, auth.workspace.id, databaseId, propertyId);
    if (request.method === "PUT") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleUpdateFieldPermissions(env.DB, auth.user.id, auth.workspace.id, databaseId, propertyId, request);
    }
  }

  const databasePropertyPath = pathname.match(/^\/api\/databases\/([^/]+)\/properties\/([^/]+)$/);
  if (databasePropertyPath) {
    const databaseId = databasePropertyPath[1];
    const propertyId = databasePropertyPath[2];
    if (request.method === "PUT") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleUpdateDatabaseProperty(env.DB, auth.workspace.id, databaseId, propertyId, request, auth.user.id);
    }
    if (request.method === "DELETE") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleDeleteDatabaseProperty(env.DB, auth.workspace.id, databaseId, propertyId, auth.user.id);
    }
  }

  if (pathname === "/api/workspaces/current" && request.method === "GET") {
    return jsonSuccess({
      ...auth.workspace,
      role: auth.workspaceRole,
    });
  }

  const workspaceSwitchPath = pathname.match(/^\/api\/workspaces\/([^/]+)\/switch$/);
  if (workspaceSwitchPath && request.method === "POST") {
    const secureCookie = new URL(request.url).protocol === "https:";
    const result = await handleSwitchWorkspace(env.DB, auth.user.id, workspaceSwitchPath[1], secureCookie);
    return withCookies(result.response, [result.setCookie]);
  }

  const workspaceMembersPath = pathname.match(/^\/api\/workspaces\/([^/]+)\/members$/);
  if (workspaceMembersPath && request.method === "GET") {
    const workspaceId = workspaceMembersPath[1];
    if (workspaceId !== auth.workspace.id) throw new HttpError(403, "FORBIDDEN", "workspace mismatch");
    return handleListWorkspaceMembers(env.DB, workspaceId);
  }

  const workspaceInvitePath = pathname.match(/^\/api\/workspaces\/([^/]+)\/invites$/);
  if (workspaceInvitePath && request.method === "POST") {
    const workspaceId = workspaceInvitePath[1];
    if (workspaceId !== auth.workspace.id) throw new HttpError(403, "FORBIDDEN", "workspace mismatch");
    assertWorkspaceOwner(auth.workspaceRole);
    return handleInviteWorkspaceMember(env.DB, auth.user.id, workspaceId, request, env);
  }

  if (pathname === "/api/workspaces/invites/accept" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    const secureCookie = new URL(request.url).protocol === "https:";
    const result = await handleAcceptWorkspaceInvite(env.DB, auth.user.id, auth.user.email, body.token ?? "", secureCookie);
    return withCookies(result.response, [result.setCookie]);
  }

  const exportNotePath = pathname.match(/^\/api\/export\/note\/([^/]+)\.(md|txt|html|csv|pdf|docx)$/);
  if (exportNotePath && request.method === "GET") {
    return handleExportNote(env.DB, auth.user.id, auth.workspace.id, exportNotePath[1], exportNotePath[2]);
  }

  const notePath = pathname.match(/^\/api\/notes\/([^/]+)$/);
  if (notePath) {
    const noteId = notePath[1];
    if (request.method === "GET") return handleGetNoteById(env.DB, auth.user.id, auth.workspace.id, noteId);
    if (request.method === "PUT") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleUpdateNote(env.DB, auth.user.id, auth.workspace.id, noteId, request);
    }
    if (request.method === "DELETE") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleDeleteNote(env.DB, auth.user.id, auth.workspace.id, noteId);
    }
  }

  const notePublicSharePath = pathname.match(/^\/api\/notes\/([^/]+)\/public-share$/);
  if (notePublicSharePath && request.method === "GET") {
    return handleGetPublicNoteShareSummary(env.DB, auth.user.id, auth.workspace.id, notePublicSharePath[1]);
  }
  if (notePublicSharePath && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleCreatePublicNoteShare(env.DB, auth.user.id, auth.workspace.id, notePublicSharePath[1], request, env.APP_BASE_URL);
  }

  const notePublicShareRevokePath = pathname.match(/^\/api\/notes\/([^/]+)\/public-share\/revoke$/);
  if (notePublicShareRevokePath && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleRevokePublicNoteShare(env.DB, auth.user.id, auth.workspace.id, notePublicShareRevokePath[1]);
  }

  const noteTagsPath = pathname.match(/^\/api\/notes\/([^/]+)\/tags$/);
  if (noteTagsPath && request.method === "PUT") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleUpdateNoteTags(env.DB, auth.user.id, auth.workspace.id, noteTagsPath[1], request);
  }

  const noteDatabaseValuesPath = pathname.match(/^\/api\/notes\/([^/]+)\/database-values$/);
  if (noteDatabaseValuesPath && request.method === "PUT") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleUpdateDatabaseNoteValues(env.DB, auth.user.id, auth.workspace.id, noteDatabaseValuesPath[1], request, { userId: auth.user.id, workspaceRole: auth.workspaceRole });
  }

  const noteDatabaseMembershipPath = pathname.match(/^\/api\/notes\/([^/]+)\/database-membership$/);
  if (noteDatabaseMembershipPath && request.method === "PUT") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleUpdateDatabaseMembership(env.DB, auth.workspace.id, noteDatabaseMembershipPath[1], request);
  }

  const noteAttachmentsPath = pathname.match(/^\/api\/notes\/([^/]+)\/attachments$/);
  if (noteAttachmentsPath) {
    const noteId = noteAttachmentsPath[1];
    if (request.method === "GET") {
      return handleListNoteAttachments(env.DB, {
        userId: auth.user.id,
        workspaceId: auth.workspace.id,
        noteId,
      });
    }
    if (request.method === "POST") {
      assertWorkspaceWritePermission(auth.workspaceRole);
      return handleUploadNoteAttachment(env.DB, request, {
        userId: auth.user.id,
        workspaceId: auth.workspace.id,
        noteId,
        bucket: env.AVATARS_BUCKET,
      });
    }
  }

  const noteRestorePath = pathname.match(/^\/api\/notes\/([^/]+)\/restore$/);
  if (noteRestorePath && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleRestoreNote(env.DB, auth.user.id, auth.workspace.id, noteRestorePath[1]);
  }

  const noteArchivePath = pathname.match(/^\/api\/notes\/([^/]+)\/archive$/);
  if (noteArchivePath && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleArchiveNote(env.DB, auth.user.id, auth.workspace.id, noteArchivePath[1]);
  }

  const noteUnarchivePath = pathname.match(/^\/api\/notes\/([^/]+)\/unarchive$/);
  if (noteUnarchivePath && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleUnarchiveNote(env.DB, auth.user.id, auth.workspace.id, noteUnarchivePath[1]);
  }

  const noteOpenPath = pathname.match(/^\/api\/notes\/([^/]+)\/open$/);
  if (noteOpenPath && request.method === "POST") {
    return handleOpenNote(env.DB, auth.user.id, auth.workspace.id, noteOpenPath[1]);
  }

  const noteLinksPath = pathname.match(/^\/api\/links\/([^/]+)$/);
  if (noteLinksPath && request.method === "GET") {
    return handleListLinks(env.DB, auth.user.id, auth.workspace.id, noteLinksPath[1]);
  }

  const noteBacklinksPath = pathname.match(/^\/api\/backlinks\/([^/]+)$/);
  if (noteBacklinksPath && request.method === "GET") {
    return handleListBacklinks(env.DB, auth.user.id, auth.workspace.id, noteBacklinksPath[1]);
  }

  const localGraphPath = pathname.match(/^\/api\/graph\/local\/([^/]+)$/);
  if (localGraphPath && request.method === "GET") {
    return handleGraph(env.DB, auth.user.id, auth.workspace.id, localGraphPath[1]);
  }

  const noteLinksRebuildPath = pathname.match(/^\/api\/notes\/([^/]+)\/links\/rebuild$/);
  if (noteLinksRebuildPath && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleRebuildLinks(env.DB, auth.user.id, auth.workspace.id, noteLinksRebuildPath[1]);
  }

  const notePermanentPath = pathname.match(/^\/api\/notes\/([^/]+)\/permanent$/);
  if (notePermanentPath && request.method === "DELETE") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handlePermanentDeleteNote(env.DB, auth.user.id, auth.workspace.id, notePermanentPath[1]);
  }

  const noteVersionsPath = pathname.match(/^\/api\/notes\/([^/]+)\/versions$/);
  if (noteVersionsPath && request.method === "GET") {
    return handleListNoteVersions(env.DB, auth.user.id, auth.workspace.id, noteVersionsPath[1]);
  }

  const noteVersionRestorePath = pathname.match(
    /^\/api\/notes\/([^/]+)\/versions\/([^/]+)\/restore$/,
  );
  if (noteVersionRestorePath && request.method === "POST") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleRestoreNoteVersion(
      env.DB,
      auth.user.id,
      auth.workspace.id,
      noteVersionRestorePath[1],
      noteVersionRestorePath[2],
    );
  }

  const attachmentFilePath = pathname.match(/^\/api\/attachments\/([^/]+)\/file$/);
  if (attachmentFilePath && request.method === "GET") {
    return handleGetAttachmentFile(env.DB, {
      workspaceId: auth.workspace.id,
      attachmentId: attachmentFilePath[1],
      bucket: env.AVATARS_BUCKET,
    });
  }

  const attachmentDeletePath = pathname.match(/^\/api\/notes\/([^/]+)\/attachments\/([^/]+)$/);
  if (attachmentDeletePath && request.method === "DELETE") {
    assertWorkspaceWritePermission(auth.workspaceRole);
    return handleDeleteNoteAttachment(env.DB, {
      workspaceId: auth.workspace.id,
      attachmentId: attachmentDeletePath[2],
      bucket: env.AVATARS_BUCKET,
    });
  }

  throw new HttpError(404, "NOT_FOUND", "route not found");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return optionsResponse();
    try {
      const { pathname } = new URL(request.url);
      if (pathname === "/api/health/turnstile" && request.method === "GET") {
        return withCors(
          jsonSuccess({
            configured: Boolean(env.TURNSTILE_SECRET_KEY?.trim()),
            mode: "always",
          }),
        );
      }
      if (pathname.startsWith("/api/auth/")) {
        const authResult = await handleAuth(request, env);
        return withCors(withCookies(authResult.response, authResult.cookies ?? []));
      }
      if (pathname === "/api/workspaces/invites/preview" && request.method === "GET") {
        const token = new URL(request.url).searchParams.get("token") ?? "";
        return withCors(await handlePreviewWorkspaceInvite(env.DB, token));
      }
      const publicSharePath = pathname.match(/^\/api\/public\/notes\/([^/]+)$/);
      if (publicSharePath && request.method === "GET") {
        const publicShareUrl = new URL(request.url);
        return withCors(await handleGetPublicSharedNote(env.DB, decodeURIComponent(publicSharePath[1]), publicShareUrl.searchParams.get("password")));
      }
      if (pathname.startsWith("/api/")) {
        return withCors(await handleAuthedApi(request, env));
      }
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return withSecurityHeaders(assetResponse);
      }

      // SPA fallback: support direct-open links like /reset-password and /verify-email
      const isFileLikePath = pathname.includes(".") || pathname.startsWith("/api/");
      if (!isFileLikePath) {
        const indexUrl = new URL(request.url);
        indexUrl.pathname = "/index.html";
        indexUrl.search = "";
        return withSecurityHeaders(await env.ASSETS.fetch(new Request(indexUrl.toString(), request)));
      }

      return withSecurityHeaders(assetResponse);
    } catch (error) {
      if (error instanceof HttpError) {
        return withCors(
          jsonError(
            { code: error.code, message: error.message, details: error.details },
            error.status,
          ),
        );
      }
      console.error("Unhandled worker error", error);
      return withCors(
        jsonError({ code: "INTERNAL_ERROR", message: "unexpected server error" }, 500),
      );
    }
  },
  async scheduled(_controller, env) {
    await handleSendDueReminderEmails(env.DB, env);
  },
} satisfies ExportedHandler<Env>;
