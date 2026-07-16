import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { SHARED_PACKAGE } from "@notifications/shared";
import { authRoutes } from "./auth/routes";
import { registerSession } from "./auth/session";
import { getEnv, type Env } from "./config/env";
import { httpIntake } from "./intake/http-intake";
import { adminRoutes } from "./http/admin/routes";
import { simulateRoutes } from "./http/admin/simulate";
import { notificationRoutes } from "./http/notifications/routes";
import { sseRoutes } from "./http/sse/routes";

/**
 * The dev/QA notification generator is a non-production tool: its route (POST /admin/simulate)
 * is registered only outside production, so it is genuinely absent — not merely hidden — in prod.
 *
 * OPERATIONAL REQUIREMENT: `NODE_ENV` defaults to "development" (see config/env.ts), so this
 * gate fails OPEN — a production deployment MUST set `NODE_ENV=production` explicitly. An unset
 * or misspelled value leaves this endpoint registered. (A fail-closed `ENABLE_SIMULATOR` opt-in
 * was considered and deferred while there is no production deployment.)
 */
export function isSimulatorEnabled(env: Env = getEnv()): boolean {
  return env.NODE_ENV !== "production";
}

/**
 * Builds the Fastify app as a factory (no top-level `listen`) so tests can drive
 * it with `app.inject`. Registers session support, prototype auth routes, the HTTP
 * intake boundary, the notifications read API, and the SSE delivery stream; later
 * tasks add admin routes here.
 */
export async function buildServer(): Promise<FastifyInstance> {
  // maxParamLength defaults to 100, but a notification id (the contract PK, used as the
  // :id path param on POST /notifications/:id/read) may be up to 200 chars — without
  // this, the router would 414 a valid long id before the handler ever runs. 256 gives
  // headroom above the 200-char contract bound.
  const app = Fastify({ logger: true, maxParamLength: 256 });

  // global:false — only routes that opt in (e.g. /auth/login) are rate-limited,
  // so reads like /auth/me and /health aren't throttled.
  await app.register(rateLimit, { global: false });
  await registerSession(app);
  await app.register(authRoutes);
  await app.register(httpIntake);
  await app.register(notificationRoutes);
  await app.register(adminRoutes);
  if (isSimulatorEnabled()) await app.register(simulateRoutes);
  await app.register(sseRoutes);

  app.get("/health", async () => ({ status: "ok", shared: SHARED_PACKAGE }));

  return app;
}
