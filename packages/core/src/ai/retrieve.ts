import type { NotificationAction, NotificationPriority } from "@notifications/shared";
import { actionSchema, NOTIFICATION_PRIORITIES } from "@notifications/shared";
import type { QueryFn } from "../db";
import type { Principal } from "../types";
import { audienceWhere } from "../audience/match";

export interface ChatContextItem {
  id: string;
  title: string;
  description: string; // ≤280
  priority: NotificationPriority;
  module: string;
  category?: string;
  ageMinutes: number;
  read: boolean;
  hasActions: boolean;
  actions: NotificationAction[]; // the notification's real actions (validated at intake); may be []
}

/** True distribution of the caller's whole audience-scoped set, so the model can answer questions
 *  about totals/priority mix even when the item list is a capped sample. */
export interface ChatContextStats {
  total: number;
  unread: number;
  byPriority: Record<NotificationPriority, number>;
}

export interface ChatContext {
  items: ChatContextItem[];
  stats: ChatContextStats;
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
  read: boolean;
}

// Three complementary arms, merged in this order and deduped. FTS answers "about X"; urgency ensures
// the most severe items are present ("what's most urgent"); recency ensures a representative recent
// sample of ANY priority is present ("what's new") — without it, a large block of criticals would
// crowd out every normal-priority item and the model would think everything is critical.
const FTS_LIMIT = 12;
const URGENCY_LIMIT = 6;
const RECENCY_LIMIT = 8;
const TOTAL_CAP = 20;

function toItem(r: Row, nowMs: number): ChatContextItem {
  // r.actions is opaque jsonb. Although intake validates actions against actionSchema, this is the
  // TRUSTED channel the chat surfaces as clickable buttons — re-validate per element here so a legacy
  // or out-of-band row can't forward a malformed/unsafe action (e.g. a non-http(s) url) to the client.
  const actions: NotificationAction[] = [];
  for (const a of Array.isArray(r.actions) ? r.actions : []) {
    const parsed = actionSchema.safeParse(a);
    if (parsed.success) actions.push(parsed.data);
  }
  return {
    id: r.id,
    title: r.title,
    description: r.description.slice(0, 280),
    priority: r.priority,
    module: r.module,
    ...(r.category != null ? { category: r.category } : {}),
    ageMinutes: Math.max(0, Math.floor((nowMs - r.created_at.getTime()) / 60000)),
    read: r.read,
    hasActions: actions.length > 0,
    actions,
  };
}

const COLS = `n.id, n.title, n.description, n.priority, n.module, n.category, n.actions, n.created_at,
              (r.user_key IS NOT NULL) AS read`;
const JOIN = `LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_key = $1`;

/** The caller's whole-set distribution (read + unread, non-suppressed, audience-scoped). */
async function retrieveStats(query: QueryFn, principal: Principal): Promise<ChatContextStats> {
  const params: unknown[] = [principal.userKey];
  const audience = audienceWhere(principal, params);
  const { rows } = await query<{ priority: NotificationPriority; total: number; unread: number }>(
    `SELECT n.priority,
            count(*)::int AS total,
            count(*) FILTER (WHERE r.user_key IS NULL)::int AS unread
       FROM notifications n ${JOIN}
      WHERE n.suppressed = false AND ${audience}
      GROUP BY n.priority`,
    params,
  );
  const byPriority = Object.fromEntries(NOTIFICATION_PRIORITIES.map((p) => [p, 0])) as Record<
    NotificationPriority,
    number
  >;
  let total = 0;
  let unread = 0;
  for (const r of rows) {
    byPriority[r.priority] = r.total;
    total += r.total;
    unread += r.unread;
  }
  return { total, unread, byPriority };
}

/**
 * Grounding for a chat answer: the caller's audience-scoped notifications (read AND unread), as a
 * capped sample built from three arms — full-text matches on the question, the most urgent items, and
 * the most recent items — plus the true whole-set distribution. No identity-table join; audience is a
 * bound-param predicate. `websearch_to_tsquery` turns the natural-language question into a tsquery
 * safely (parameterized).
 */
export async function retrieveForAnswer(
  query: QueryFn,
  principal: Principal,
  question: string,
): Promise<ChatContext> {
  const nowMs = Date.now();

  // 1) Full-text matches, ranked.
  const ftsParams: unknown[] = [principal.userKey, question];
  const ftsAudience = audienceWhere(principal, ftsParams);
  const fts = await query<Row>(
    `SELECT ${COLS}
       FROM notifications n ${JOIN}
      WHERE n.suppressed = false AND ${ftsAudience}
        AND n.search @@ websearch_to_tsquery('english', $2)
      ORDER BY ts_rank(n.search, websearch_to_tsquery('english', $2)) DESC, n.created_at DESC
      LIMIT ${FTS_LIMIT}`,
    ftsParams,
  );

  // 2) Most urgent (so "what's most urgent?" always surfaces the top-priority items).
  const urgParams: unknown[] = [principal.userKey];
  const urgAudience = audienceWhere(principal, urgParams);
  const urgent = await query<Row>(
    `SELECT ${COLS}
       FROM notifications n ${JOIN}
      WHERE n.suppressed = false AND ${urgAudience}
      ORDER BY n.priority_rank ASC, n.created_at DESC
      LIMIT ${URGENCY_LIMIT}`,
    urgParams,
  );

  // 3) Most recent, ANY priority (so normal/low items aren't crowded out by a block of criticals).
  const recParams: unknown[] = [principal.userKey];
  const recAudience = audienceWhere(principal, recParams);
  const recent = await query<Row>(
    `SELECT ${COLS}
       FROM notifications n ${JOIN}
      WHERE n.suppressed = false AND ${recAudience}
      ORDER BY n.created_at DESC
      LIMIT ${RECENCY_LIMIT}`,
    recParams,
  );

  // Merge FTS (most relevant) → urgency → recency, deduped by id, capped.
  const seen = new Set<string>();
  const items: ChatContextItem[] = [];
  for (const r of [...fts.rows, ...urgent.rows, ...recent.rows]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    items.push(toItem(r, nowMs));
    if (items.length >= TOTAL_CAP) break;
  }

  const stats = await retrieveStats(query, principal);
  return { items, stats };
}
