import type { CancelJobInput, CreateJobInput, FeedbackInput, Job, OperationsStatus, Usage } from "@nexus/contracts";
import type { ApiClient } from "./api-client";

type OperationsApiClient = Pick<ApiClient, "request"> & Partial<Pick<ApiClient, "download">>;

export class OperationsClient {
  private readonly createId: () => string;

  constructor(
    private readonly client: OperationsApiClient,
    private readonly workspaceId: string,
    options: { createId?: () => string } = {},
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  createJob(input: CreateJobInput) {
    return this.command<{ job: Job }>("/api/v2/operations/jobs", input).then(({ job }) => job);
  }

  getJob(jobId: string, signal?: AbortSignal) {
    return this.query<{ job: Job | null }>(
      `/api/v2/operations/jobs/${encodeURIComponent(jobId)}`,
      `job:${jobId}`,
      signal,
    ).then(({ job }) => job);
  }

  cancelJob(jobId: string, input: CancelJobInput) {
    return this.command<{ job: Job }>(
      `/api/v2/operations/jobs/${encodeURIComponent(jobId)}`,
      input,
      "DELETE",
    ).then(({ job }) => job);
  }

  listJobs(signal?: AbortSignal) {
    return this.query<{ items: Job[] }>("/api/v2/operations/jobs", "jobs", signal).then(({ items }) => items);
  }

  downloadJob(jobId: string, signal?: AbortSignal) {
    if (!this.client.download) return Promise.reject(new Error("BINARY_DOWNLOAD_UNAVAILABLE"));
    return this.client.download({
      path: `/api/v2/operations/jobs/${encodeURIComponent(jobId)}/file`,
      headers: this.headers(),
      requestClass: "query",
      policy: { timeoutMs: 30_000, retry: 2, signal },
    });
  }

  getUsage(signal?: AbortSignal) {
    return this.query<Usage>("/api/v2/operations/usage", "usage", signal);
  }

  submitFeedback(input: FeedbackInput) {
    return this.command<{ feedback: unknown }>("/api/v2/operations/feedback", input).then(({ feedback }) => feedback);
  }

  getStatus(signal?: AbortSignal) {
    return this.client.request<OperationsStatus>({
      path: "/api/v2/operations/status",
      requestClass: "query",
      policy: { timeoutMs: 8_000, retry: 2, dedupeKey: "operations:status", signal },
    });
  }

  private query<T>(path: string, key: string, signal?: AbortSignal) {
    return this.client.request<T>({
      path,
      headers: this.headers(),
      requestClass: "query",
      policy: { timeoutMs: 8_000, retry: 2, dedupeKey: `operations:${this.workspaceId}:${key}`, signal },
    });
  }

  private command<T>(path: string, body: unknown, method: "POST" | "DELETE" = "POST") {
    return this.client.request<T>({
      path,
      method,
      headers: this.headers(),
      body,
      requestClass: "command",
      policy: { timeoutMs: 8_000, retry: 0, idempotencyKey: this.createId() },
    });
  }

  private headers() {
    return { "x-workspace-id": this.workspaceId };
  }
}
