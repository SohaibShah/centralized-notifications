-- Per-user IANA timezone (host-owned users table; not part of the library schema).
-- Editing this via UI is deferred to the per-user settings page; seeded with demo values.
ALTER TABLE users ADD COLUMN timezone text NOT NULL DEFAULT 'UTC';
