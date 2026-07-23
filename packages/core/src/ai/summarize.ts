import type { NotificationPriority } from "@notifications/shared";
import type { QueryFn } from "../db";
import type { Principal } from "../types";
import { audienceWhere } from "../audience/match";
import { counts } from "../read/counts";

export interface SummaryItem {
  title: string;
  description: string; // truncated to 280 chars
  priority: NotificationPriority;
  module: string;
  category?: string;
  ageMinutes: number;
  hasActions: boolean;
}
export interface SummaryContext {
  items: SummaryItem[];
  totalUnread: number;
  now: string; // ISO reference time for staleness reasoning
}

interface Row {
  id: string;
  title: string;
  description: string;
  priority: NotificationPriority;
  module: string;
  category: string | null;
  actions: unknown[] | null;
  created_at: Date;
}

/** The principal's audience-scoped UNREAD set, capped, critical-first then oldest, shaped for the
 *  prompt. Also returns the ordered ids (for the cache signature). No identity-table join. */
export async function buildSummaryContext(
  query: QueryFn,
  principal: Principal,
  cap: number,
): Promise<{ context: SummaryContext; ids: string[] }> {
  const params: unknown[] = [principal.userKey];
  const audience = audienceWhere(principal, params);
  params.push(cap);
  const { rows } = await query<Row>(
    `SELECT n.id, n.title, n.description, n.priority, n.module, n.category, n.actions, n.created_at
       FROM notifications n
       LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_key = $1
      WHERE n.suppressed = false AND r.user_key IS NULL AND ${audience}
      ORDER BY n.priority_rank ASC, n.created_at ASC
      LIMIT $${params.length}`,
    params,
  );

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const items: SummaryItem[] = rows.map((r) => ({
    title: r.title,
    description: r.description.slice(0, 280),
    priority: r.priority,
    module: r.module,
    ...(r.category != null ? { category: r.category } : {}),
    ageMinutes: Math.max(0, Math.floor((nowMs - r.created_at.getTime()) / 60000)),
    hasActions: Array.isArray(r.actions) && r.actions.length > 0,
  }));
  const totalUnread = (await counts(query, { principal })).unread;
  return { context: { items, totalUnread, now }, ids: rows.map((r) => r.id) };
}
