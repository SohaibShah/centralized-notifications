import type { Audience } from "@notifications/shared";
import type { Principal } from "../types";

/**
 * In-memory audience check — the exact twin of the SQL `audienceWhere`, used by the delivery hub
 * to decide whether a connected subscriber should receive a published notification. Keeping the two
 * in lockstep is what makes "what you receive live" == "what your feed shows".
 */
export function matchAudience(p: Principal, a: Audience): boolean {
  switch (a.scope) {
    case "global":
      return true;
    case "team":
      return a.id !== undefined && p.teamKeys.includes(a.id);
    case "role":
      return a.id !== undefined && p.roles.includes(a.id);
    case "user":
      return a.id !== undefined && a.id === p.userKey;
  }
}

/**
 * SQL audience predicate — moved from the backend. Pushes teamKeys, roles, userKey onto `params`
 * and returns a fragment referencing `n.audience_scope` / `n.audience_id`; the caller aliases the
 * notifications table as `n`. Empty arrays → `= ANY('{}')` matches nothing (fails closed), leaving
 * global + own user-scoped. No join to identity tables — that coupling is what the seam avoids.
 *
 * Must stay in lockstep with `matchAudience`: both encode the same membership rule.
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
