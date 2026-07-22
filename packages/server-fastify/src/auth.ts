import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Principal } from "@notifications/core";
import type { NotificationPluginOptions } from "./index";

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}

/**
 * Build the preHandler that resolves the host's identity to a Principal. 401s when the host's auth
 * adapter returns null; otherwise decorates `req.principal`. This is the sole identity entry point —
 * the plugin never reads sessions/users itself.
 */
export function makeRequirePrincipal(
  auth: NotificationPluginOptions["auth"],
): preHandlerHookHandler {
  return async function requirePrincipal(req: FastifyRequest, reply: FastifyReply) {
    const principal = await auth(req);
    if (!principal) {
      reply.code(401).send({ error: "authentication required" });
      return;
    }
    req.principal = principal;
  };
}
