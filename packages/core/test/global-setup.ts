import { migrate } from "../src/migrate";
import { adminPool, TEST_DB, testPool } from "./harness";

/**
 * Vitest globalSetup: drop + recreate the dedicated core test DB, then run the library's own
 * migrate() against it. Runs once per `vitest run`, before any test file, giving every DB test a
 * clean, library-migrated schema.
 */
export default async function setup(): Promise<void> {
  const admin = adminPool();
  try {
    // Terminate any lingering connections, then recreate for a clean slate.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }

  const pool = testPool();
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
