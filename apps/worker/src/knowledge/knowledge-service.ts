import type { SavedSearch, SavedSearchInput, SearchHit, SearchRequest } from "@nexus/contracts";

export interface KnowledgeActorContext {
  workspaceId: string;
  userId: string;
}

export interface KnowledgeRepository {
  search(workspaceId: string, request: SearchRequest): Promise<{
    items: SearchHit[];
    nextCursor: string | null;
  }>;
  listSavedSearches(workspaceId: string, userId: string): Promise<SavedSearch[]>;
  createSavedSearch(input: {
    workspaceId: string;
    userId: string;
    input: SavedSearchInput;
    now: string;
  }): Promise<SavedSearch>;
  deleteSavedSearch(workspaceId: string, userId: string, savedSearchId: string): Promise<void>;
}

export class KnowledgeService {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: KnowledgeRepository,
    options: { clock?: () => Date } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async search(context: KnowledgeActorContext, request: SearchRequest) {
    const result = await this.repository.search(context.workspaceId, request);
    return { items: result.items, next_cursor: result.nextCursor };
  }

  listSavedSearches(context: KnowledgeActorContext) {
    return this.repository.listSavedSearches(context.workspaceId, context.userId);
  }

  createSavedSearch(context: KnowledgeActorContext, input: SavedSearchInput) {
    return this.repository.createSavedSearch({
      workspaceId: context.workspaceId,
      userId: context.userId,
      input,
      now: this.clock().toISOString(),
    });
  }

  deleteSavedSearch(context: KnowledgeActorContext, savedSearchId: string) {
    return this.repository.deleteSavedSearch(context.workspaceId, context.userId, savedSearchId);
  }
}
