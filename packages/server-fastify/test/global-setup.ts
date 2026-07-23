import { migrate } from "@notifications/core";
import { adminPool, TEST_DB, testPool } from "./harness";

/** Vitest globalSetup: drop + recreate + migrate (via core's migrate) the plugin's test DB. */
export default async function setup(): Promise<void> {
  const admin = adminPool();
  try {
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
