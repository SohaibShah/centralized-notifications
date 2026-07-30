import { timingSafeEqual } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { SHARED_PACKAGE } from "@notifications/shared";
import { notificationFastifyPlugin } from "@notifications/server-fastify";
import { authRoutes } from "./auth/routes";
import { getSessionUser } from "./auth/guards";
import { getUserWithRolesTeams } from "./auth/repository";
import { registerSession } from "./auth/session";
import { getEnv, type Env } from "./config/env";
import { maintenanceRoutes } from "./http/admin/maintenance";
import { createReferenceService } from "./reference/service";
import { toPrincipal } from "./reference/principal-adapter";
import { listSummaryScheduleRows } from "./summary/schedule-repo";
import { startSummaryScheduler } from "./summary/scheduler";

/**
 * DB maintenance is a non-production tool: its routes are registered only outside production,
 * so they are genuinely absent — not merely hidden — in prod.
 *
 * OPERATIONAL REQUIREMENT: `NODE_ENV` defaults to "development" (see config/env.ts), so this gate
 * fails OPEN — a production deployment MUST set `NODE_ENV=production` explicitly.
 */
export function isSimulatorEnabled(env: Env = getEnv()): boolean {
  return env.NODE_ENV !== "production";
}

/** Constant-time comparison of the internal intake token (length mismatch short-circuits). */
function intakeTokenMatches(req: FastifyRequest): boolean {
  const header = req.headers["x-internal-token"];
  const provided = Array.isArray(header) ? header[0] : header;
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(getEnv().INTERNAL_INTAKE_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Build the Fastify app as a factory (no top-level `listen`) so tests can drive it with
 * `app.inject`. The reference app owns identity (session/auth) and consumes the notification system
 * through @notifications/core (the service) + @notifications/server-fastify (the mounted routes),
 * exactly as a third-party host would — the auth adapter maps our SessionUser to a Principal.
 *
 * NOTE: `maxParamLength: 256` is required by the notification plugin (a notification id can be up to
 * 200 chars; Fastify's default 100 would 414 a valid long id before the handler runs).
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, maxParamLength: 256 });

  const service = createReferenceService();
  await service.ready();

  // global:false — only routes that opt in (e.g. /auth/login) are rate-limited.
  await app.register(rateLimit, { global: false });
  await registerSession(app);
  await app.register(authRoutes);

  await app.register(notificationFastifyPlugin, {
    service,
    auth: async (req) => {
      const user = await getSessionUser(req);
      return user ? toPrincipal(user) : null;
    },
    intakeAuth: intakeTokenMatches,
  });

  if (isSimulatorEnabled()) {
    await app.register(async (instance) => maintenanceRoutes(instance, service));
  }

  app.get("/health", async () => ({ status: "ok", shared: SHARED_PACKAGE }));

  // Daily per-user-local summary generation. Host-owned (core is identity-free and can't enumerate
  // users): the in-process timer drives core's pure due-check + refreshSummary per due user. Never
  // runs under NODE_ENV=test (the suites drive runSummaryTick directly with an injected clock).
  const env = getEnv();
  if (env.NODE_ENV !== "test" && env.SUMMARY_SCHEDULER_ENABLED) {
    const stop = startSummaryScheduler({
      getSettings: () => service.getSettings(),
      listRows: listSummaryScheduleRows,
      generate: async (row) => {
        const user = await getUserWithRolesTeams(row.id);
        if (user) await service.refreshSummary({ principal: toPrincipal(user) });
      },
    });
    app.addHook("onClose", async () => stop());
  }

  return app;
}
