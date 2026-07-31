-- Per-user snooze/mute rules. One row per active rule targeting a module (registry id) or a category
-- (free-form). muted_until NULL = muted indefinitely; a future timestamp = snoozed-until (the read
-- filter simply stops matching once it passes, so no expiry sweep is needed). Keyed by user_key
-- (text), identity-free. The (user_key) index serves the read-path NOT EXISTS lookup.
CREATE TABLE user_mute_rules (
  user_key     text NOT NULL,
  target_kind  text NOT NULL,
  target       text NOT NULL,
  muted_until  timestamptz,
  PRIMARY KEY (user_key, target_kind, target)
);
CREATE INDEX user_mute_rules_user_idx ON user_mute_rules (user_key);
