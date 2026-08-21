import type { SavedSearch, SavedSearchInput, SearchHit, SearchRequest } from "@nexus/contracts";

import type { ApiClient } from "./api-client";

export class KnowledgeClient {
  private readonly createId: () => string;

  constructor(
    private readonly client: Pick<ApiClient, "request">,
    private readonly workspaceId: string,
    options: { createId?: () => string } = {},
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  search(input: SearchRequest & { signal?: AbortSignal }) {
    const { signal, ...body } = input;
    return this.client.request<{ items: SearchHit[]; next_cursor: string | null }>({
      path: "/api/v2/search",
      method: "POST",
      headers: this.headers(),
      body,
      requestClass: "query",
      policy: {
        timeoutMs: 10_000,
        retry: 2,
        dedupeKey: `search:${this.workspaceId}:${JSON.stringify(body)}`,
        signal,
      },
    });
  }

  listSavedSearches(signal?: AbortSignal) {
    return this.client.request<{ items: SavedSearch[] }>({
      path: "/api/v2/search/saved",
      headers: this.headers(),
      requestClass: "query",
      policy: {
        timeoutMs: 8_000,
        retry: 2,
        dedupeKey: `saved-searches:${this.workspaceId}`,
        signal,
      },
    }).then(({ items }) => items);
  }

  createSavedSearch(input: SavedSearchInput) {
    return this.client.request<{ saved_search: SavedSearch }>({
      path: "/api/v2/search/saved",
      method: "POST",
      headers: this.headers(),
      body: input,
      requestClass: "command",
      policy: { timeoutMs: 8_000, retry: 0, idempotencyKey: this.createId() },
    }).then(({ saved_search: savedSearch }) => savedSearch);
  }

  deleteSavedSearch(savedSearchId: string) {
    return this.client.request<{ deleted: true }>({
      path: `/api/v2/search/saved/${encodeURIComponent(savedSearchId)}`,
      method: "DELETE",
      headers: this.headers(),
      requestClass: "command",
      policy: { timeoutMs: 8_000, retry: 0, idempotencyKey: this.createId() },
    });
  }

  private headers() {
    return { "x-workspace-id": this.workspaceId };
  }
}
