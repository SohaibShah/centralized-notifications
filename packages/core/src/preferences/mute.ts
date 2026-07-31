import type { MuteRule } from "@notifications/shared";

/**
 * The snooze/mute read filter, in two lockstep forms — the exact twin pattern of `audienceWhere` /
 * `matchAudience`. A rule is ACTIVE when `muted_until IS NULL` (muted indefinitely) OR it is a future
 * timestamp (snoozed, not yet expired). A snoozable notification is hidden from a user when an active
 * rule of theirs matches its module or category. Two things ALWAYS pass regardless of any rule:
 * non-snoozable notifications, and **critical-priority** ones (a publisher may mark a critical as
 * snoozable, but "Critical notifications always come through" is the promise the settings UI makes and
 * the safer behaviour — a user must not miss an urgent item because they muted a noisy module).
 * Keeping the SQL and the in-memory check identical is what makes "what your feed shows" == "what the
 * live stream delivers".
 */

/**
 * SQL predicate for the read path (feed / counts / AI grounding). Pushes `userKey` onto `params` and
 * returns a fragment referencing the notifications table aliased as `n`. Uses the DB clock (`now()`)
 * for the active check, so no time parameter is needed. No join to identity tables.
 */
export function muteWhere(userKey: string, params: unknown[]): string {
  params.push(userKey);
  const u = params.length;
  return `( n.snoozable = false
         OR n.priority = 'critical'
         OR NOT EXISTS (
              SELECT 1 FROM user_mute_rules mr
               WHERE mr.user_key = $${u}::text
                 AND (mr.muted_until IS NULL OR mr.muted_until > now())
                 AND ( (mr.target_kind = 'module'   AND mr.target = n.module)
                    OR (mr.target_kind = 'category' AND mr.target = n.category) ) ) )`;
}

/** In-memory twin used by the delivery hub / SSE, where the DB is not on the hot path. */
export function isSuppressed(
  rules: MuteRule[],
  n: { snoozable: boolean; priority: string; module: string; category?: string | null },
  now: Date,
): boolean {
  if (!n.snoozable || n.priority === "critical") return false;
  return rules.some((r) => {
    const active = r.mutedUntil === null || new Date(r.mutedUntil) > now;
    if (!active) return false;
    if (r.targetKind === "module") return r.target === n.module;
    return n.category != null && r.target === n.category;
  });
}
