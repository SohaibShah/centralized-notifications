import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { FeedNotification, NotificationPage } from "@notifications/shared";
import { requireUser } from "../../auth/guards";
import { query } from "../../db/pool";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// Query params arrive as strings; `coerce` turns `?limit=50` into a number, and the
// bounds keep a client from asking for an unboundedly large page.
const listQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

// The route param is the notification id (the contract id, text PK up to 200 chars).
const readParamsSchema = z.object({ id: z.string().min(1).max(200) });

// Bulk mark-read: cap the batch so one request can't ask to write an unbounded set.
const bulkReadSchema = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(500),
});

/**
 * Opaque keyset cursor: the (created_at, id) of the last row of the previous page,
 * base64url-encoded JSON. Opaque on purpose so a client can't turn it into an
 * OFFSET-style deep scan (NFR-2) — the only valid cursor is one we handed out.
 */
interface Cursor {
  ts: string; // ISO created_at
  id: string;
}

const cursorSchema = z.object({
  ts: z.string().datetime({ offset: true }),
  id: z.string().min(1),
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

// The raw shape of a joined row. jsonb columns (`actions`, `metadata`) are already
// parsed to JS by node-pg; timestamptz columns come back as Date; the `read`
// expression comes back as a JS boolean.
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
  // Full-precision UTC ISO string formatted in SQL (see the SELECT). node-pg parses
  // timestamptz into a JS Date at *millisecond* precision, but the column stores
  // microseconds — round-tripping the keyset cursor through a Date would truncate it
  // and silently skip same-millisecond rows at page boundaries. So we never build a
  // Date for the ordering column; we carry the exact string.
  created_iso: string;
  read: boolean;
}

/** Reconstruct the split DB columns back into the shared `FeedNotification` shape. */
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
    ...(row.actions != null ? { actions: row.actions } : {}),
    ...(row.metadata != null ? { metadata: row.metadata } : {}),
    ...(row.source_ts != null ? { timestamp: row.source_ts.toISOString() } : {}),
    createdAt: row.created_iso,
    read: row.read,
  };
}

/**
 * Feed read path (FR-5/FR-6): `GET /notifications?cursor=&limit=`. Returns a keyset
 * page newest-first with each row carrying this user's `read` flag (LEFT JOIN on
 * notification_reads). Keyset — ordered on (created_at desc, id desc) with a row-value
 * comparison against the cursor — so deep pages cost the same as the first (NFR-2);
 * there is no OFFSET and no total count.
 *
 * Week-1 limitation: every notification is returned to every authenticated user (no
 * audience resolution yet — that is Week 4). SQL is parameterized throughout; the only
 * interpolated fragments are constant `$N` placeholder strings, never user input.
 */
export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/notifications", { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });

    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid query parameters" });
    const { cursor: rawCursor, limit } = parsed.data;

    let cursor: Cursor | null = null;
    if (rawCursor !== undefined) {
      cursor = decodeCursor(rawCursor);
      if (!cursor) return reply.code(400).send({ error: "invalid cursor" });
    }

    // $1 is always the user id (for the read LEFT JOIN). A cursor adds $2/$3; the
    // limit is always the final positional parameter. Fetch one extra row to learn
    // whether an older page exists without a second COUNT query.
    const params: unknown[] = [user.id];
    // Notifications from an admin-disabled module are recorded but never shown.
    let where = "WHERE n.suppressed = false";
    if (cursor) {
      params.push(cursor.ts, cursor.id);
      where += " AND (n.created_at, n.id) < ($2::timestamptz, $3::text)";
    }
    params.push(limit + 1);
    const limitPlaceholder = `$${params.length}`;

    const { rows } = await query<FeedRow>(
      `SELECT n.id, n.module, n.title, n.description, n.priority, n.snoozable,
              n.category, n.audience_scope, n.audience_id, n.actions, n.metadata,
              n.source_ts,
              to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USZ') AS created_iso,
              (r.user_id IS NOT NULL) AS read
         FROM notifications n
         LEFT JOIN notification_reads r
           ON r.notification_id = n.id AND r.user_id = $1
         ${where}
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT ${limitPlaceholder}`,
      params,
    );

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const body: NotificationPage = {
      // The cursor carries the exact microsecond string from SQL, so the next page's
      // `(created_at, id) < ($ts, $id)` comparison is lossless — no boundary skips.
      items: pageRows.map(toFeedNotification),
      nextCursor: hasMore && last ? encodeCursor({ ts: last.created_iso, id: last.id }) : null,
    };
    return reply.code(200).send(body);
  });

  /**
   * Mark a notification read for the current user (FR-6): `POST /notifications/:id/read`.
   * Idempotent — a repeat is a no-op (ON CONFLICT DO NOTHING), so a double-click or an
   * at-least-once retry can't error. Read state is per-user, so this only ever affects
   * the caller's own row. 404 if the notification doesn't exist (so a client can't seed
   * read rows for arbitrary ids). Returns 204 (no body).
   */
  app.post("/notifications/:id/read", { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });

    const parsed = readParamsSchema.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid notification id" });
    const { id } = parsed.data;

    const exists = await query("SELECT 1 FROM notifications WHERE id = $1", [id]);
    if (exists.rowCount === 0) return reply.code(404).send({ error: "notification not found" });

    await query(
      `INSERT INTO notification_reads (user_id, notification_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, notification_id) DO NOTHING`,
      [user.id, id],
    );
    return reply.code(204).send();
  });

  /**
   * Bulk mark-read for the current user (mark-all-read in the panel): `POST
   * /notifications/read` with `{ ids: string[] }`. One row per id that actually
   * exists (the `= ANY` filter drops unknown ids silently, same effect as the
   * single-id 404 guard but batched). Per-user and idempotent (ON CONFLICT DO
   * NOTHING). Returns 204.
   */
  app.post("/notifications/read", { preHandler: requireUser }, async (req, reply) => {
    const user = req.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });

    const parsed = bulkReadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request body" });
    const { ids } = parsed.data;

    await query(
      `INSERT INTO notification_reads (user_id, notification_id)
         SELECT $1, n.id FROM notifications n WHERE n.id = ANY($2::text[])
         ON CONFLICT (user_id, notification_id) DO NOTHING`,
      [user.id, ids],
    );
    return reply.code(204).send();
  });
}
