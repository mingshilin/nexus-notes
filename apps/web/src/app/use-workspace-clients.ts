import { useRef } from "react";

import { CollaborationClient } from "../data/collaboration-client";
import { DatabaseClient } from "../data/database-client";
import { KnowledgeClient } from "../data/knowledge-client";
import { NotesClient } from "../data/notes-client";
import { OperationsClient } from "../data/operations-client";
import { ProfileClient } from "../data/profile-client";
import type { ApiClient } from "../data/api-client";
import { workspaceQueryCacheFor } from "../data/workspace-query-cache";

export interface WorkspaceClients {
  collaboration: CollaborationClient;
  databases: DatabaseClient;
  knowledge: KnowledgeClient;
  notes: NotesClient;
  operations: OperationsClient;
  profile: ProfileClient;
}

interface WorkspaceClientScope {
  apiClient: ApiClient;
  workspaceId: string;
  userId: string;
  clients: WorkspaceClients;
}

function createWorkspaceClients(apiClient: ApiClient, workspaceId: string, userId: string): WorkspaceClients {
  const queryCache = workspaceQueryCacheFor(apiClient);
  return {
    collaboration: new CollaborationClient(apiClient, workspaceId),
    databases: new DatabaseClient(apiClient, workspaceId, { userId, queryCache }),
    knowledge: new KnowledgeClient(apiClient, workspaceId, { userId, queryCache }),
    notes: new NotesClient(apiClient, workspaceId, { userId, queryCache }),
    operations: new OperationsClient(apiClient, workspaceId),
    profile: new ProfileClient(apiClient, { userId, workspaceId, queryCache }),
  };
}

export function useWorkspaceClients(apiClient: ApiClient, workspaceId: string, userId = "anonymous") {
  const scope = useRef<WorkspaceClientScope | null>(null);
  if (scope.current?.apiClient !== apiClient || scope.current.workspaceId !== workspaceId || scope.current.userId !== userId) {
    scope.current = {
      apiClient,
      workspaceId,
      userId,
      clients: createWorkspaceClients(apiClient, workspaceId, userId),
    };
  }
  return scope.current.clients;
}
