import Fastify, { type FastifyInstance } from "fastify";
import { registerActionRoutes } from "./routes/actions";
import { registerCatalogRoute } from "./routes/catalog";
import { registerEmitRoute } from "./routes/emit";
import { registerPageRoute } from "./routes/page";

export interface AppConfig {
  hubUrl: string;
  intakeToken: string;
  dispatchToken: string;
  port: number;
}

/** Build-time-only dependencies that aren't process config — currently just the `fetch`
 * implementation `/emit` uses to call the hub, injectable so tests can fake the hub call. */
export interface AppDeps {
  fetchImpl?: typeof fetch;
}

declare module "fastify" {
  interface FastifyInstance {
    simConfig: AppConfig;
  }
}

/**
 * Builds the module-sim Fastify app. `GET /health` plus the dispatched-action endpoint
 * (`POST|GET /:module/actions/:name`, Task 11), the emit-to-hub API (`POST /emit`, Task 12),
 * the `/catalog` read model, and the control-center page at `GET /` (Task 13).
 */
export function buildApp(config: AppConfig, deps: AppDeps = {}): FastifyInstance {
  const app = Fastify();

  // Decorated (not just closed over) so later tasks' route handlers — the
  // control-center page — can read it via `app.simConfig` without threading it through again.
  app.decorate("simConfig", config);

  app.get("/health", async () => ({ status: "ok" }));

  registerActionRoutes(app, config);
  registerEmitRoute(app, config, deps.fetchImpl ?? fetch);
  registerCatalogRoute(app);
  registerPageRoute(app);

  return app;
}
