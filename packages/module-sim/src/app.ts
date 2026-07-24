import Fastify, { type FastifyInstance } from "fastify";
import { registerActionRoutes } from "./routes/actions";

export interface AppConfig {
  hubUrl: string;
  intakeToken: string;
  dispatchToken: string;
  port: number;
}

declare module "fastify" {
  interface FastifyInstance {
    simConfig: AppConfig;
  }
}

/**
 * Builds the module-sim Fastify app. `GET /health` plus the dispatched-action
 * endpoint (`POST|GET /:module/actions/:name`, Task 11); later tasks add the
 * emit-to-hub API and the control-center page as further route registrations
 * here.
 */
export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify();

  // Decorated (not just closed over) so later tasks' route handlers — the
  // emit-to-hub client, the control-center page — can read it via
  // `app.simConfig` without threading it through again.
  app.decorate("simConfig", config);

  app.get("/health", async () => ({ status: "ok" }));

  registerActionRoutes(app, config);

  return app;
}
