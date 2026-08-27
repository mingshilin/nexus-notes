import { useCallback, useRef, useState } from "react";

import type { ProductDomain } from "../navigation/ProductNavigation";
import { recordInteraction, type InteractionMetric } from "../performance/interaction-budget";
import { preloadWorkspaceDomain } from "./workspace-domain-loader";

export interface WorkspaceNavigationState {
  activeDomain: ProductDomain;
  requestedDomain: ProductDomain;
  domainPending: boolean;
  lastInteraction: InteractionMetric | null;
  navigate(domain: ProductDomain): void;
}

function interactionNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function useWorkspaceNavigation(initialDomain: ProductDomain = "notes"): WorkspaceNavigationState {
  const [activeDomain, setActiveDomain] = useState<ProductDomain>(initialDomain);
  const [requestedDomain, setRequestedDomain] = useState<ProductDomain>(initialDomain);
  const [pendingRequestId, setPendingRequestId] = useState(0);
  const [lastInteraction, setLastInteraction] = useState<InteractionMetric | null>(null);
  const requestIdRef = useRef(0);

  const navigate = useCallback((domain: ProductDomain) => {
    const startedAt = interactionNow();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setRequestedDomain(domain);
    setActiveDomain(domain);
    setPendingRequestId(requestId);

    void preloadWorkspaceDomain(domain).then(
      () => {
        const metric = recordInteraction(`workspace:${domain}`, startedAt);
        if (requestIdRef.current !== requestId) return;
        setLastInteraction(metric);
        setPendingRequestId(0);
      },
      () => {
        if (requestIdRef.current !== requestId) return;
        setPendingRequestId(0);
      },
    );
  }, []);

  return {
    activeDomain,
    requestedDomain,
    domainPending: pendingRequestId !== 0,
    lastInteraction,
    navigate,
  };
}
