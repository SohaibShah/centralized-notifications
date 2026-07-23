import { afterAll, expect, test } from "vitest";
import { testPool } from "./harness";

// global-setup.ts has already dropped + recreated + migrated the core test DB.
const pool = testPool();
afterAll(() => pool.end());

async function columns(table: string): Promise<string[]> {
  const { rows } = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return rows.map((r) => r.column_name);
}

test("notification_reads is keyed on user_key, not a users FK", async () => {
  const cols = await columns("notification_reads");
  expect(cols).toContain("user_key");
  expect(cols).not.toContain("user_id");
});

test("modules holds state only — no label column (catalog is host config)", async () => {
  const cols = await columns("modules");
  expect(cols).toContain("enabled");
  expect(cols).not.toContain("label");
});

test("the core schema exists (notifications + global_settings singleton)", async () => {
  expect(await columns("notifications")).toContain("priority_rank");
  const { rows } = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM global_settings");
  expect(rows[0]?.n).toBe("1");
});
