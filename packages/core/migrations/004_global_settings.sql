-- Library-owned notification-domain settings: feature kill-switches + retention window. Exactly one
-- row (the `id = true` PK + CHECK enforces the singleton); seeded here so a read always finds it.
-- Runtime-toggleable via the service's updateSettings / the admin routes.

CREATE TABLE global_settings (
  id                  boolean NOT NULL PRIMARY KEY DEFAULT true,
  ai_summary_enabled  boolean NOT NULL DEFAULT true,
  chatbot_enabled     boolean NOT NULL DEFAULT true,
  grouping_enabled    boolean NOT NULL DEFAULT true,
  actions_enabled     boolean NOT NULL DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  retention_days      integer NOT NULL DEFAULT 30,
  CONSTRAINT global_settings_singleton CHECK (id)
);

INSERT INTO global_settings (id) VALUES (true);
