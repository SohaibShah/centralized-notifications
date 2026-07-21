-- The `priority-low` feed sort orders by (priority_rank DESC, created_at DESC, id DESC). Migration
-- 008's index is (priority_rank ASC, created_at DESC, id DESC): a btree can only be scanned forward
-- (serves priority-high) or backward (priority_rank DESC, created_at ASC, id ASC) — neither yields
-- rank-DESC with time-DESC, so priority-low would need a Sort node over the whole matching set on
-- every page, breaking the keyset "deep pages cost the same as the first" guarantee (NFR-2). A
-- dedicated index whose leading column runs the other way covers it. Partial on the same predicate
-- the feed query uses (suppressed = false).
CREATE INDEX notifications_priority_low_keyset_idx
  ON notifications (priority_rank DESC, created_at DESC, id DESC)
  WHERE suppressed = false;
