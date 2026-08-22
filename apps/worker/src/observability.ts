export type HttpOutcome = "success" | "failure";
export type HttpErrorClass =
  | "auth"
  | "permission"
  | "not_found"
  | "conflict"
  | "rate_limit"
  | "timeout"
  | "dependency"
  | "client"
  | "internal";

export interface AnalyticsDataPoint {
  blobs?: string[];
  doubles?: number[];
  indexes?: string[];
}

export interface ObservabilityLogger {
  log(message: string): void;
}

export interface ObservabilityAnalytics {
  writeDataPoint(point: AnalyticsDataPoint): void;
}

export interface ObservabilityOptions {
  logger?: ObservabilityLogger;
  analytics?: ObservabilityAnalytics;
  deploymentVersion?: string;
  workspaceHashSecret?: string;
}

interface HttpObservation {
  requestId: string;
  method: string;
  pathname: string;
  status: number;
  latencyMs: number;
  workspaceId?: string;
}

interface QueueObservation {
  queue: string;
  kind: string;
  outcome: "success" | "retry" | "dead_letter" | "stale" | "duplicate" | "failure";
  attempt?: number;
  ageMs?: number;
  requestId?: string;
  workspaceId?: string;
  payload?: unknown;
}

const knownQueueNames = new Set(["ocr", "operations", "scheduler"]);
const knownJobKinds = new Set(["ocr", "index", "import", "export", "email", "notification", "cleanup"]);

export function normalizeRoute(pathname: string) {
  let path = pathname;
  try {
    path = new URL(pathname, "https://observability.invalid").pathname;
  } catch {
    path = pathname.split("?", 1)[0] ?? pathname;
  }
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 3) return `/${segments.join("/")}`;
  return `/${segments.slice(0, 3).join("/")}/:id`;
}

export function classifyHttpStatus(status: number): "success" | HttpErrorClass {
  if (status < 400) return "success";
  if (status === 401) return "auth";
  if (status === 403) return "permission";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limit";
  if (status === 408 || status === 504) return "timeout";
  if (status === 502 || status === 503) return "dependency";
  if (status >= 500) return "internal";
  return "client";
}

function boundedText(value: string | undefined, fallback: string, maxLength = 128) {
  const text = value?.trim();
  if (!text) return fallback;
  return text.slice(0, maxLength);
}

async function hashWorkspaceId(workspaceId: string, secret: string) {
  const input = new TextEncoder().encode(`${secret}:${workspaceId}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export class Observability {
  private readonly logger: ObservabilityLogger;
  private readonly analytics?: ObservabilityAnalytics;
  private readonly deploymentVersion: string;
  private readonly workspaceHashSecret: string;

  constructor(options: ObservabilityOptions = {}) {
    this.logger = options.logger ?? console;
    this.analytics = options.analytics;
    this.deploymentVersion = boundedText(options.deploymentVersion, "development");
    this.workspaceHashSecret = options.workspaceHashSecret ?? "unconfigured";
  }

  async recordHttp(observation: HttpObservation) {
    const classification = classifyHttpStatus(observation.status);
    const event: Record<string, unknown> = {
      type: "http.request",
      request_id: boundedText(observation.requestId, "unknown"),
      route: normalizeRoute(observation.pathname),
      method: boundedText(observation.method, "UNKNOWN", 16),
      status: observation.status,
      outcome: classification === "success" ? "success" : "failure",
      latency_ms: Math.max(0, Math.round(observation.latencyMs)),
      deployment_version: this.deploymentVersion,
    };
    if (classification !== "success") event.error_class = classification;
    if (observation.workspaceId) {
      try {
        event.workspace_hash = await hashWorkspaceId(observation.workspaceId, this.workspaceHashSecret);
      } catch {
        // A missing crypto primitive must not turn a completed request into a failure.
      }
    }
    this.emit(event, {
      blobs: [
        "http.request",
        String(event.route),
        String(event.outcome),
        classification,
        this.deploymentVersion,
      ],
      doubles: [observation.status, Math.max(0, Math.round(observation.latencyMs))],
      indexes: [String(event.request_id)],
    });
  }

  async recordQueue(observation: QueueObservation) {
    const event: Record<string, unknown> = {
      type: "queue.job",
      queue: knownQueueNames.has(observation.queue) ? observation.queue : "unknown",
      job_kind: knownJobKinds.has(observation.kind) ? observation.kind : "unknown",
      outcome: observation.outcome,
      deployment_version: this.deploymentVersion,
    };
    if (observation.attempt !== undefined) event.attempt = Math.max(1, Math.floor(observation.attempt));
    if (observation.ageMs !== undefined) event.queue_age_ms = Math.max(0, Math.round(observation.ageMs));
    if (observation.requestId) event.request_id = boundedText(observation.requestId, "unknown");
    if (observation.workspaceId) {
      try {
        event.workspace_hash = await hashWorkspaceId(observation.workspaceId, this.workspaceHashSecret);
      } catch {
        // A missing crypto primitive must not block queue acknowledgement or retry.
      }
    }
    this.emit(event, {
      blobs: ["queue.job", String(event.queue), String(event.job_kind), observation.outcome, this.deploymentVersion],
      doubles: [
        typeof event.attempt === "number" ? event.attempt : 0,
        typeof event.queue_age_ms === "number" ? event.queue_age_ms : 0,
      ],
      indexes: observation.requestId ? [String(event.request_id)] : undefined,
    });
  }

  private emit(event: Record<string, unknown>, point: AnalyticsDataPoint) {
    try {
      this.logger.log(JSON.stringify(event));
    } catch {
      // Observability must never change the success or failure of the request.
    }
    if (!this.analytics) return;
    try {
      this.analytics.writeDataPoint(point);
    } catch {
      // Analytics Engine can be unavailable during a partial deployment.
    }
  }
}

export function createObservability(options: ObservabilityOptions = {}) {
  return new Observability(options);
}
