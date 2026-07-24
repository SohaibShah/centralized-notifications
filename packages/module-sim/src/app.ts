import Fastify, { type FastifyInstance } from "fastify";

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
 * Builds the module-sim Fastify app. Scaffold only — this app currently
 * exposes just `GET /health`; later tasks add the dispatched-action handlers,
 * the emit-to-hub API, and the control-center page as further route
 * registrations here.
 */
export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify();

  // Decorated (not just closed over) so later tasks' route handlers — the
  // dispatched-action endpoint, the emit-to-hub client, the control-center
  // page — can read it via `app.simConfig` without threading it through again.
  app.decorate("simConfig", config);

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
