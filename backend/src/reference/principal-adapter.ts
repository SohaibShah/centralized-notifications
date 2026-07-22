import type { Principal } from "@notifications/core";
import type { SessionUser } from "../auth/repository";

/**
 * The reference app's auth adapter: map its own session user to the library's Principal. This is the
 * host-specific identity mapping the library seam exists for — a different host maps its own identity
 * model here instead. `userKey` = username (the opaque key audience `user`-scope matches on).
 */
export function toPrincipal(user: SessionUser): Principal {
  return { userKey: user.username, roles: user.roles, teamKeys: user.teamIds };
}
