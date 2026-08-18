import { buildWorkspaceCookie, randomToken, sha256 } from "../auth";
import { HttpError, jsonSuccess, parseJson } from "../http";
import {
  addWorkspaceMember,
  createWorkspace,
  createWorkspaceInvite,
  getNoteById,
  getUserById,
  getUserByEmail,
  getWorkspaceById,
  getWorkspaceInviteByTokenHash,
  getWorkspaceInvitePreviewByTokenHash,
  getWorkspaceMember,
  listUserWorkspaces,
  listWorkspaceMembers,
  markWorkspaceInviteAccepted,
} from "../db/queries";
import { sendEmailByResend } from "../mail";

function assertWorkspaceName(value: string | undefined) {
  const name = (value ?? "").trim();
  if (!name) throw new HttpError(400, "VALIDATION_ERROR", "workspace name is required");
  if (name.length > 80) throw new HttpError(400, "VALIDATION_ERROR", "workspace name too long");
  return name;
}

function assertRole(value: string | undefined): "editor" | "viewer" {
  if (value === "viewer") return "viewer";
  return "editor";
}

function assertEmail(value: string | undefined) {
  const email = (value ?? "").trim().toLowerCase();
  if (!email) throw new HttpError(400, "VALIDATION_ERROR", "email is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "VALIDATION_ERROR", "email format is invalid");
  }
  return email;
}

export async function handleListWorkspaces(db: D1Database, userId: string) {
  const workspaces = await listUserWorkspaces(db, userId);
  return jsonSuccess(workspaces);
}

export async function handleCreateWorkspace(
  db: D1Database,
  userId: string,
  request: Request,
) {
  const body = await parseJson<{ name?: string }>(request);
  const name = assertWorkspaceName(body.name);
  const created = await createWorkspace(db, {
    id: crypto.randomUUID(),
    name,
    ownerUserId: userId,
  });
  if (!created) throw new HttpError(500, "INTERNAL_ERROR", "failed to create workspace");
  return jsonSuccess({ ...created, role: "owner" as const }, { status: 201 });
}

export async function handleSwitchWorkspace(
  db: D1Database,
  userId: string,
  workspaceId: string,
  secureCookie: boolean,
) {
  const member = await getWorkspaceMember(db, workspaceId, userId);
  if (!member) throw new HttpError(403, "FORBIDDEN", "no access to workspace");
  const workspace = await getWorkspaceById(db, workspaceId);
  if (!workspace) throw new HttpError(404, "NOT_FOUND", "workspace not found");
  return {
    response: jsonSuccess({ ...workspace, role: member.role }),
    setCookie: buildWorkspaceCookie(workspaceId, secureCookie),
  };
}

export async function handleListWorkspaceMembers(
  db: D1Database,
  workspaceId: string,
) {
  const members = await listWorkspaceMembers(db, workspaceId);
  return jsonSuccess(members);
}

export async function handleInviteWorkspaceMember(
  db: D1Database,
  inviterUserId: string,
  workspaceId: string,
  request: Request,
  env: {
    APP_BASE_URL?: string;
    APP_NAME?: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
  },
) {
  const body = await parseJson<{ email?: string; role?: string; note_id?: string | null }>(request);
  const email = assertEmail(body.email);
  const role = assertRole(body.role);
  const noteId = body.note_id?.trim() || null;
  const token = randomToken(24);
  const tokenHash = await sha256(token);

  if (noteId) {
    const note = await getNoteById(db, inviterUserId, workspaceId, noteId, true);
    if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  }
  const workspace = await getWorkspaceById(db, workspaceId);
  if (!workspace) throw new HttpError(404, "NOT_FOUND", "workspace not found");
  const inviter = await getUserById(db, inviterUserId);
  if (!inviter) throw new HttpError(404, "NOT_FOUND", "inviter not found");

  await createWorkspaceInvite(db, {
    id: crypto.randomUUID(),
    workspaceId,
    email,
    role,
    noteId,
    inviteTokenHash: tokenHash,
    invitedByUserId: inviterUserId,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
  });

  const base = (env.APP_BASE_URL ?? "").replace(/\/$/, "");
  const inviteUrl = base
    ? `${base}/?invite=${encodeURIComponent(token)}${noteId ? `&note=${encodeURIComponent(noteId)}` : ""}`
    : token;

  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !base) {
    throw new HttpError(503, "CONFIG_ERROR", "invite email service is not configured");
  }
  const inviterDisplay = inviter.display_name?.trim() || inviter.email;
  const note = noteId ? await getNoteById(db, inviterUserId, workspaceId, noteId, true) : null;
  const expiresAtLabel = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toLocaleString("zh-CN");
  await sendEmailByResend({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: email,
    subject: `${inviterDisplay} 邀请你加入 ${workspace.name}`,
    html: `
      <p>${inviterDisplay} 邀请你加入工作区 <strong>${workspace.name}</strong>。</p>
      <p>角色：<strong>${role === "editor" ? "编辑者" : "只读者"}</strong></p>
      ${note ? `<p>加入后会自动打开笔记：<strong>${note.title || "无标题笔记"}</strong></p>` : ""}
      <p>邀请有效期至：${expiresAtLabel}</p>
      <p><a href="${inviteUrl}">点击加入工作区</a></p>
      <p>如果按钮无法打开，请使用下面的备用链接：</p>
      <p><a href="${inviteUrl}">${inviteUrl}</a></p>
    `,
  });

  return jsonSuccess(
    {
      invite_url: inviteUrl,
      token,
      email,
      role,
      note_id: noteId,
    },
    { status: 201 },
  );
}

