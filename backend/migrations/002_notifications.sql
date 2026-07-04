-- The persisted notification store — the durable target of the intake pipeline
-- (validate -> dedupe -> persist). Domain-agnostic: it stores exactly the shared
-- notification contract (packages/shared). `id` is the producer-supplied idempotency
-- key and doubles as the dedupe key (INSERT ... ON CONFLICT (id) DO NOTHING).
--
-- Not partitioned yet (Week 5 T8 owns range-partitioning + retention). No delivery/
-- read status here — that becomes a durable fact once delivery exists (Task 6/7).

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
  -- The module slug and opaque metadata are deliberately excluded (exact-match filters /
  -- contract opacity). Structured filtering uses the btree indexes below, not this vector.
  search         tsvector GENERATED ALWAYS AS (
                   setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                   setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
                   setweight(to_tsvector('english', coalesce(category, '')), 'C')
                 ) STORED,
  -- Enforce the audience invariant at the DB, not just in code: an id is present
  -- for team/role/user scopes and absent for global (which targets everyone).
  CONSTRAINT notifications_audience_id_scope_ck
    CHECK ((audience_scope = 'global') = (audience_id IS NULL))
);

CREATE INDEX notifications_created_at_idx ON notifications (created_at DESC);           -- keyset pagination (Wk1 T7)
CREATE INDEX notifications_module_idx     ON notifications (module);                     -- module filter (Wk2 T6)
CREATE INDEX notifications_audience_idx   ON notifications (audience_scope, audience_id); -- audience resolution (Wk4 T1)
CREATE INDEX notifications_search_idx     ON notifications USING GIN (search);           -- full-text search (Wk2/Wk3)
