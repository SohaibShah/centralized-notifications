import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "@notifications/core";

// Guards drift between the two ways the library-owned schema comes into existence:
//  - a FRESH host runs @notifications/core's migrate() (consolidated final shape), and
//  - the reference app reaches the same shape via its historical migrations + transforms (011/012).
// If these diverge, a third-party host and the dogfooding reference app would run different schemas.

const ADMIN_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres";
const LIB_DB = "notifications_parity_lib";
const REF_DB = "notifications_parity_ref";
const urlFor = (db: string) => ADMIN_URL.replace(/\/[^/?]+(\?|$)/, `/${db}$1`);

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
const SHARED_TABLES = ["notifications", "notification_reads", "modules", "global_settings"];

let libPool: pg.Pool;
let refPool: pg.Pool;

async function recreate(admin: pg.Pool, db: string): Promise<void> {
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [db],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${db}`);
  await admin.query(`CREATE DATABASE ${db}`);
}

async function columns(poolRef: pg.Pool, table: string): Promise<string[]> {
  const { rows } = await poolRef.query<{ c: string; t: string; n: string; g: string }>(
    `SELECT column_name AS c, data_type AS t, is_nullable AS n, is_generated AS g
       FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [table],
  );
  return rows.map((r) => `${r.c}:${r.t}:${r.n}:${r.g}`).sort();
}

async function pk(poolRef: pg.Pool, table: string): Promise<string[]> {
  const { rows } = await poolRef.query<{ c: string }>(
    `SELECT kcu.column_name AS c
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      WHERE tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'`,
    [table],
  );
  return rows.map((r) => r.c).sort();
}

async function indexes(poolRef: pg.Pool, table: string): Promise<string[]> {
  const { rows } = await poolRef.query<{ i: string }>(
    "SELECT indexname AS i FROM pg_indexes WHERE schemaname='public' AND tablename=$1",
    [table],
  );
  return rows.map((r) => r.i).sort();
}

beforeAll(async () => {
  const admin = new pg.Pool({ connectionString: ADMIN_URL });
  try {
    await recreate(admin, LIB_DB);
    await recreate(admin, REF_DB);
  } finally {
    await admin.end();
  }

  libPool = new pg.Pool({ connectionString: urlFor(LIB_DB) });
  await migrate(libPool);

  refPool = new pg.Pool({ connectionString: urlFor(REF_DB) });
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) await refPool.query(readFileSync(path.join(migrationsDir, f), "utf8"));
}, 60_000);

afterAll(async () => {
  await libPool?.end();
  await refPool?.end();
  const admin = new pg.Pool({ connectionString: ADMIN_URL });
  try {
    await recreate(admin, LIB_DB);
    await recreate(admin, REF_DB);
  } finally {
    await admin.end();
  }
});

for (const table of SHARED_TABLES) {
  test(`${table}: fresh library schema matches the reference migration history`, async () => {
    expect(await columns(libPool, table)).toEqual(await columns(refPool, table));
    expect(await pk(libPool, table)).toEqual(await pk(refPool, table));
    expect(await indexes(libPool, table)).toEqual(await indexes(refPool, table));
  });
}
