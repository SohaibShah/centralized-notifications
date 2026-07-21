-- Supports the GET /notifications/counts aggregate: an anti-join to notification_reads over all
-- non-suppressed rows, grouped by priority. A partial index on (priority) WHERE suppressed = false
-- lets Postgres group via an index-only scan of just the live rows instead of a full heap scan as
-- the table grows (the anti-join already rides notification_reads' (user_id, notification_id) PK).
CREATE INDEX notifications_counts_idx
  ON notifications (priority)
  WHERE suppressed = false;
