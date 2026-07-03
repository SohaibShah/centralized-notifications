import Fastify, { type FastifyInstance } from "fastify";
import { SHARED_PACKAGE } from "@notifications/shared";

/**
 * Placeholder Fastify bootstrap. The real intake boundary, pipeline, SSE, admin
 * routes, and (week 5) Redis consumers are added in later tasks — see the backend
 * layout in docs/architecture.md and docs/implementation-plan.md.
 *
 * `buildServer` is a factory (no top-level `listen`) so it can be imported by
 * tests without starting a socket. `src/index.ts` is the runnable entrypoint.
 */
export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok", shared: SHARED_PACKAGE }));

  return app;
}
