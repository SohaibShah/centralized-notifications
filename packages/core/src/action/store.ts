import type { QueryFn } from "../db";

export type DispatchStatus = "pending" | "ok" | "failed";

export interface DispatchRow {
  id: string;
  status: DispatchStatus;
  resultMessage: string | null;
}

interface DispatchRowDb {
  id: string;
  status: DispatchStatus;
  result_message: string | null;
}

/**
 * Durable, idempotent record of action dispatches (in-app "Approve"/"Deny"-style buttons that call
 * back into a module). Keyed on `user_key` — matches notification_reads' post-011 keying, no FK to
 * identity — and never called directly by business logic without going through this store: it is
 * what makes a Redis Streams / client retry of the same dispatch a no-op instead of a duplicate call
 * to a module (see .claude/rules/notifications-domain.md — every dispatch carries an idempotency key
 * and the pipeline dedupes on it before sending).
 */
export function createActionStore(query: QueryFn) {
  return {
    /**
     * Insert-or-get by the idempotency tuple (user_key, notification_id, action_ref, idempotency_key).
     * `INSERT ... ON CONFLICT DO NOTHING RETURNING` inserts and returns the fresh row in one
     * round-trip; when the tuple already exists (a replay), the RETURNING clause returns nothing and
     * a follow-up SELECT fetches the existing row instead — so a replay is always answered with the
     * original row's current state (including a terminal status set by a prior `complete()`), never a
     * second dispatch.
     */
    async begin(args: {
      userKey: string;
      notificationId: string;
      actionRef: string;
      idempotencyKey: string;
    }): Promise<{ created: boolean; row: DispatchRow }> {
      const ins = await query<DispatchRowDb>(
        `INSERT INTO action_dispatches (user_key, notification_id, action_ref, idempotency_key)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_key, notification_id, action_ref, idempotency_key) DO NOTHING
         RETURNING id, status, result_message`,
        [args.userKey, args.notificationId, args.actionRef, args.idempotencyKey],
      );
      if (ins.rows[0]) return { created: true, row: toRow(ins.rows[0]) };

      const sel = await query<DispatchRowDb>(
        `SELECT id, status, result_message FROM action_dispatches
          WHERE user_key = $1 AND notification_id = $2 AND action_ref = $3 AND idempotency_key = $4`,
        [args.userKey, args.notificationId, args.actionRef, args.idempotencyKey],
      );
      // The row must exist: DO NOTHING only fires on the same UNIQUE conflict this SELECT looks up.
      return { created: false, row: toRow(sel.rows[0]!) };
    },

    /** Move a dispatch to a terminal status, recording completed_at + the (module-reported) result. */
    async complete(
      id: string,
      status: Extract<DispatchStatus, "ok" | "failed">,
      resultMessage: string | null,
    ): Promise<void> {
      await query(
        `UPDATE action_dispatches SET status = $2, result_message = $3, completed_at = now()
          WHERE id = $1`,
        [id, status, resultMessage],
      );
    },
  };
}

function toRow(r: DispatchRowDb): DispatchRow {
  return { id: r.id, status: r.status, resultMessage: r.result_message };
}
