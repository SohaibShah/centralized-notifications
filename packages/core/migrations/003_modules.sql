-- Per-module runtime STATE (library-owned). The catalog itself (which modules exist + their display
-- labels) is HOST CONFIG passed to createNotificationService — so this table has no `label`. `enabled`
-- is the admin kill-switch (a never-seen module reconciles in enabled and stays that way until an admin
-- disables it); `last_seen_at` feeds the admin "recently active" sort. `reconcile()` inserts a row per
-- configured module id that isn't present yet.

CREATE TABLE modules (
  key           text NOT NULL PRIMARY KEY,
  enabled       boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
