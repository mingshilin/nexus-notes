import type { RouteDefinition } from "../http/route-registry";
import type { D1DatabaseRepository } from "../databases/d1-database-repository";

export interface DatabaseRegistry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

export type DatabaseRepositoryFactory<TEnv> = (env: TEnv) => D1DatabaseRepository;

export function recordListOptions(request: Request) {
  const params = new URL(request.url).searchParams;
  const requested = Number(params.get("limit") ?? 50);
  return {
    cursor: params.get("cursor"),
    view_id: params.get("view_id"),
    limit: Number.isInteger(requested) && requested > 0 ? Math.min(requested, 100) : 50,
  };
}

export function recordSearchOptions(request: Request) {
  const params = new URL(request.url).searchParams;
  const requested = Number(params.get("limit") ?? 50);
  return {
    query: params.get("q")?.trim() ?? "",
    cursor: params.get("cursor"),
    limit: Number.isInteger(requested) && requested > 0 ? Math.min(requested, 100) : 50,
  };
}
