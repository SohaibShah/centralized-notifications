-- Week-2 admin foundation (FR-7 / FR-8).
--
-- `modules`: one row per notification source, auto-discovered on first publish. `enabled`
-- is the admin kill-switch; `label` is a human name (defaults to the key, admin-renamable).
-- A never-seen module is enabled by default — discovery inserts it enabled and never flips
-- that back on later publishes, so an admin's disable sticks.
--
-- `global_settings`: exactly one row (the `id = true` primary key + CHECK enforces the
-- singleton) holding global feature kill-switches. Seeded here so a read always finds it.
--
-- `notifications.suppressed`: set true at ingest when the source module is disabled — the
-- row is kept (audit of what would have arrived) but excluded from delivery and the feed.

CREATE TABLE modules (
  key           text NOT NULL PRIMARY KEY,
  label         text NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE global_settings (
  id                  boolean NOT NULL PRIMARY KEY DEFAULT true,
  ai_summary_enabled  boolean NOT NULL DEFAULT true,
  chatbot_enabled     boolean NOT NULL DEFAULT true,
  grouping_enabled    boolean NOT NULL DEFAULT true,
  actions_enabled     boolean NOT NULL DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT global_settings_singleton CHECK (id)
);

INSERT INTO global_settings (id) VALUES (true);

ALTER TABLE notifications ADD COLUMN suppressed boolean NOT NULL DEFAULT false;
