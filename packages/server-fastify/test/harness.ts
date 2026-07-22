import pg from "pg";

/**
 * The plugin's route tests run against a DEDICATED database migrated by @notifications/core's own
 * migrate() (see global-setup.ts) — isolated from the reference app and from core's test DB.
 */
const ADMIN_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres";
export const TEST_DB = "notifications_serverfastify_test";
export const TEST_URL = ADMIN_URL.replace(/\/[^/?]+(\?|$)/, `/${TEST_DB}$1`);

export function testPool(): pg.Pool {
  return new pg.Pool({ connectionString: TEST_URL });
}

export function adminPool(): pg.Pool {
  return new pg.Pool({ connectionString: ADMIN_URL });
}
