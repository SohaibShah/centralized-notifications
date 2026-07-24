import Fastify, { type FastifyInstance } from "fastify";
import { registerActionRoutes } from "./routes/actions";
import { registerEmitRoute } from "./routes/emit";

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
 * (`POST|GET /:module/actions/:name`, Task 11) and the emit-to-hub API (`POST /emit`, Task
 * 12); a later task adds the control-center page as a further route registration here.
 */
export function buildApp(config: AppConfig, deps: AppDeps = {}): FastifyInstance {
  const app = Fastify();

  // Decorated (not just closed over) so later tasks' route handlers — the
  // control-center page — can read it via `app.simConfig` without threading it through again.
  app.decorate("simConfig", config);

  app.get("/health", async () => ({ status: "ok" }));

  registerActionRoutes(app, config);
  registerEmitRoute(app, config, deps.fetchImpl ?? fetch);

  return app;
}
