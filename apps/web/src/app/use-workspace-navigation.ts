import { useCallback, useEffect, useRef, useState } from "react";

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

const domainsWithLazyModules = new Set<ProductDomain>(["databases", "knowledge", "reminders", "collaboration", "ai", "account"]);

function interactionNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export function useWorkspaceNavigation(initialDomain: ProductDomain = "notes"): WorkspaceNavigationState {
  const [activeDomain, setActiveDomain] = useState<ProductDomain>(initialDomain);
  const [requestedDomain, setRequestedDomain] = useState<ProductDomain>(initialDomain);
  const [pendingRequestId, setPendingRequestId] = useState(0);
  const [lastInteraction, setLastInteraction] = useState<InteractionMetric | null>(null);
  const requestIdRef = useRef(0);
  const activeDomainRef = useRef(initialDomain);
  const requestedDomainRef = useRef(initialDomain);
  const shellFrameRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (shellFrameRef.current !== null) {
      window.cancelAnimationFrame(shellFrameRef.current);
    }
  }, []);

  const navigate = useCallback((domain: ProductDomain) => {
    if (domain === activeDomainRef.current && domain === requestedDomainRef.current) return;

    const startedAt = interactionNow();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const hasLazyModule = domainsWithLazyModules.has(domain);

    activeDomainRef.current = domain;
    requestedDomainRef.current = domain;
    setRequestedDomain(domain);
    setActiveDomain(domain);

    if (shellFrameRef.current !== null) {
      window.cancelAnimationFrame(shellFrameRef.current);
      shellFrameRef.current = null;
    }

    if (!hasLazyModule) {
      setPendingRequestId(0);
      return;
    }

    setPendingRequestId(requestId);
    shellFrameRef.current = window.requestAnimationFrame(() => {
      shellFrameRef.current = null;
      if (requestIdRef.current !== requestId) return;
      setLastInteraction(recordInteraction(`navigation-shell:${domain}`, startedAt));
      setPendingRequestId(0);
    });

    void preloadWorkspaceDomain(domain).catch(() => undefined);
  }, []);

  return {
    activeDomain,
    requestedDomain,
    domainPending: pendingRequestId !== 0,
    lastInteraction,
    navigate,
  };
}
