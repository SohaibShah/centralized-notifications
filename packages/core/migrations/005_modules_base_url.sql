-- Where each module's running API lives (registry data, admin-editable — see
-- backend/migrations/013_modules_base_url.sql for the reference app's incremental equivalent, kept
-- in parity by backend/test/schema-parity.test.ts). Nullable — null means the module can't receive
-- dispatches yet.

ALTER TABLE modules ADD COLUMN base_url text;
