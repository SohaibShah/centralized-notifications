import { z } from "zod";
import { FEED_SORTS } from "@notifications/shared";
import type {
  FeedSort,
  GroupedEntry,
  GroupedPage,
  NotificationPriority,
} from "@notifications/shared";
import type { QueryFn } from "../db";
import type { Principal } from "../types";
import { audienceWhere } from "../audience/match";
import { muteWhere } from "../preferences/mute";
import { parseActions } from "./feed";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

interface GCursor {
  g: true;
  s: FeedSort; // the sort this cursor was issued for — a cursor is only valid under its own sort
  ts: string; // representative created_at (ISO)
  id: string; // representative id (tie-break)
  rank?: number; // representative group's top_rank — carried only for the priority sorts
}
const gCursorSchema = z
  .object({
    g: z.literal(true),
    s: z.enum(FEED_SORTS),
    ts: z.string().datetime({ offset: true }),
    id: z.string().min(1),
    rank: z.number().int().min(0).max(3).optional(),
  })
  .refine((c) => (c.s === "priority-high" || c.s === "priority-low") === (c.rank !== undefined), {
    message: "rank is required for and only valid on the priority sorts",
  });
const enc = (c: GCursor) => Buffer.from(JSON.stringify(c)).toString("base64url");
function dec(raw: string): GCursor | null {
  try {
    const p = gCursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

interface GroupedRow {
  id: string;
  module: string;
  title: string;
  description: string;
  priority: NotificationPriority;
  snoozable: boolean;
  category: string | null;
  audience_scope: string;
  audience_id: string | null;
  actions: unknown[] | null;
  metadata: Record<string, unknown> | null;
  source_ts: Date | null;
  created_iso: string;
  read: boolean;
  group_key: string | null;
  group_label: string | null;
  group_total: number;
  top_priority: NotificationPriority;
  top_rank: number;
}

export interface GroupedArgs {
  principal: Principal;
  cursor?: string;
  limit?: number;
  sort?: FeedSort;
}
export type GroupedResult =
  { ok: true; page: GroupedPage } | { ok: false; error: "invalid cursor" };

function toEntry(row: GroupedRow): GroupedEntry {
  return {
    id: row.id,
    module: row.module,
    title: row.title,
    description: row.description,
    priority: row.priority,
    snoozable: row.snoozable,
    ...(row.category != null ? { category: row.category } : {}),
    audience:
      row.audience_scope === "global"
        ? { scope: "global" }
        : {
            scope: row.audience_scope as "team" | "role" | "user",
            id: row.audience_id ?? undefined,
          },
    ...(row.actions != null ? { actions: parseActions(row.actions) } : {}),
    ...(row.metadata != null ? { metadata: row.metadata } : {}),
    ...(row.source_ts != null ? { timestamp: row.source_ts.toISOString() } : {}),
    createdAt: row.created_iso,
    read: row.read,
    ...(row.group_key != null ? { groupKey: row.group_key } : {}),
    ...(row.group_label != null ? { groupLabel: row.group_label } : {}),
    groupTotal: row.group_total,
    topPriority: row.top_priority,
  };
}

/**
 * One collapsed entry per (group, read-state) — a subject with both read and unread members yields
 * two entries (an unread stack → Needs action, a read stack → Earlier), each with its own most-recent
 * member as representative and its own `group_total` / `top_priority` window aggregates. Standalone
 * rows (group_key IS NULL) are their own entries (partitioned by id). Keyset-paginated by the
 * representative (created_at, id); NFR-2 (no OFFSET, no total). Audience-scoped + mute-filtered,
 * mirroring the flat feed.
 */
function nextGCursor(sort: FeedSort, row: GroupedRow): GCursor {
  const base: GCursor = { g: true, s: sort, ts: row.created_iso, id: row.id };
  return sort === "priority-high" || sort === "priority-low"
    ? { ...base, rank: row.top_rank }
    : base;
}

export async function listGrouped(query: QueryFn, args: GroupedArgs): Promise<GroupedResult> {
  const sort: FeedSort = args.sort ?? "newest";
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  let cursor: GCursor | null = null;
  if (args.cursor !== undefined) {
    cursor = dec(args.cursor);
    // A cursor is only valid under the sort it was issued for — the sort fixes the keyset predicate,
    // so replaying it under another sort would page from the wrong position.
    if (!cursor || cursor.s !== sort) return { ok: false, error: "invalid cursor" };
  }

  const params: unknown[] = [args.principal.userKey];
  const audience = audienceWhere(args.principal, params);
  const mute = muteWhere(args.principal.userKey, params);

  // The representative (rn = 1) is always the group's most-recent member; `sort` only reorders the
  // representatives (and scopes the keyset), mirroring the flat feed.
  let keyset = "";
  let orderBy: string;
  if (sort === "newest" || sort === "oldest") {
    const [dir, cmp] = sort === "newest" ? ["DESC", "<"] : ["ASC", ">"];
    orderBy = `created_at ${dir}, id ${dir}`;
    if (cursor) {
      params.push(cursor.ts, cursor.id);
      keyset = `AND (created_at, id) ${cmp} ($${params.length - 1}::timestamptz, $${params.length}::text)`;
    }
  } else {
    const rankDir = sort === "priority-high" ? "ASC" : "DESC";
    const rankCmp = sort === "priority-high" ? ">" : "<";
    orderBy = `top_rank ${rankDir}, created_at DESC, id DESC`;
    if (cursor && cursor.rank !== undefined) {
      params.push(cursor.rank, cursor.ts, cursor.id);
      const r = params.length - 2;
      const t = params.length - 1;
      const i = params.length;
      keyset =
        `AND (top_rank ${rankCmp} $${r}::smallint` +
        ` OR (top_rank = $${r}::smallint AND (created_at, id) < ($${t}::timestamptz, $${i}::text)))`;
    }
  }
  params.push(limit + 1);
  const limitP = `$${params.length}`;

  const { rows } = await query<GroupedRow>(
    `WITH scoped AS (
       SELECT n.*, (r.user_key IS NOT NULL) AS read, COALESCE(n.group_key, n.id) AS entry_key
         FROM notifications n
         LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_key = $1
        WHERE n.suppressed = false AND ${audience} AND ${mute}
     ),
     ranked AS (
       SELECT *,
         row_number() OVER (PARTITION BY entry_key, read ORDER BY created_at DESC, id DESC) AS rn,
         count(*)              OVER (PARTITION BY entry_key, read) AS group_total,
         min(priority_rank)    OVER (PARTITION BY entry_key, read) AS top_rank,
         first_value(priority) OVER (PARTITION BY entry_key, read ORDER BY priority_rank ASC
                                     ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS top_priority
         FROM scoped
     )
     SELECT id, module, title, description, priority, snoozable, category,
            audience_scope, audience_id, actions, metadata, source_ts,
            group_key, group_label, group_total::int AS group_total,
            top_priority, top_rank::int AS top_rank,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USZ') AS created_iso,
            read
       FROM ranked
      WHERE rn = 1 ${keyset}
      ORDER BY ${orderBy}
      LIMIT ${limitP}`,
    params,
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  return {
    ok: true,
    page: {
      entries: pageRows.map(toEntry),
      nextCursor: hasMore && last ? enc(nextGCursor(sort, last)) : null,
    },
  };
}
