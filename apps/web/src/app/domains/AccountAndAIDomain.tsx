import { lazy, Suspense } from "react";
import type { Profile, WorkspaceMembershipSummary } from "@nexus/contracts";

import type { ApiClient } from "../../data/api-client";
import type { CollaborationClient } from "../../data/collaboration-client";
import type { OperationsClient } from "../../data/operations-client";
import type { ProfileClient } from "../../data/profile-client";
import type { AccountTab } from "../../account";
import type { AIChatReadContext } from "../../ai/AIChatPanel";
import { loadAccountCenter, loadAIChatPanel } from "../workspace-domain-loader";
import type { WorkspaceDomainProps } from "./NotesDomain";

const LazyAccountCenter = lazy(async () => {
  const module = await loadAccountCenter();
  return { default: module.AccountCenter };
});
const LazyAIChatPanel = lazy(async () => {
  const module = await loadAIChatPanel();
  return { default: module.AIChatPanel };
});

export interface AccountAndAIDomainClient {
  api: ApiClient;
  profile: ProfileClient;
  collaboration: CollaborationClient;
  operations: OperationsClient;
}

export type AccountAndAIDomainSelection =
  | { kind: "ai"; showStatus?: boolean; readContext?: AIChatReadContext }
  | { kind: "account"; workspaces: WorkspaceMembershipSummary[]; activeWorkspaceId: string | null; currentUserId: string; initialTab: AccountTab };

export interface AccountAndAIDomainCallbacks {
  onWorkspaceChange(workspaceId: string): void | Promise<void>;
  onCreateWorkspace?(name: string): Promise<WorkspaceMembershipSummary> | void;
  onPrepareDelete?(): Promise<void>;
  onDeleteFailed?(): void;
  onDeleted(): void;
  onProfileChange?(profile: Profile): void;
}

export type AccountAndAIDomainProps = WorkspaceDomainProps<AccountAndAIDomainClient, AccountAndAIDomainSelection, AccountAndAIDomainCallbacks>;

export function AccountAndAIDomain({ client, workspaceId, selectedEntity, callbacks }: AccountAndAIDomainProps) {
  if (selectedEntity.kind === "ai") {
    return <Suspense fallback={<p className="database-empty" role="status">正在加载 AI 助手…</p>}><LazyAIChatPanel client={client.api} workspaceId={workspaceId} showStatus={selectedEntity.showStatus} readContext={selectedEntity.readContext} /></Suspense>;
  }

  return (
    <Suspense fallback={<p className="database-empty" role="status">正在加载账户中心…</p>}>
      <LazyAccountCenter
        client={client.profile}
        cacheScope={`${selectedEntity.currentUserId}:${selectedEntity.activeWorkspaceId ?? ""}`}
        ai={client.api}
        collaboration={client.collaboration}
        operations={client.operations}
        workspaces={selectedEntity.workspaces}
        activeWorkspaceId={selectedEntity.activeWorkspaceId}
        currentUserId={selectedEntity.currentUserId}
        initialTab={selectedEntity.initialTab}
        onWorkspaceChange={callbacks.onWorkspaceChange}
        onCreateWorkspace={callbacks.onCreateWorkspace}
        onPrepareDelete={callbacks.onPrepareDelete}
        onDeleteFailed={callbacks.onDeleteFailed}
        onDeleted={callbacks.onDeleted}
        onProfileChange={callbacks.onProfileChange}
      />
    </Suspense>
  );
}
