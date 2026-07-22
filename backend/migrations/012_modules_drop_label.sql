-- The module catalog (which modules exist + their display labels) is now HOST CONFIG passed to
-- createNotificationService, not a DB column. The `modules` table keeps only runtime state
-- (enabled, last_seen_at), matching @notifications/core's schema. Drop the now-host-owned label.
ALTER TABLE modules DROP COLUMN label;
