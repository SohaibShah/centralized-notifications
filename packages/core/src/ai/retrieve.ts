import type { NotificationPriority } from "@notifications/shared";
import type { QueryFn } from "../db";
import type { Principal } from "../types";
import { audienceWhere } from "../audience/match";

export interface ChatContextItem {
  title: string;
  description: string; // ≤280
  priority: NotificationPriority;
  module: string;
  category?: string;
  ageMinutes: number;
  read: boolean;
  hasActions: boolean;
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

const FTS_LIMIT = 12;
const RECENCY_LIMIT = 8;
const TOTAL_CAP = 20;

function toItem(r: Row, nowMs: number): ChatContextItem {
  return {
    title: r.title,
    description: r.description.slice(0, 280),
    priority: r.priority,
    module: r.module,
    ...(r.category != null ? { category: r.category } : {}),
    ageMinutes: Math.max(0, Math.floor((nowMs - r.created_at.getTime()) / 60000)),
    read: r.read,
    hasActions: Array.isArray(r.actions) && r.actions.length > 0,
  };
}

const COLS = `n.id, n.title, n.description, n.priority, n.module, n.category, n.actions, n.created_at,
              (r.user_key IS NOT NULL) AS read`;
const JOIN = `LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_key = $1`;

/**
 * Grounding for a chat answer: audience-scoped full-text matches on the question (top 12) unioned
 * with the most recent high-priority notifications (top 8), read AND unread, deduped, capped at 20.
 * No identity-table join — audience is a bound-param predicate. `websearch_to_tsquery` turns the
 * natural-language question into a tsquery safely (parameterized).
 */
export async function retrieveForAnswer(
  query: QueryFn,
  principal: Principal,
  question: string,
): Promise<ChatContextItem[]> {
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

  // 2) Recent high-priority (so general questions work even without a keyword hit).
  const recParams: unknown[] = [principal.userKey];
  const recAudience = audienceWhere(principal, recParams);
  const recent = await query<Row>(
    `SELECT ${COLS}
       FROM notifications n ${JOIN}
      WHERE n.suppressed = false AND ${recAudience}
      ORDER BY n.priority_rank ASC, n.created_at DESC
      LIMIT ${RECENCY_LIMIT}`,
    recParams,
  );

  // Merge FTS first (most relevant), then recency, deduped by id, capped.
  const seen = new Set<string>();
  const merged: ChatContextItem[] = [];
  for (const r of [...fts.rows, ...recent.rows]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(toItem(r, nowMs));
    if (merged.length >= TOTAL_CAP) break;
  }
  return merged;
}
