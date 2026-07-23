-- Re-key per-user read state from the internal user uuid to the opaque host user key (username), to
-- match @notifications/core's schema. The library owns no users table, so notification_reads must not
-- FK into identity. Only the reference app (which owns `users`) can backfill the uuid -> username map;
-- that is why this transform lives here, not in the library's fresh migration set.

ALTER TABLE notification_reads ADD COLUMN user_key text;

-- Backfill from the identity table. Every existing row references a real user (old FK), so each maps
-- to exactly one username.
UPDATE notification_reads r SET user_key = u.username FROM users u WHERE u.id = r.user_id;

ALTER TABLE notification_reads ALTER COLUMN user_key SET NOT NULL;

-- Swap the primary key from (user_id, notification_id) to (user_key, notification_id). Dropping the
-- user_id column also drops its FK to users — the coupling we are removing.
ALTER TABLE notification_reads DROP CONSTRAINT notification_reads_pkey;
ALTER TABLE notification_reads DROP COLUMN user_id;
ALTER TABLE notification_reads ADD PRIMARY KEY (user_key, notification_id);
