import type { NotificationPriority } from "@notifications/shared";
import { NOTIFICATION_PRIORITIES } from "@notifications/shared";
import type { QueryFn } from "../db";
import type { Principal } from "../types";
import { audienceWhere } from "../audience/match";

export interface TargetCounts {
  byPriority: Record<NotificationPriority, number>;
  total: number;
}
export interface MuteTargetCountsResult {
  /** module id → counts */
  modules: Record<string, TargetCounts>;
  /** category name → counts */
  categories: Record<string, TargetCounts>;
}

function emptyByPriority(): Record<NotificationPriority, number> {
  return Object.fromEntries(NOTIFICATION_PRIORITIES.map((p) => [p, 0])) as Record<
    NotificationPriority,
    number
  >;
}

function accumulate(
  into: Record<string, TargetCounts>,
  key: string,
  priority: NotificationPriority,
  n: number,
): void {
  const entry = (into[key] ??= { byPriority: emptyByPriority(), total: 0 });
  entry.byPriority[priority] = n;
  entry.total += n;
}

/**
 * The caller's own priority mix per module and per category, over their audience-scoped, non-suppressed
 * notifications. **Not** mute-filtered — so a module/category the user has muted still reports its
 * counts (which is what keeps it visible on the settings page so they can un-mute it). Identity-free
 * (audience is a bound-param predicate; no join to a users table).
 */
export async function muteTargetCounts(
  query: QueryFn,
  principal: Principal,
): Promise<MuteTargetCountsResult> {
  const modules: Record<string, TargetCounts> = {};
  const categories: Record<string, TargetCounts> = {};

  const moduleParams: unknown[] = [];
  const moduleAudience = audienceWhere(principal, moduleParams);
  const moduleRows = await query<{ module: string; priority: NotificationPriority; n: number }>(
    `SELECT n.module, n.priority, count(*)::int AS n
       FROM notifications n
      WHERE n.suppressed = false AND ${moduleAudience}
      GROUP BY n.module, n.priority`,
    moduleParams,
  );
  for (const r of moduleRows.rows) accumulate(modules, r.module, r.priority, r.n);

  const categoryParams: unknown[] = [];
  const categoryAudience = audienceWhere(principal, categoryParams);
  const categoryRows = await query<{ category: string; priority: NotificationPriority; n: number }>(
    `SELECT n.category, n.priority, count(*)::int AS n
       FROM notifications n
      WHERE n.suppressed = false AND n.category IS NOT NULL AND ${categoryAudience}
      GROUP BY n.category, n.priority`,
    categoryParams,
  );
  for (const r of categoryRows.rows) accumulate(categories, r.category, r.priority, r.n);

  return { modules, categories };
}
