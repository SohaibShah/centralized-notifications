-- Durable, idempotent record of action dispatches (in-app "Approve"/"Deny"-style buttons that call
-- back into a module). Keyed on an opaque `user_key` (the host's user identifier — username in the
-- reference app), NOT an internal user id: same reasoning as notification_reads (002) — the library
-- owns no users table, so there is deliberately NO foreign key to identity.
--
-- The unique tuple (user_key, notification_id, action_ref, idempotency_key) is the idempotency guard:
-- Redis Streams / client retries can replay the same dispatch request, and the store's `begin()`
-- does INSERT ... ON CONFLICT DO NOTHING then SELECT, so a replay returns the original row instead of
-- dispatching twice. `action_ref` identifies which action on the notification was invoked (e.g. its
-- array index, "0"); `idempotency_key` is caller-supplied per attempt.
--
-- status starts 'pending' and is moved to a terminal 'ok' | 'failed' by complete(), which also stamps
-- completed_at and records a (possibly truncated) result_message. The notification FK cascades so
-- deleting a notification clears its dispatch records too.

CREATE TABLE action_dispatches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_key        text NOT NULL,
  notification_id text NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  action_ref      text NOT NULL,
  idempotency_key text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  result_message  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (user_key, notification_id, action_ref, idempotency_key)
);
