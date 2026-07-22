import type { QueryFn } from "../db";
import type { Principal } from "../types";
import { audienceWhere } from "../audience/match";

export type MarkReadResult = { ok: true } | { ok: false; error: "not found" };

/**
 * Mark a notification read for a principal. Idempotent (ON CONFLICT DO NOTHING). Audience-scoped
 * existence check first: a notification outside the caller's audience returns "not found" exactly
 * like a nonexistent one — no existence oracle, and no marking-read an invisible item. Read state is
 * per-user (keyed on user_key), so this only ever affects the caller's own row.
 */
export async function markRead(
  query: QueryFn,
  args: { principal: Principal; id: string },
): Promise<MarkReadResult> {
  const params: unknown[] = [args.id];
  const audience = audienceWhere(args.principal, params);
  const exists = await query(
    `SELECT 1 FROM notifications n WHERE n.id = $1 AND ${audience}`,
    params,
  );
  if (exists.rowCount === 0) return { ok: false, error: "not found" };

  await query(
    `INSERT INTO notification_reads (user_key, notification_id)
     VALUES ($1, $2)
     ON CONFLICT (user_key, notification_id) DO NOTHING`,
    [args.principal.userKey, args.id],
  );
  return { ok: true };
}

/** Undo a read for a principal. Idempotent; per-user; never touches another user's state. */
export async function markUnread(
  query: QueryFn,
  args: { principal: Principal; id: string },
): Promise<void> {
  await query("DELETE FROM notification_reads WHERE user_key = $1 AND notification_id = $2", [
    args.principal.userKey,
    args.id,
  ]);
}

/**
 * Bulk mark-read (mark-all-read). One row per id the caller can actually see — the audience gate
 * drops out-of-audience/unknown ids silently (same effect as the single-id 404 guard, batched).
 * Per-user and idempotent.
 */
export async function markReadBulk(
  query: QueryFn,
  args: { principal: Principal; ids: string[] },
): Promise<void> {
  const params: unknown[] = [args.principal.userKey, args.ids];
  const audience = audienceWhere(args.principal, params);
  await query(
    `INSERT INTO notification_reads (user_key, notification_id)
       SELECT $1, n.id FROM notifications n WHERE n.id = ANY($2::text[]) AND ${audience}
       ON CONFLICT (user_key, notification_id) DO NOTHING`,
    params,
  );
}
