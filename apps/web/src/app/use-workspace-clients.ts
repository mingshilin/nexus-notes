import { useRef } from "react";

import { CollaborationClient } from "../data/collaboration-client";
import { DatabaseClient } from "../data/database-client";
import { KnowledgeClient } from "../data/knowledge-client";
import { NotesClient } from "../data/notes-client";
import { OperationsClient } from "../data/operations-client";
import { ProfileClient } from "../data/profile-client";
import type { ApiClient } from "../data/api-client";

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
  clients: WorkspaceClients;
}

function createWorkspaceClients(apiClient: ApiClient, workspaceId: string): WorkspaceClients {
  return {
    collaboration: new CollaborationClient(apiClient, workspaceId),
    databases: new DatabaseClient(apiClient, workspaceId),
    knowledge: new KnowledgeClient(apiClient, workspaceId),
    notes: new NotesClient(apiClient, workspaceId),
    operations: new OperationsClient(apiClient, workspaceId),
    profile: new ProfileClient(apiClient),
  };
}

export function useWorkspaceClients(apiClient: ApiClient, workspaceId: string) {
  const scope = useRef<WorkspaceClientScope | null>(null);
  if (scope.current?.apiClient !== apiClient || scope.current.workspaceId !== workspaceId) {
    scope.current = {
      apiClient,
      workspaceId,
      clients: createWorkspaceClients(apiClient, workspaceId),
    };
  }
  return scope.current.clients;
}
