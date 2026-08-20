import { createRouteRegistry } from "./http/route-registry";
import { healthRoute, type BetaWorkerEnv } from "./routes/health";

const registry = createRouteRegistry<BetaWorkerEnv>();
registry.register(healthRoute);

export default {
  fetch(request: Request, env: BetaWorkerEnv) {
    return registry.fetch(request, env);
  },
};

export { createRouteRegistry } from "./http/route-registry";
export type { BetaWorkerEnv } from "./routes/health";
