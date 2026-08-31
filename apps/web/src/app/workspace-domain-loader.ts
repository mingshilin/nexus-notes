import type { ProductDomain } from "../navigation/ProductNavigation";

export type DomainModuleLoader = () => Promise<unknown>;

export const loadDatabaseWorkbench = () => import("../databases/DatabaseWorkbench");
export const loadKnowledgeSearchPanel = () => import("../knowledge/KnowledgeSearchPanel");
export const loadKnowledgeGraphPanel = () => import("../knowledge/KnowledgeGraphPanel");
export const loadKnowledgeCalendarPanel = () => import("../knowledge/KnowledgeCalendarPanel");
export const loadExternalCalendarPanel = () => import("../knowledge/ExternalCalendarPanel");
export const loadReminderPanel = () => import("../reminders/ReminderPanel");
export const loadAccountCenter = () => import("../account/AccountCenter");
export const loadAIChatPanel = () => import("../ai/AIChatPanel");
export const loadCollaborationCenter = () => import("../collaboration/CollaborationCenter");

const defaultLoaders: Partial<Record<ProductDomain, DomainModuleLoader>> = {
  databases: loadDatabaseWorkbench,
  // Search is the primary knowledge entry; secondary tools load on demand.
  knowledge: loadKnowledgeSearchPanel,
  reminders: loadReminderPanel,
  collaboration: loadCollaborationCenter,
  ai: loadAIChatPanel,
  account: loadAccountCenter,
};

export function createDomainPreloader(loaders: Partial<Record<ProductDomain, DomainModuleLoader>>) {
  const requests = new Map<ProductDomain, Promise<unknown>>();
  return (domain: ProductDomain) => {
    const existing = requests.get(domain);
    if (existing) return existing;
    const loader = loaders[domain];
    if (!loader) return Promise.resolve(null);
    const request = Promise.resolve().then(loader);
    requests.set(domain, request);
    void request.catch(() => {
      if (requests.get(domain) === request) requests.delete(domain);
    });
    return request;
  };
}

export const preloadWorkspaceDomain = createDomainPreloader(defaultLoaders);
