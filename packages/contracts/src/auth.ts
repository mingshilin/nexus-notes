import { z } from "zod";

export const AuthUserSummarySchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().max(80),
}).strict();

export const WorkspaceMembershipSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  role: z.enum(["owner", "editor", "viewer"]),
  revision: z.number().int().positive(),
}).strict();

export const AuthSessionSchema = z.object({
  user: AuthUserSummarySchema,
  workspaces: z.array(WorkspaceMembershipSummarySchema),
  active_workspace_id: z.string().min(1).nullable(),
}).strict();

export type AuthUserSummary = z.infer<typeof AuthUserSummarySchema>;
export type WorkspaceMembershipSummary = z.infer<typeof WorkspaceMembershipSummarySchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
