import type { Notification } from "@notifications/shared";
import type { QueryFn } from "../db";

/**
 * Persist a validated notification, deduping on its `id` in a single atomic statement:
 * `INSERT ... ON CONFLICT (id) DO NOTHING`. The unique primary key is the dedupe mechanism, so this
 * is race-safe (no check-then-act) and idempotent — a re-delivered notification inserts once. The
 * statement commits before it returns.
 *
 * Takes the query fn (injected pool) rather than a global — core owns no connection.
 * `actions`/`metadata` are stored as opaque jsonb (stringified so pg targets jsonb, not a Postgres
 * array); `audience` is split into scope/id columns.
 */
export async function persist(
  query: QueryFn,
  n: Notification,
  suppressed: boolean,
): Promise<"accepted" | "duplicate"> {
  const result = await query<{ id: string }>(
    `INSERT INTO notifications
       (id, module, title, description, priority, snoozable, category,
        audience_scope, audience_id, actions, metadata, source_ts, suppressed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      n.id,
      n.module,
      n.title,
      n.description,
      n.priority,
      n.snoozable,
      n.category ?? null,
      n.audience.scope,
      // Normalize to the DB CHECK invariant: id is null iff global. A stray id on a global
      // notification is dropped here rather than triggering a constraint violation downstream.
      n.audience.scope === "global" ? null : (n.audience.id ?? null),
      n.actions ? JSON.stringify(n.actions) : null,
      n.metadata ? JSON.stringify(n.metadata) : null,
      n.timestamp ?? null,
      suppressed,
    ],
  );
  return result.rows.length > 0 ? "accepted" : "duplicate";
}
