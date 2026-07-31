import type { DueUser } from "@notifications/core";
import { query } from "../db/pool";

/** A scheduling candidate: the library's DueUser plus the host user id (to rebuild a Principal) and
 *  the user's personal summary opt-out (the scheduler skips opted-out users). */
export type ScheduleRow = DueUser & { id: string; summaryOptOut: boolean };

/** One row per user: their tz, when their summary was last generated (null if never), and their
 *  opt-out flag. userKey = username, matching the principal adapter. Reads user_summaries +
 *  user_preferences (core's tables) by user_key. */
export async function listSummaryScheduleRows(): Promise<ScheduleRow[]> {
  const { rows } = await query<{
    id: string;
    username: string;
    timezone: string;
    generated_at: Date | null;
    summary_opt_out: boolean | null;
  }>(
    `SELECT u.id, u.username, u.timezone, s.generated_at, p.summary_opt_out
       FROM users u
       LEFT JOIN user_summaries s ON s.user_key = u.username
       LEFT JOIN user_preferences p ON p.user_key = u.username`,
  );
  return rows.map((r) => ({
    id: r.id,
    userKey: r.username,
    timezone: r.timezone,
    lastGeneratedAt: r.generated_at ? new Date(r.generated_at).toISOString() : null,
    summaryOptOut: r.summary_opt_out ?? false, // no prefs row = default (not opted out)
  }));
}
