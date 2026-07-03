import type { FastifyReply, FastifyRequest } from "fastify";
import { getUserWithRolesTeams, type SessionUser } from "./repository";
import { getSessionUserId } from "./session";

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

/** Resolve the current session's user (with roles/teams) or null. */
export async function getSessionUser(req: FastifyRequest): Promise<SessionUser | null> {
  const userId = getSessionUserId(req);
  if (!userId) return null;
  return getUserWithRolesTeams(userId);
}

/** preHandler: 401 unless logged in; on success decorates req.user. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const user = await getSessionUser(req);
  if (!user) return reply.code(401).send({ error: "authentication required" });
  req.user = user;
}

/** preHandler: 401 if not logged in, 403 unless the user holds the `admin` role. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const user = req.user ?? (await getSessionUser(req));
  if (!user) return reply.code(401).send({ error: "authentication required" });
  if (!user.roles.includes("admin")) return reply.code(403).send({ error: "admin role required" });
  req.user = user;
}
