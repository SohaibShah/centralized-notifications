-- Per-user persisted AI summary (latest only). Keyed by user_key (text), identity-free like
-- notification_reads/action_dispatches. based_on = notifications summarized (0 = caught-up marker).
CREATE TABLE user_summaries (
  user_key     text PRIMARY KEY,
  summary      text NOT NULL,
  based_on     integer NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);
