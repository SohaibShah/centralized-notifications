import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { NotificationService, Principal } from "@notifications/core";

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

/** Mounts the notification HTTP + SSE routes onto the host's Fastify server. */
export const notificationFastifyPlugin: FastifyPluginAsync<
  NotificationPluginOptions
> = async () => {
  // Route groups are registered here in Tasks 13–16.
};
