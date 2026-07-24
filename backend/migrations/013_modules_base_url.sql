-- Where each module's running API lives. Registry data (admin-editable), not env: the action
-- dispatcher composes base_url + the action's relative path. Nullable — a null base_url means the
-- module can't receive dispatches (its dispatch actions are rejected; link actions still work).
ALTER TABLE modules ADD COLUMN IF NOT EXISTS base_url text;

-- Dev default: the module-sim service (one origin, /{key} prefix). A real deployment edits these
-- to each module's real base URL in the admin. Only sets rows that don't already have a value.
UPDATE modules SET base_url = 'http://localhost:4000/' || key WHERE base_url IS NULL;
