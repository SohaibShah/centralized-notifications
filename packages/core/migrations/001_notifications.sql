-- The persisted notification store — durable target of the intake pipeline (validate -> dedupe ->
-- persist). Domain-agnostic: stores exactly the shared notification contract (@notifications/shared).
-- `id` is the producer-supplied idempotency key and doubles as the dedupe key
-- (INSERT ... ON CONFLICT (id) DO NOTHING). This is the library's consolidated fresh-install shape
-- (the reference app reaches the same shape via its historical migrations + transforms).

CREATE TABLE notifications (
  id             text PRIMARY KEY,                    -- contract id == idempotency/dedupe key
  module         text NOT NULL,
  title          text NOT NULL,
  description    text NOT NULL,
  priority       text NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  snoozable      boolean NOT NULL,
  category       text,
  audience_scope text NOT NULL CHECK (audience_scope IN ('global', 'team', 'role', 'user')),
  audience_id    text,                                -- null iff audience_scope = 'global'
  actions        jsonb,                               -- opaque array (validated at the boundary)
  metadata       jsonb,                               -- opaque, never interpreted by the system
  source_ts      timestamptz,                         -- contract `timestamp` (when the module fired it)
  created_at     timestamptz NOT NULL DEFAULT now(),  -- server receive time
  -- Weighted full-text search over prose only: title (A) > description (B) > category (C).
  search         tsvector GENERATED ALWAYS AS (
                   setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                   setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
                   setweight(to_tsvector('english', coalesce(category, '')), 'C')
                 ) STORED,
  suppressed     boolean NOT NULL DEFAULT false,      -- true when the source module was disabled at ingest
  -- Generated priority rank keeps the priority sort keyset-fast (one indexable column, not a CASE).
  priority_rank  smallint GENERATED ALWAYS AS (
                   CASE priority
                     WHEN 'critical' THEN 0
                     WHEN 'high'     THEN 1
                     WHEN 'normal'   THEN 2
                     WHEN 'low'      THEN 3
                   END
                 ) STORED,
  -- Enforce the audience invariant at the DB: an id is present for team/role/user and absent for global.
  CONSTRAINT notifications_audience_id_scope_ck
    CHECK ((audience_scope = 'global') = (audience_id IS NULL))
);

CREATE INDEX notifications_created_at_id_idx ON notifications (created_at DESC, id DESC);  -- keyset pagination
CREATE INDEX notifications_module_idx        ON notifications (module);                     -- module filter
CREATE INDEX notifications_audience_idx      ON notifications (audience_scope, audience_id); -- audience resolution
CREATE INDEX notifications_search_idx        ON notifications USING GIN (search);           -- full-text search
CREATE INDEX notifications_priority_keyset_idx
  ON notifications (priority_rank, created_at DESC, id DESC) WHERE suppressed = false;       -- priority-high sort
CREATE INDEX notifications_priority_low_keyset_idx
  ON notifications (priority_rank DESC, created_at DESC, id DESC) WHERE suppressed = false;  -- priority-low sort
CREATE INDEX notifications_counts_idx
  ON notifications (priority) WHERE suppressed = false;                                       -- counts aggregate
