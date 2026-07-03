import pg from "pg";
import { getEnv } from "../config/env";

const { Pool } = pg;

// Lazily created so importing this module (e.g. from tests) doesn't open a
// connection before the environment is set up.
let pool: InstanceType<typeof Pool> | undefined;

export function getPool(): InstanceType<typeof Pool> {
  return (pool ??= new Pool({ connectionString: getEnv().DATABASE_URL }));
}

/** Parameterized query helper. Never string-concatenate user input into `text`. */
export function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
