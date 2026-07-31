import type { MuteRule, MuteTargetKind, UserPreferences } from "@notifications/shared";
import type { QueryFn } from "../db";

/** The column defaults, returned when a user has no `user_preferences` row yet. */
const DEFAULT_PREFERENCES: UserPreferences = {
  groupingEnabled: true,
  summaryOptOut: false,
  toastMinPriority: "critical",
};

interface PrefRow {
  grouping_enabled: boolean;
  summary_opt_out: boolean;
  toast_min_priority: UserPreferences["toastMinPriority"];
}

interface RuleRow {
  target_kind: MuteTargetKind;
  target: string;
  muted_until: Date | null;
}

const toPreferences = (r: PrefRow): UserPreferences => ({
  groupingEnabled: r.grouping_enabled,
  summaryOptOut: r.summary_opt_out,
  toastMinPriority: r.toast_min_priority,
});

/**
 * Per-user preference persistence, keyed by user_key (identity-free — no join to users). Scalar prefs
 * are a latest-only upsert (like user_summaries); mute/snooze rules are one row per (kind, target).
 * `updatePreferences` is partial: an unset field keeps its stored value (or the column default on
 * first write) via COALESCE.
 */
export function createPreferencesStore(query: QueryFn): {
  getPreferences(userKey: string): Promise<UserPreferences>;
  updatePreferences(userKey: string, patch: Partial<UserPreferences>): Promise<UserPreferences>;
  listRules(userKey: string): Promise<MuteRule[]>;
  putRule(
    userKey: string,
    kind: MuteTargetKind,
    target: string,
    until: string | null,
  ): Promise<void>;
  deleteRule(userKey: string, kind: MuteTargetKind, target: string): Promise<boolean>;
} {
  return {
    async getPreferences(userKey) {
      const { rows } = await query<PrefRow>(
        `SELECT grouping_enabled, summary_opt_out, toast_min_priority
           FROM user_preferences WHERE user_key = $1`,
        [userKey],
      );
      const r = rows[0];
      return r ? toPreferences(r) : { ...DEFAULT_PREFERENCES };
    },

    async updatePreferences(userKey, patch) {
      const grouping = patch.groupingEnabled ?? null;
      const optOut = patch.summaryOptOut ?? null;
      const toast = patch.toastMinPriority ?? null;
      const { rows } = await query<PrefRow>(
        `INSERT INTO user_preferences (user_key, grouping_enabled, summary_opt_out, toast_min_priority)
         VALUES ($1, COALESCE($2, true), COALESCE($3, false), COALESCE($4, 'critical'))
         ON CONFLICT (user_key) DO UPDATE
           SET grouping_enabled   = COALESCE($2, user_preferences.grouping_enabled),
               summary_opt_out    = COALESCE($3, user_preferences.summary_opt_out),
               toast_min_priority = COALESCE($4, user_preferences.toast_min_priority)
         RETURNING grouping_enabled, summary_opt_out, toast_min_priority`,
        [userKey, grouping, optOut, toast],
      );
      // The upsert always returns exactly one row.
      return toPreferences(rows[0]!);
    },

    async listRules(userKey) {
      const { rows } = await query<RuleRow>(
        `SELECT target_kind, target, muted_until
           FROM user_mute_rules WHERE user_key = $1
          ORDER BY target_kind, target`,
        [userKey],
      );
      return rows.map((r) => ({
        targetKind: r.target_kind,
        target: r.target,
        mutedUntil: r.muted_until ? new Date(r.muted_until).toISOString() : null,
      }));
    },

    async putRule(userKey, kind, target, until) {
      await query(
        `INSERT INTO user_mute_rules (user_key, target_kind, target, muted_until)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_key, target_kind, target) DO UPDATE
           SET muted_until = EXCLUDED.muted_until`,
        [userKey, kind, target, until],
      );
    },

    async deleteRule(userKey, kind, target) {
      const { rowCount } = await query(
        `DELETE FROM user_mute_rules WHERE user_key = $1 AND target_kind = $2 AND target = $3`,
        [userKey, kind, target],
      );
      return (rowCount ?? 0) > 0;
    },
  };
}
