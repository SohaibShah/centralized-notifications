import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

/**
 * Forward-only migration runner for the library's own schema. Applies every
 * `migrations/*.sql` in lexical order, each in its own transaction, recording applied files in a
 * `notifications_schema_migrations` ledger (a distinct name so it never collides with a host's own
 * migration system). Runs against a host-provided pool — the library owns no connection.
 *
 * Idempotent: re-running is a no-op. For a fresh host this builds the whole library schema; the
 * reference app does NOT call this (its historical migrations already built these tables).
 */
export async function migrate(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS notifications_schema_migrations (
       filename text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const { rowCount } = await pool.query(
      "SELECT 1 FROM notifications_schema_migrations WHERE filename = $1",
      [file],
    );
    if (rowCount && rowCount > 0) continue;

    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO notifications_schema_migrations (filename) VALUES ($1)", [
        file,
      ]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
}
