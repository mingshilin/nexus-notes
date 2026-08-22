import {
  CreateJobInputSchema,
  FeedbackInputSchema,
  type Feedback,
  type Job,
  type OperationsStatus,
  type Usage,
} from "@nexus/contracts";
import type { RouteDefinition } from "../http/route-registry";

interface OperationsRegistry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

export interface OperationsRouteService {
  createJob(context: { workspaceId: string; userId: string }, input: unknown, now: string): Promise<Job>;
  getJob(workspaceId: string, jobId: string): Promise<Job | null>;
  listJobs(workspaceId: string, limit?: number): Promise<Job[]>;
  createFeedback(context: { workspaceId: string; userId: string }, input: unknown, requestId: string, now: string): Promise<Feedback>;
  listFeedback(workspaceId: string, limit?: number): Promise<Feedback[]>;
  getUsage(workspaceId: string): Promise<Usage>;
  getStatus(): OperationsStatus;
}

function limitFrom(request: Request) {
  const raw = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  return Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 100) : 50;
}

export function registerOperationsRoutes<TEnv>(
  registry: OperationsRegistry<TEnv>,
  createService: (env: TEnv) => OperationsRouteService,
  clock: () => string = () => new Date().toISOString(),
) {
  registry.register({
    method: "POST", path: "/api/v2/operations/jobs", auth: "workspace", minimumRole: "editor",
    body: CreateJobInputSchema,
    handler: async ({ env, workspace, body }) => ({
      status: 202,
      data: { job: await createService(env).createJob(workspace!, body, clock()) },
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/operations/jobs/:jobId", auth: "workspace",
    handler: async ({ env, workspace, params }) => ({
      data: { job: await createService(env).getJob(workspace!.workspaceId, params.jobId!) },
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/operations/jobs", auth: "workspace",
    handler: async ({ request, env, workspace }) => ({
      data: { items: await createService(env).listJobs(workspace!.workspaceId, limitFrom(request)) },
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/operations/feedback", auth: "workspace",
    body: FeedbackInputSchema,
    handler: async ({ env, workspace, body, requestId }) => ({
      status: 201,
      data: { feedback: await createService(env).createFeedback(workspace!, body, requestId, clock()) },
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/operations/usage", auth: "workspace",
    handler: async ({ env, workspace }) => ({ data: await createService(env).getUsage(workspace!.workspaceId) }),
  });
  registry.register({
    method: "GET", path: "/api/v2/operations/status", auth: "public",
    handler: ({ env }) => ({ data: createService(env).getStatus() }),
  });
  registry.register({
    method: "GET", path: "/api/v2/admin/jobs", auth: "workspace", minimumRole: "owner",
    handler: async ({ request, env, workspace }) => ({
      data: { items: await createService(env).listJobs(workspace!.workspaceId, limitFrom(request)) },
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/admin/feedback", auth: "workspace", minimumRole: "owner",
    handler: async ({ request, env, workspace }) => ({
      data: { items: await createService(env).listFeedback(workspace!.workspaceId, limitFrom(request)) },
    }),
  });
}
