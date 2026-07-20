-- The known module catalog. Modules are a fixed, known set for this internal tool; they are
-- no longer auto-discovered on first publish (see backend/src/pipeline/ingest.ts). A
-- notification whose `module` is not in this table is rejected at intake. Idempotent so
-- re-running the migration, or adding a module later, is safe. NOTE: intake resolves the known
-- set from the policy cache (backend/src/pipeline/policy.ts), so a module added to this table on a
-- live server only takes effect at intake after a policy-cache invalidation (any admin write) or a
-- restart — fine for deploy-time migrations, worth knowing for a hand-inserted row.
INSERT INTO modules (key, label) VALUES
  ('dsr',               'DSR'),
  ('access-governance', 'Access Governance'),
  ('data-mapping',      'Data Mapping'),
  ('assessments',       'Assessments')
ON CONFLICT (key) DO NOTHING;
