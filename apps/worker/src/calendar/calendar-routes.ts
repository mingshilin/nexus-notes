import {
  CalendarEventsQuerySchema,
  CalendarProviderSchema,
} from "@nexus/contracts";

import type { RouteDefinition, SessionPrincipal } from "../http/route-registry";
import { CalendarServiceError, type CalendarService } from "./calendar-service";

interface Registry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

export interface CalendarRouteEnv {
  APP_BASE_URL: string;
}

type Service = Pick<
  CalendarService,
  "listConnections" | "startConnection" | "completeOAuth" | "listEvents" | "syncConnection" | "disconnect"
>;

function provider(value: string) {
  const parsed = CalendarProviderSchema.safeParse(value);
  if (!parsed.success) throw new CalendarServiceError("CALENDAR_PROVIDER_INVALID", "Calendar provider is invalid", 400);
  return parsed.data;
}

function queryFromRequest(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = CalendarEventsQuerySchema.safeParse({
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    connection_id: params.get("connection_id") ?? undefined,
  });
  if (!parsed.success) throw new CalendarServiceError("CALENDAR_QUERY_INVALID", "Calendar date range is invalid", 400);
  return parsed.data;
}

function redirect(env: CalendarRouteEnv, providerName: string, result: "connected" | "error") {
  const location = new URL("/", env.APP_BASE_URL);
  location.searchParams.set("calendar", result);
  location.searchParams.set("provider", providerName);
  return new Response(null, { status: 302, headers: { location: location.toString() } });
}

function principalId(principal: SessionPrincipal | undefined) {
  if (!principal) throw new CalendarServiceError("UNAUTHENTICATED", "Authentication is required", 401);
  return principal.userId;
}

export function registerCalendarRoutes<TEnv extends CalendarRouteEnv>(
  registry: Registry<TEnv>,
  createService: (env: TEnv) => Service,
) {
  const standardRateLimit = { bucket: "ip", limit: 30, windowSeconds: 60 } as const;
  registry.register({
    method: "GET", path: "/api/v2/calendar/connections", auth: "session", rateLimit: standardRateLimit,
    handler: async ({ env, principal }) => ({ data: { items: await createService(env).listConnections(principalId(principal)) } }),
  });
  registry.register({
    method: "POST", path: "/api/v2/calendar/connections/:provider/start", auth: "session",
    rateLimit: { bucket: "ip", limit: 10, windowSeconds: 60 },
    handler: async ({ env, principal, params }) => ({ data: await createService(env).startConnection(principalId(principal), provider(params.provider!)) }),
  });
  registry.register({
    method: "GET", path: "/api/v2/calendar/oauth/:provider/callback", auth: "public",
    handler: async ({ request, env, params, signal }) => {
      const providerName = provider(params.provider!);
      const search = new URL(request.url).searchParams;
      const state = search.get("state") ?? "";
      const code = search.get("code") ?? "";
      if (search.get("error") || !state || state.length > 512 || !code || code.length > 4096) return redirect(env, providerName, "error");
      try {
        await createService(env).completeOAuth(providerName, state, code, signal);
        return redirect(env, providerName, "connected");
      } catch {
        return redirect(env, providerName, "error");
      }
    },
  });
  registry.register({
    method: "GET", path: "/api/v2/calendar/events", auth: "session", rateLimit: standardRateLimit,
    handler: async ({ request, env, principal }) => ({ data: { items: await createService(env).listEvents(principalId(principal), queryFromRequest(request)) } }),
  });
  registry.register({
    method: "POST", path: "/api/v2/calendar/connections/:connectionId/sync", auth: "session",
    rateLimit: { bucket: "ip", limit: 10, windowSeconds: 60 }, body: CalendarEventsQuerySchema,
    handler: async ({ env, principal, params, body, signal }) => {
      const result = await createService(env).syncConnection(principalId(principal), params.connectionId!, body, signal);
      if (!result.connection) throw new CalendarServiceError("CALENDAR_CONNECTION_NOT_FOUND", "Calendar connection not found", 404);
      return { data: { connection: result.connection, imported_count: result.importedCount } };
    },
  });
  registry.register({
    method: "DELETE", path: "/api/v2/calendar/connections/:connectionId", auth: "session",
    rateLimit: { bucket: "ip", limit: 10, windowSeconds: 60 },
    handler: async ({ env, principal, params }) => ({ data: await createService(env).disconnect(principalId(principal), params.connectionId!) }),
  });
}
