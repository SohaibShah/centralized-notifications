import pg from "pg";
import { afterAll, expect, test } from "vitest";
import { createDb } from "../src/db";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
afterAll(() => pool.end());

test("createDb.query runs a parameterized query against the injected pool", async () => {
  const db = createDb(pool);
  const { rows } = await db.query<{ n: number }>("SELECT $1::int AS n", [7]);
  expect(rows[0]?.n).toBe(7);
});
