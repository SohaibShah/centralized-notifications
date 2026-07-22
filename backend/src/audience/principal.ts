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
 *
 * Must stay in lockstep with `resolveRecipients` (live delivery): both encode the same membership
 * rule (user-scope keys on username), so read-visibility and SSE delivery agree.
 *
 * Perf caveat: this OR-predicate can't be served by the same index as the feed's keyset ORDER BY,
 * so for a user whose visible set is sparse relative to a large table the planner filters more rows
 * per page — NFR-2's "deep pages cost the same as the first" becomes conditional on audience density.
 * Fine at current scale; revisit with a visibility-aligned index if the table grows large.
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
