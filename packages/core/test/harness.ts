import pg from "pg";

/**
 * Core's DB-touching tests run against a DEDICATED database built by the library's own
 * `migrate(pool)` — NOT the reference app's shared DB — so they exercise the final library schema
 * (user_key read-state, label-less modules) independent of the reference app's migration state.
 * `global-setup.ts` drops + recreates + migrates it once per `vitest run`; each test file opens its
 * own pool here and ends it in `afterAll`. Tests use unique ids to avoid cross-file collisions.
 */
const ADMIN_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres";
export const TEST_DB = "notifications_core_test";
export const TEST_URL = ADMIN_URL.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);

/** A fresh pool onto the migrated core test DB. */
export function testPool(): pg.Pool {
  return new pg.Pool({ connectionString: TEST_URL });
}

/** Admin pool (default DB) — used only by global-setup to create/drop the test DB. */
export function adminPool(): pg.Pool {
  return new pg.Pool({ connectionString: ADMIN_URL });
}
