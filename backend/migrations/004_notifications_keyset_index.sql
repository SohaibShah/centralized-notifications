-- The feed's keyset query orders by (created_at DESC, id DESC) and seeks with a
-- row-value comparison on the same tuple. A composite index on exactly that tuple lets
-- Postgres satisfy both the seek and the ordering from the index alone — including the
-- tie-break within a same-timestamp cluster, which real bursts produce (many rows in
-- one millisecond). It supersedes the single-column created_at index (a prefix of this
-- one), so that older index is dropped to avoid carrying a redundant duplicate.

DROP INDEX IF EXISTS notifications_created_at_idx;

CREATE INDEX notifications_created_at_id_idx ON notifications (created_at DESC, id DESC);
