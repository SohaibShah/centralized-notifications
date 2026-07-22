import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { NotificationService, Principal } from "@notifications/core";
import { makeRequirePrincipal } from "./auth";
import { notificationReadRoutes } from "./routes/notifications";

/**
 * What a host supplies when mounting the notification routes. `auth` resolves the host's identity to
 * a Principal (null → 401); `intakeAuth` gates the internal publish endpoint (false → rejected). The
 * host's login/sessions/users live entirely in the host — this plugin trusts the resolved Principal.
 */
export interface NotificationPluginOptions {
  service: NotificationService;
  auth: (req: FastifyRequest) => Promise<Principal | null> | Principal | null;
  intakeAuth: (req: FastifyRequest) => Promise<boolean> | boolean;
}

/**
 * Mounts the notification HTTP + SSE routes onto the host's Fastify server.
 *
 * NOTE: a notification id can be up to 200 chars (the `:id` path param on the read routes). The HOST
 * must construct Fastify with `maxParamLength >= 256` (default is 100) or a valid long id will 414
 * before the handler runs — a plugin can't change the server-level option.
 */
export const notificationFastifyPlugin: FastifyPluginAsync<NotificationPluginOptions> = async (
  app,
  opts,
) => {
  const requirePrincipal = makeRequirePrincipal(opts.auth);
  notificationReadRoutes(app, { service: opts.service, requirePrincipal });
  // SSE, intake, and admin route groups are registered here in Tasks 14–16.
};
