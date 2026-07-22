-- Per-user read state (FR-6). A row exists iff a given user has marked a given notification read;
-- absence means unread. Keyed on an opaque `user_key` (the host's user identifier — username in the
-- reference app), NOT an internal user id: the library owns no users table, so there is deliberately
-- NO foreign key to identity. The notification FK cascades so deleting a notification clears its reads.
--
-- The feed's per-row read flag is a LEFT JOIN on (notification_id, user_key); the PK's composite
-- btree index serves that lookup, so no extra index is needed.

CREATE TABLE notification_reads (
  user_key        text NOT NULL,
  notification_id text NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_key, notification_id)
);
