import type { NotificationCounts, NotificationPriority } from "@notifications/shared";
import { NOTIFICATION_PRIORITIES } from "@notifications/shared";
import type { QueryFn } from "../db";
import type { Principal } from "../types";
import { audienceWhere } from "../audience/match";

/**
 * Unread counts for a principal over the WHOLE visible dataset (not a page), so the bell badge /
 * chip counts are accurate rather than reflecting only the loaded window. Mirrors the feed read
 * path's join + suppressed filter AND the same `audienceWhere` gate, so the count equals exactly the
 * principal's visible unread set. `unread` is the sum of the per-priority buckets.
 */
export async function counts(
  query: QueryFn,
  args: { principal: Principal },
): Promise<NotificationCounts> {
  const params: unknown[] = [args.principal.userKey];
  const audience = audienceWhere(args.principal, params);
  const { rows } = await query<{ priority: NotificationPriority; n: number }>(
    `SELECT n.priority, count(*)::int AS n
       FROM notifications n
       LEFT JOIN notification_reads r
         ON r.notification_id = n.id AND r.user_key = $1
      WHERE n.suppressed = false AND r.user_key IS NULL AND ${audience}
      GROUP BY n.priority`,
    params,
  );

  const unreadByPriority = Object.fromEntries(NOTIFICATION_PRIORITIES.map((p) => [p, 0])) as Record<
    NotificationPriority,
    number
  >;
  for (const row of rows) unreadByPriority[row.priority] = row.n;
  const unread = NOTIFICATION_PRIORITIES.reduce((sum, p) => sum + unreadByPriority[p], 0);

  return { unread, unreadByPriority };
}
