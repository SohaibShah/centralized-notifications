import { query } from "../src/db/pool";

/**
 * Register a fixture module in the catalog so ingest() accepts it. Modules are a fixed, seeded
 * set (migration 007); a test that ingests a non-seeded module must register it first.
 */
export async function registerModule(key: string, enabled = true): Promise<void> {
  await query(
    "INSERT INTO modules (key, label, enabled) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled",
    [key, key, enabled],
  );
}
