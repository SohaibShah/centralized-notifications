import { z } from "zod";
import type { FeedNotification, FeedSort, NotificationPage } from "@notifications/shared";
import { actionSchema, FEED_SORTS } from "@notifications/shared";
import type { QueryFn } from "../db";
import type { Principal } from "../types";
import { audienceWhere } from "../audience/match";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Opaque keyset cursor: the (created_at, id) of the last row of the previous page, base64url-encoded
 * JSON. Opaque so a client can't turn it into an OFFSET-style deep scan (NFR-2).
 */
interface Cursor {
  s: FeedSort; // the sort this cursor was issued for — a cursor is only valid under its own sort
  ts: string; // ISO created_at
  id: string;
  rank?: number; // priority_rank, only carried for the priority sorts
}

const cursorSchema = z
  .object({
    s: z.enum(FEED_SORTS),
    ts: z.string().datetime({ offset: true }),
    id: z.string().min(1),
    rank: z.number().int().min(0).max(3).optional(),
  })
  .refine((c) => (c.s === "priority-high" || c.s === "priority-low") === (c.rank !== undefined), {
    message: "rank is required for and only valid on the priority sorts",
  });

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const json: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const parsed = cursorSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

interface FeedRow {
  id: string;
  module: string;
  title: string;
  description: string;
  priority: FeedNotification["priority"];
  snoozable: boolean;
  category: string | null;
  audience_scope: FeedNotification["audience"]["scope"];
  audience_id: string | null;
  actions: FeedNotification["actions"] | null;
  metadata: Record<string, unknown> | null;
  source_ts: Date | null;
  // Full-precision UTC ISO string formatted in SQL — never round-tripped through a JS Date (which
  // truncates the column's microseconds to ms and would skip same-ms rows at page boundaries).
  created_iso: string;
  priority_rank: number;
  read: boolean;
}

function cursorFor(s: FeedSort, row: FeedRow): Cursor {
  const base: Cursor = { s, ts: row.created_iso, id: row.id };
  return s === "priority-high" || s === "priority-low"
    ? { ...base, rank: row.priority_rank }
    : base;
}

function toFeedNotification(row: FeedRow): FeedNotification {
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
        : { scope: row.audience_scope, id: row.audience_id ?? undefined },
    // Re-parse each stored action through the schema so its defaults apply (notably `kind`).
    ...(row.actions != null ? { actions: row.actions.map((a) => actionSchema.parse(a)) } : {}),
    ...(row.metadata != null ? { metadata: row.metadata } : {}),
    ...(row.source_ts != null ? { timestamp: row.source_ts.toISOString() } : {}),
    createdAt: row.created_iso,
    read: row.read,
  };
}

export interface ListArgs {
  principal: Principal;
  cursor?: string;
  limit?: number;
  sort?: FeedSort;
}

export type ListResult =
  { ok: true; page: NotificationPage } | { ok: false; error: "invalid cursor" };

/**
 * Audience-scoped keyset feed page. Ordered per `sort` (default newest); each row carries this
 * principal's `read` flag (LEFT JOIN on notification_reads keyed by `user_key`). No OFFSET, no total
 * count (NFR-2). Only notifications addressed to the principal are returned (see `audienceWhere`).
 */
export async function list(query: QueryFn, args: ListArgs): Promise<ListResult> {
  const { principal } = args;
  const sort: FeedSort = args.sort ?? "newest";
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  let cursor: Cursor | null = null;
  if (args.cursor !== undefined) {
    cursor = decodeCursor(args.cursor);
    // A cursor is only valid under the sort it was issued for (the keyset predicate is sort-specific).
    if (!cursor || cursor.s !== sort) return { ok: false, error: "invalid cursor" };
  }

  // $1 is always the user key (for the read LEFT JOIN). Cursor keyset params, then the audience
  // params, then limit (final positional). Fetch one extra row to learn if an older page exists.
  const params: unknown[] = [principal.userKey];
  let where = "WHERE n.suppressed = false";
  let orderBy: string;

  if (sort === "newest" || sort === "oldest") {
    const [dir, cmp] = sort === "newest" ? ["DESC", "<"] : ["ASC", ">"];
    orderBy = `n.created_at ${dir}, n.id ${dir}`;
    if (cursor) {
      params.push(cursor.ts, cursor.id);
      where += ` AND (n.created_at, n.id) ${cmp} ($${params.length - 1}::timestamptz, $${params.length}::text)`;
    }
  } else {
    const rankDir = sort === "priority-high" ? "ASC" : "DESC";
    const rankCmp = sort === "priority-high" ? ">" : "<";
    orderBy = `n.priority_rank ${rankDir}, n.created_at DESC, n.id DESC`;
    if (cursor) {
      params.push(cursor.rank, cursor.ts, cursor.id);
      const r = params.length - 2;
      const t = params.length - 1;
      const i = params.length;
      where +=
        ` AND (n.priority_rank ${rankCmp} $${r}::smallint` +
        ` OR (n.priority_rank = $${r}::smallint AND (n.created_at, n.id) < ($${t}::timestamptz, $${i}::text)))`;
    }
  }

  where += ` AND ${audienceWhere(principal, params)}`;

  params.push(limit + 1);
  const limitPlaceholder = `$${params.length}`;

  const { rows } = await query<FeedRow>(
    `SELECT n.id, n.module, n.title, n.description, n.priority, n.snoozable,
            n.category, n.audience_scope, n.audience_id, n.actions, n.metadata,
            n.source_ts, n.priority_rank,
            to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USZ') AS created_iso,
            (r.user_key IS NOT NULL) AS read
       FROM notifications n
       LEFT JOIN notification_reads r
         ON r.notification_id = n.id AND r.user_key = $1
       ${where}
      ORDER BY ${orderBy}
      LIMIT ${limitPlaceholder}`,
    params,
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const page: NotificationPage = {
    items: pageRows.map(toFeedNotification),
    nextCursor: hasMore && last ? encodeCursor(cursorFor(sort, last)) : null,
  };
  return { ok: true, page };
}
