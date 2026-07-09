-- Per-user read state (FR-6). A row exists iff a given user has marked a given
-- notification as read; the absence of a row means unread. This is deliberately
-- its own table rather than a boolean column on `notifications`, because "read" is
-- a fact about a (recipient, notification) pair: one notification fans out to many
-- users, each with independent read state.
--
-- `read_at` records when it was marked (supports a later "mark all read since X"
-- and the audit trail). Both foreign keys cascade: removing a user or a
-- notification removes its read rows, so no orphans accumulate.

CREATE TABLE notification_reads (
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  notification_id text NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);

-- The feed's per-row read flag is a LEFT JOIN on (notification_id, user_id) with
-- equality on both columns; the primary key's composite btree index already serves
-- that lookup, so no additional index is needed here.
