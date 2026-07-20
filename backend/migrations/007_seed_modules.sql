-- The known module catalog. Modules are a fixed, known set for this internal tool; they are
-- no longer auto-discovered on first publish (see backend/src/pipeline/ingest.ts). A
-- notification whose `module` is not in this table is rejected at intake. Idempotent so
-- re-running the migration, or adding a module later, is safe.
INSERT INTO modules (key, label) VALUES
  ('dsr',               'DSR'),
  ('access-governance', 'Access Governance'),
  ('data-mapping',      'Data Mapping'),
  ('assessments',       'Assessments')
ON CONFLICT (key) DO NOTHING;
