-- Retention window (days) for the notifications table. CONFIG ONLY for now: nothing enforces
-- it automatically yet. Week-5 range-partitioning will drop partitions older than this value;
-- meanwhile the Dev Labs "delete older than N days" maintenance action defaults N to it.
ALTER TABLE global_settings ADD COLUMN retention_days integer NOT NULL DEFAULT 30;