export async function handleAcceptWorkspaceInvite(
  db: D1Database,
  userId: string,
  userEmail: string,
  token: string,
  secureCookie: boolean,
) {
  if (!token) throw new HttpError(400, "VALIDATION_ERROR", "token is required");
  const tokenHash = await sha256(token);
  const invite = await getWorkspaceInviteByTokenHash(db, tokenHash);
  if (!invite) throw new HttpError(404, "NOT_FOUND", "invite not found");
  if (invite.accepted_at) {
    const existingMembership = await getWorkspaceMember(db, invite.workspace_id, userId);
    if (existingMembership) {
      const workspace = await getWorkspaceById(db, invite.workspace_id);
      if (!workspace) throw new HttpError(404, "NOT_FOUND", "workspace not found");
      return {
        response: jsonSuccess({ ...workspace, role: existingMembership.role }),
        setCookie: buildWorkspaceCookie(invite.workspace_id, secureCookie),
      };
    }
    throw new HttpError(409, "CONFLICT", "invite already accepted");
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    throw new HttpError(410, "EXPIRED", "invite expired");
  }
  if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new HttpError(403, "FORBIDDEN", "invite email does not match current user");
  }

  await addWorkspaceMember(db, {
    workspaceId: invite.workspace_id,
    userId,
    role: invite.role,
  });
  await markWorkspaceInviteAccepted(db, invite.id);

  const workspace = await getWorkspaceById(db, invite.workspace_id);
  if (!workspace) throw new HttpError(404, "NOT_FOUND", "workspace not found");
  return {
    response: jsonSuccess({ ...workspace, role: invite.role }),
    setCookie: buildWorkspaceCookie(invite.workspace_id, secureCookie),
  };
}

export async function handlePreviewWorkspaceInvite(
  db: D1Database,
  token: string,
) {
  if (!token) throw new HttpError(400, "VALIDATION_ERROR", "token is required");
  const tokenHash = await sha256(token);
  const invite = await getWorkspaceInvitePreviewByTokenHash(db, tokenHash);
  if (!invite) throw new HttpError(404, "NOT_FOUND", "invite not found");
  return jsonSuccess({
    workspace_id: invite.workspace_id,
    workspace_name: invite.workspace_name,
    invited_email_masked: invite.email.replace(/^(.{2}).+(@.+)$/, "$1****$2"),
    role: invite.role,
    expires_at: invite.expires_at,
    inviter_display: invite.inviter_display_name?.trim() || invite.inviter_email,
    note_id: invite.note_id,
    note_title: invite.note_title,
  });
}

export async function handleAddWorkspaceMemberDirect(
  db: D1Database,
  workspaceId: string,
  request: Request,
) {
  const body = await parseJson<{ email?: string; role?: string }>(request);
  const email = assertEmail(body.email);
  const role = assertRole(body.role);
  const user = await getUserByEmail(db, email);
  if (!user) throw new HttpError(404, "NOT_FOUND", "target user not found");
  await addWorkspaceMember(db, { workspaceId, userId: user.id, role });
  return jsonSuccess({ ok: true });
}
