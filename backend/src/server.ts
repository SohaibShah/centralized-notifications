import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { SHARED_PACKAGE } from "@notifications/shared";
import { authRoutes } from "./auth/routes";
import { registerSession } from "./auth/session";

/**
 * Builds the Fastify app as a factory (no top-level `listen`) so tests can drive
 * it with `app.inject`. Registers session support and the prototype auth routes;
 * later tasks add the intake boundary, pipeline, SSE, and admin routes here.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // global:false — only routes that opt in (e.g. /auth/login) are rate-limited,
  // so reads like /auth/me and /health aren't throttled.
  await app.register(rateLimit, { global: false });
  await registerSession(app);
  await app.register(authRoutes);

  app.get("/health", async () => ({ status: "ok", shared: SHARED_PACKAGE }));

  return app;
}
