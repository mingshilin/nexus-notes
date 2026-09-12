import { lazy, Suspense } from "react";
import type {
  CollaborationCommentTarget,
  CollaborationShareTarget,
  NotificationTarget,
} from "../../collaboration/collaboration-types";
import type { CollaborationClient } from "../../data/collaboration-client";
import type { WorkspaceRoleContract } from "@nexus/contracts";
import { NotificationCenter } from "../../collaboration/NotificationCenter";
import { loadCollaborationCenter } from "../workspace-domain-loader";
import type { CollaborationSection } from "../../collaboration/use-collaboration-center-data";

const LazyCollaborationCenter = lazy(async () => {
  const module = await loadCollaborationCenter();
  return { default: module.CollaborationCenter };
});

export interface CollaborationDomainProps {
  client: CollaborationClient;
  workspaceId: string;
  userId: string;
  role: WorkspaceRoleContract;
  initialSection: CollaborationSection;
  activeTarget?: Pick<CollaborationCommentTarget, "type" | "id">;
  selectedCommentId?: string | null;
  commentTargets?: CollaborationCommentTarget[];
  shareTargets?: CollaborationShareTarget[];
  targetError?: string | null;
}

export interface CollaborationNotificationSurfaceProps {
  client: CollaborationClient;
  workspaceId: string;
  userId: string;
  notificationOpen: boolean;
  unreadCount: number;
  notificationOpener: HTMLElement | null;
  onNotificationClose(): void;
  onNotificationRead(count: number): void;
  onNotificationDeepLink(target: NotificationTarget): void;
}

export function CollaborationDomain({
  client,
  workspaceId,
  userId,
  role,
  initialSection,
  activeTarget,
  selectedCommentId,
  commentTargets,
  shareTargets,
  targetError,
}: CollaborationDomainProps) {
  return (
    <>
      {targetError ? <p className="collaboration-error" role="alert">{targetError}</p> : null}
      <Suspense fallback={<p className="database-empty" role="status">正在加载协作中心…</p>}>
        <LazyCollaborationCenter
          client={client}
          workspaceId={workspaceId}
          userId={userId}
          role={role}
          initialSection={initialSection}
          activeTarget={activeTarget}
          selectedCommentId={selectedCommentId}
          commentTargets={commentTargets}
          shareTargets={shareTargets}
        />
      </Suspense>
    </>
  );
}

export function CollaborationNotificationSurface({
  client,
  workspaceId,
  userId,
  notificationOpen,
  unreadCount,
  notificationOpener,
  onNotificationClose,
  onNotificationRead,
  onNotificationDeepLink,
}: CollaborationNotificationSurfaceProps) {
  return (
    <NotificationCenter
      client={client}
      open={notificationOpen}
      unreadCount={unreadCount}
      cacheScope={`${userId}:${workspaceId}`}
      opener={notificationOpener}
      onClose={onNotificationClose}
      onNotificationRead={onNotificationRead}
      onDeepLink={onNotificationDeepLink}
    />
  );
}
