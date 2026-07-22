import type { SessionUser } from "../auth/repository";

/**
 * WHO is asking, as the audience filter needs them. The injectable seam for library-ification:
 * today it's a thin adapter over the session user, later the host supplies this directly.
 * `userKey` matches `audience.id` for scope="user" (= username now); `roles`/`teamKeys` are the
 * role_keys / team_keys matched for scope="role" / "team".
 */
export interface Principal {
  userKey: string;
  roles: string[];
  teamKeys: string[];
}

export function resolvePrincipal(user: SessionUser): Principal {
  // SessionUser.teamIds already holds team_keys; roles holds role_keys.
  return { userKey: user.username, roles: user.roles, teamKeys: user.teamIds };
}

/**
 * The audience boolean, matched against the principal's arrays passed as BOUND params (no join to
 * identity tables — that coupling is what the seam avoids). Pushes teamKeys, roles, userKey onto
 * `params` and returns a fragment referencing `n.audience_scope` / `n.audience_id`; the caller
 * aliases the notifications table as `n`. Empty arrays → `= ANY('{}')` matches nothing (fails
 * closed), leaving global + own user-scoped.
 */
export function audienceWhere(p: Principal, params: unknown[]): string {
  params.push(p.teamKeys, p.roles, p.userKey);
  const t = params.length - 2;
  const r = params.length - 1;
  const u = params.length;
  return `(n.audience_scope = 'global'
        OR (n.audience_scope = 'team' AND n.audience_id = ANY($${t}::text[]))
        OR (n.audience_scope = 'role' AND n.audience_id = ANY($${r}::text[]))
        OR (n.audience_scope = 'user' AND n.audience_id = $${u}::text))`;
}
