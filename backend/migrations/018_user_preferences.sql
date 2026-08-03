-- Scalar per-user notification preferences (latest only). Keyed by user_key (text), identity-free
-- like user_summaries/notification_reads. Defaults = the "no row yet" behaviour the store returns:
-- grouping on, not opted out of the summary, critical-only toast.
CREATE TABLE user_preferences (
  user_key            text PRIMARY KEY,
  grouping_enabled    boolean NOT NULL DEFAULT true,
  summary_opt_out     boolean NOT NULL DEFAULT false,
  toast_min_priority  text    NOT NULL DEFAULT 'critical'
);
