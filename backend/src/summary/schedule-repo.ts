import type { DueUser } from "@notifications/core";
import { query } from "../db/pool";

/** A scheduling candidate: the library's DueUser plus the host user id (to rebuild a Principal). */
export type ScheduleRow = DueUser & { id: string };

/** One row per user: their tz + when their summary was last generated (null if never). userKey =
 *  username, matching the principal adapter. Reads user_summaries (core's table) by user_key. */
export async function listSummaryScheduleRows(): Promise<ScheduleRow[]> {
  const { rows } = await query<{
    id: string;
    username: string;
    timezone: string;
    generated_at: Date | null;
  }>(
    `SELECT u.id, u.username, u.timezone, s.generated_at
       FROM users u
       LEFT JOIN user_summaries s ON s.user_key = u.username`,
  );
  return rows.map((r) => ({
    id: r.id,
    userKey: r.username,
    timezone: r.timezone,
    lastGeneratedAt: r.generated_at ? new Date(r.generated_at).toISOString() : null,
  }));
}
