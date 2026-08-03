-- Derived grouping key + display label, computed by the GroupingStrategy at ingest.
-- NULL group_key = a standalone notification (renders as a normal card).
ALTER TABLE notifications ADD COLUMN group_key   text;
ALTER TABLE notifications ADD COLUMN group_label text;

-- Serves the grouped collapsed read and the ?group=<key> member filter. Partial: standalones excluded.
CREATE INDEX IF NOT EXISTS notifications_group_key_idx
  ON notifications (group_key, created_at DESC, id DESC) WHERE group_key IS NOT NULL;
