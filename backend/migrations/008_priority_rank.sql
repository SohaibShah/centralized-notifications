-- Server-side priority sorting. A generated rank column keeps the sort keyset-fast and lets the
-- ORDER BY / cursor WHERE reference one column instead of repeating a CASE. STORED so it's
-- indexable; immutable CASE over the same row's `priority`.
ALTER TABLE notifications
  ADD COLUMN priority_rank smallint
  GENERATED ALWAYS AS (
    CASE priority
      WHEN 'critical' THEN 0
      WHEN 'high'     THEN 1
      WHEN 'normal'   THEN 2
      WHEN 'low'      THEN 3
    END
  ) STORED;

CREATE INDEX notifications_priority_keyset_idx
  ON notifications (priority_rank, created_at DESC, id DESC)
  WHERE suppressed = false;
