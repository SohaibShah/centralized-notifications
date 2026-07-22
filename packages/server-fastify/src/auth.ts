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

/**
 * Build the preHandler that requires the resolved Principal to hold `adminRole`. 401 if unauthed,
 * 403 if authed without the role. Admin power is just a role in the host's identity — the library
 * owns no admin concept beyond this check.
 */
export function makeRequireAdmin(
  auth: NotificationPluginOptions["auth"],
  adminRole: string,
): preHandlerHookHandler {
  return async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
    const principal = await auth(req);
    if (!principal) {
      reply.code(401).send({ error: "authentication required" });
      return;
    }
    if (!principal.roles.includes(adminRole)) {
      reply.code(403).send({ error: "admin role required" });
      return;
    }
    req.principal = principal;
  };
}
